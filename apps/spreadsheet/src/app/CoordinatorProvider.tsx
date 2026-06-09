/**
 * Coordinator Provider Component
 *
 * Bridge component that integrates the XState-based coordinator
 * with the existing DocumentContext via useWorkbook().
 *
 * Usage:
 * ```tsx
 * <DocumentProvider docId="my-doc">
 * <SpreadsheetCoordinatorProvider>
 * <OptimizedGridV2 />
 * </SpreadsheetCoordinatorProvider>
 * </DocumentProvider>
 * ```
 *
 * @see ARCHITECTURE.md - Coordinator Pattern
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react';

import type { ActionType } from '@mog-sdk/contracts/actions';
import { objectSelectors } from '../selectors';
import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { SelectionCheckpoint } from '@mog-sdk/contracts/selection';
import { dispatch } from '../actions/dispatcher';
import { createActorAccessLayerFromBundle } from '../coordinator/actor-access';
import { createKeyUpCapture } from './coordinator-keyup-capture';
import type { EditorDependencies } from '../coordinator/types';
import { checkCalculatedColumnAutoFill } from '../coordinator/mutations/tables';
import {
  hasImplicitRowStructuredReference,
  qualifyImplicitRowStructuredReferences,
  resolveCalculatedColumnCellContext,
  resolveTableHeaderCellContext,
} from '../coordinator/tables/calculated-column-context';
import { CircularReferenceDialog, useCircularReferenceDialog } from '../dialogs/formulas';
import {
  CoordinatorProvider as BaseCoordinatorProvider,
  useCoordinator,
  type CoordinatorProviderProps as BaseProviderProps,
} from '../hooks/shared/use-coordinator';
import { usePlatform, usePlatformIdentity, useShellService } from '@mog/shell';
import {
  useActiveSheetId,
  useDocumentContext,
  useFeatureGates,
  useReadOnly,
  useSpreadsheetHostCommandsOptional,
  useUIStoreApi,
  useWorkbook,
} from '../infra/context';
import { setupRangeSelectionCoordination } from '../systems/grid-editing/coordination';
import { setupUndoSelectionCoordination } from '../systems/grid-editing/coordination/undo-selection-coordination';
import { isGlobalShortcut } from '../systems/shared/utils/focus-utils';
import { useCollabPresence, useSelectionPresenceBroadcast } from '../hooks/collab';

// =============================================================================
// Pane Navigation Context (E1: F6 Pane Navigation)
// =============================================================================

/**
 * Context for registering pane elements for F6 navigation.
 * Components use this to register their DOM elements with the coordinator.
 */
interface PaneNavigationContextValue {
  /** Register toolbar element ref */
  setToolbarElement: (el: HTMLElement | null) => void;
  /** Register formula bar element ref */
  setFormulaBarElement: (el: HTMLElement | null) => void;
  /** Register grid element ref */
  setGridElement: (el: HTMLElement | null) => void;
  /** Register status bar element ref */
  setStatusBarElement: (el: HTMLElement | null) => void;
}

const PaneNavigationContext = createContext<PaneNavigationContextValue | null>(null);

function keyboardEventTargetElement(e: KeyboardEvent): HTMLElement | null {
  return e.target instanceof HTMLElement ? e.target : null;
}

function isEditableKeyboardTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  );
}

function isDialogKeyboardTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return Boolean(target.closest('[role="dialog"]'));
}

function isNativeEditableShortcut(e: KeyboardEvent, target: HTMLElement | null): boolean {
  if (!isEditableKeyboardTarget(target)) return false;
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;

  const key = e.key.toLowerCase();
  return key === 'c' || key === 'x' || key === 'v' || key === 'z' || key === 'y';
}

/**
 * Hook to access pane navigation element registration.
 * Used by components to register their DOM elements for F6 navigation.
 */
export function usePaneNavigation(): PaneNavigationContextValue {
  const context = useContext(PaneNavigationContext);
  if (!context) {
    throw new Error('usePaneNavigation must be used within SpreadsheetCoordinatorProvider');
  }
  return context;
}

// =============================================================================
// Types
// =============================================================================

interface SpreadsheetCoordinatorProviderProps {
  /** Child components */
  children: ReactNode;
  /** Optional callback for metrics/observability */
  onMetric?: BaseProviderProps['onMetric'];
  /** Enable keyboard shortcuts and navigation (defaults to true) */
  enableKeyboard?: boolean;
  /**
   * Callback to trigger UI-level actions (open find dialog, etc.)
   * Routed through coordinator config — not prop-drilled to child components.
   */
  onUIAction?: (action: string) => void;
}

type PendingSelectionCheckpointRef = MutableRefObject<SelectionCheckpoint | null>;

// =============================================================================
// Pane Navigation Setup (E1: F6 Pane Navigation)
// =============================================================================

/**
 * Internal component that provides pane navigation context.
 * Must be rendered inside BaseCoordinatorProvider to access coordinator.
 *
 * This creates callbacks that components use to register their DOM elements
 * with the coordinator for F6 pane navigation.
 *
 */
function PaneNavigationSetup({ children }: { children: ReactNode }) {
  const coordinator = useCoordinator();

  // Create stable callbacks for element registration
  const paneNavigationValue = useMemo<PaneNavigationContextValue>(
    () => ({
      setToolbarElement: (el) => coordinator.input.setPaneToolbarElement(el),
      setFormulaBarElement: (el) => coordinator.input.setPaneFormulaBarElement(el),
      setGridElement: (el) => coordinator.input.setPaneGridElement(el),
      setStatusBarElement: (el) => coordinator.input.setPaneStatusBarElement(el),
    }),
    [coordinator],
  );

  return (
    <PaneNavigationContext.Provider value={paneNavigationValue}>
      {children}
    </PaneNavigationContext.Provider>
  );
}

// =============================================================================
// Undo Selection Coordination Setup (Selection Undo/Redo Checkpointing)
// =============================================================================

/**
 * Internal component that sets up undo-selection coordination.
 * Must be rendered inside BaseCoordinatorProvider to access coordinator.
 *
 * This wires up the selection restoration for undo/redo operations:
 * - Listens to 'stack-item-popped' events from UndoManager
 * - Restores selection from the checkpoint stored in stack item metadata
 * - Captures post-operation selection for redo support
 *
 */
function UndoSelectionCoordinatorSetup({
  children,
  pendingSelectionCheckpointRef,
}: {
  children: ReactNode;
  pendingSelectionCheckpointRef: PendingSelectionCheckpointRef;
}) {
  const coordinator = useCoordinator();
  const wb = useWorkbook();
  const uiStoreApi = useUIStoreApi();

  useEffect(() => {
    // Set up undo-selection coordination
    // This handles restoration of selection when undo/redo occurs
    const cleanup = setupUndoSelectionCoordination({
      history: wb.history,
      selectionActor: coordinator.grid.access.actors.selection,
      getActiveSheetId: () => uiStoreApi.getState().activeSheetId,
      setActiveSheet: (sheetId) => uiStoreApi.getState().setActiveSheet(sheetId),
      consumePendingSelectionCheckpoint: () => {
        const checkpoint = pendingSelectionCheckpointRef.current;
        pendingSelectionCheckpointRef.current = null;
        return checkpoint;
      },
      primeSheetViewState: (sheetId, checkpoint) => {
        const uiStore = uiStoreApi.getState();
        const existing = uiStore.getSheetViewState(sheetId);
        uiStore.saveSheetViewState(sheetId, {
          ranges: checkpoint.ranges,
          activeCell: checkpoint.activeCell,
          anchor: checkpoint.anchor,
          anchorCol: null,
          anchorRow: null,
          scrollTop: existing?.scrollTop ?? 0,
          scrollLeft: existing?.scrollLeft ?? 0,
        });
      },
    });

    return cleanup;
  }, [coordinator, pendingSelectionCheckpointRef, uiStoreApi, wb.history]);

  return <>{children}</>;
}

// =============================================================================
// Document-Level Keyboard Capture (Keyboard Single Source of Truth)
// =============================================================================

/**
 * Internal component that sets up document-level keyboard capture.
 * Must be rendered inside BaseCoordinatorProvider to access coordinator.
 *
 * ARCHITECTURE: This is the SINGLE entry point for navigation keys (Enter, Tab, Escape)
 * during editing. Editor components (InlineCellEditor, FormulaBar) do NOT handle these
 * keys locally - they only handle text input (onChange) and IME composition.
 *
 * Uses capture phase ({ capture: true }) to intercept events BEFORE they reach
 * the focused input element. This prevents dual handling that caused the
 * "Enter moves down 2 cells" bug.
 *
 * FIX (2026-02-03): Changed from DOM-based routing (data-spreadsheet-container ancestor)
 * to state machine-based routing (editor machine state). DOM ancestry failed for formula bar
 * because it's a sibling of SpreadsheetGrid, not a descendant. State machines are the
 * single source of truth for editing state.
 *
 */
function KeyboardCaptureSetup({
  children,
  workbook,
}: {
  children: ReactNode;
  workbook: WorkbookInternal;
}) {
  const coordinator = useCoordinator();
  const uiStoreApi = useUIStoreApi();
  const readOnly = useReadOnly();
  const featureGates = useFeatureGates();
  const hostCommands = useSpreadsheetHostCommandsOptional();

  // typed platform + shell-service deps for handler dispatch.
  const platform = usePlatform();
  const shellService = useShellService();

  // M9: Read action callbacks from coordinator config — no prop-drilling
  const { onUIAction } = coordinator.input;

  useEffect(() => {
    const keyboardCoordinator = coordinator.input.keyboardCoordinator;

    keyboardCoordinator.setDependencies({
      workbook,
      selectionActor: coordinator.grid.access.actors.selection,
      editorActor: coordinator.grid.access.actors.editor,
      clipboardActor: coordinator.grid.access.actors.clipboard,
      objectInteractionActor: coordinator.objects.access.actors.object,
      chartActor: coordinator.objects.access.actors.chart,
      findReplaceActor: coordinator.grid.access.actors.findReplace,
      commentActor: coordinator.grid.access.actors.comment,
      paneFocusActor: coordinator.input.access.actors.paneFocus,
      rendererActor: coordinator.renderer.access.actors.renderer,
      getActiveSheetId: () => uiStoreApi.getState().activeSheetId,
      // UIState is a superset of KeyboardUIStore — cast for DAG boundary compatibility
      uiStore: uiStoreApi,
      getCoordinator: () => coordinator,
      // dispatch now accepts string (runtime handler lookup handles unknown actions)
      dispatch: (action, deps, payload) => dispatch(action as ActionType, deps, payload),
      readOnly,
      featureGates,
      createAccessLayer: createActorAccessLayerFromBundle,
      // Object selection helpers — read fresh actor state when called
      hasObjectSelection: () => {
        const snapshot = coordinator.objects.access.actors.object.getSnapshot();
        return objectSelectors.hasSelection(snapshot);
      },
      isEditingObjectText: () => {
        const snapshot = coordinator.objects.access.actors.object.getSnapshot();
        return objectSelectors.isEditingText(snapshot);
      },
      isFlashFillPreviewActive: () => uiStoreApi.getState().flashFillPreview.isShowingPreview,
      platform,
      shellService,
      hostCommands,
      onUIAction,
    });

    // After wiring, verify dependencies are set (should always succeed)
    if (!keyboardCoordinator.hasDependencies()) {
      return;
    }

    /**
     * Document-level keyboard handler using capture phase.
     * Intercepts navigation keys BEFORE they reach input elements.
     */
    const handleKeyDownCapture = (e: KeyboardEvent) => {
      // IME composition guard - never intercept during IME (must be first)
      if (e.isComposing || e.keyCode === 229) {
        return;
      }

      // Check editor machine state - THE SOURCE OF TRUTH for editing state
      // This replaces the DOM-based check (data-spreadsheet-container) which failed
      // for formula bar since it's outside the grid container.
      const editorSnapshot = coordinator.grid.access.actors.editor.getSnapshot();
      const isEditing =
        editorSnapshot.matches('editing') ||
        editorSnapshot.matches('formulaEditing') ||
        editorSnapshot.matches('richTextEditing') ||
        editorSnapshot.matches('imeComposing');
      const target = keyboardEventTargetElement(e);

      if (
        isGlobalShortcut(e) &&
        !isDialogKeyboardTarget(target) &&
        !isNativeEditableShortcut(e, target)
      ) {
        const result = keyboardCoordinator.handleKeyboardEvent(e);
        if (result.handled) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (!isEditing) {
        // Not editing — normally grid's onKeyDown handles shortcuts via bubbling.
        // But if focus is on BODY (e.g., after context menu close), the grid never
        // receives the event. Route through the coordinator directly in that case.
        const activeTag = document.activeElement?.tagName;

        if (activeTag === 'BODY' || activeTag === 'HTML') {
          // Escape with an open popover/dialog: let it bubble so the
          // popover's own keydown handler can close it. Some popovers
          // (e.g. CommentPopover) decline Radix's auto-focus to keep the
          // grid usable, so focus is on BODY even though a dialog is
          // visually present. Without this branch we'd consume Escape
          // here, dispatch CLEAR_CLIPBOARD, and stopPropagation() —
          // which is what kept dismissCommentPopover broken.
          if (e.key === 'Escape' && document.querySelector('[role="dialog"]')) {
            return;
          }
          const result = keyboardCoordinator.handleKeyboardEvent(e);
          if (result.handled) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }

        // Sheet navigation shortcuts (Ctrl+PageDown/Up) must also fire when focus
        // is on spreadsheet chrome elements (e.g. sheet tabs) that sit outside the
        // grid div and therefore never bubble to the grid's onKeyDown handler.
        const isSheetNavigation =
          (e.key === 'PageDown' || e.key === 'PageUp') && (e.ctrlKey || e.metaKey);
        if (isSheetNavigation) {
          const result = keyboardCoordinator.handleKeyboardEvent(e);
          if (result.handled) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
        return;
      }

      // Check focus machine to exclude dialog inputs
      // When a dialog has focus, its inputs handle their own keyboard events.
      // The focus machine tracks what layer has focus (grid, formulaBar, dialog, etc.)
      const focusActor = coordinator.input.access.actors.focus;
      if (!focusActor) return; // Focus not wired yet
      const focusSnapshot = focusActor.getSnapshot();
      const focusStack = focusSnapshot.context.stack;
      const currentLayerType =
        focusStack.length > 0 ? focusStack[focusStack.length - 1].type : 'grid';

      // If focus is in a dialog, let the dialog handle keyboard events
      // Only intercept when focus is on grid, editor, or formulaBar (spreadsheet editors)
      if (
        currentLayerType !== 'grid' &&
        currentLayerType !== 'editor' &&
        currentLayerType !== 'formulaBar'
      ) {
        return;
      }

      // Only intercept navigation keys during editing
      const isNavigationKey = ['Enter', 'Tab', 'Escape'].includes(e.key);
      // Sheet switching (Ctrl/Cmd+PageDown/Up) should also be intercepted during editing
      // so NEXT_SHEET/PREVIOUS_SHEET actions can fire while formula editing is active
      const isSheetSwitch =
        (e.key === 'PageDown' || e.key === 'PageUp') && (e.ctrlKey || e.metaKey);
      const isPickerDropdownShortcut =
        e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowDown';
      if (!isNavigationKey && !isSheetSwitch) {
        const isFormattingShortcut =
          (e.ctrlKey || e.metaKey) && !e.altKey && ['b', 'i', 'u'].includes(e.key.toLowerCase());
        const editorContext = editorSnapshot.context as {
          hasSelection?: boolean;
          hasCharSelection?: boolean;
        };
        if (
          isFormattingShortcut &&
          (editorContext.hasSelection || editorContext.hasCharSelection)
        ) {
          const result = keyboardCoordinator.handleKeyboardEvent(e);
          if (result.handled) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }

        const isPrintableFormulaInput =
          editorSnapshot.matches({ formulaEditing: 'enterMode' }) &&
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !isEditableKeyboardTarget(target) &&
          !isDialogKeyboardTarget(target);

        if (isPrintableFormulaInput) {
          const result = keyboardCoordinator.handleKeyboardEvent(e);
          if (result.handled) {
            e.preventDefault();
            e.stopPropagation();
          }
        }

        if (isPickerDropdownShortcut) {
          const result = keyboardCoordinator.handleKeyboardEvent(e);
          if (result.handled) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }

        // Not a navigation key - let it through for text input
        return;
      }

      // Special case: Ctrl+Enter inserts newline (handled by FormulaBar)
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        // Let FormulaBar handle Ctrl+Enter for newline insertion
        return;
      }

      // When autocomplete suggestions or a picker dropdown is open,
      // let Tab/Enter/Escape propagate to the autocomplete handler
      const { isSuggestionsOpen, isPickerOpen } = editorSnapshot.context;
      if (isSuggestionsOpen || isPickerOpen) {
        return;
      }

      // Route to KeyboardCoordinator
      const result = keyboardCoordinator.handleKeyboardEvent(e);

      if (result.handled) {
        // Prevent event from reaching the input element
        e.preventDefault();
        e.stopPropagation();
      }
    };

    /**
     * Document-level keyup handler.
     *
     * The keyboard-coordinator's Alt-tap detector requires the
     * companion `keyup` event to promote a clean tap into keytip mode
     * (the KeyTipContext's window-level keyup listener was deleted
     * because it raced with this one). The grid's own `onKeyUp` only
     * fires when the grid is focused; on a fresh page where focus is
     * on `<body>`, the grid never sees the Alt-up. Routing it through
     * the document-level listener here ensures the chord buffer can
     * enter `'keyTipMode'` regardless of focus owner.
     *
     * The handler is conservative: `keyboardCoordinator.handleKeyUp`
     * only acts on Alt-up (Alt-tap promotion) and Ctrl/Meta-up (paste
     * options menu); every other key is a no-op.
     *
     * `preventDefault` is required on a successful Alt-tap promotion:
     * Windows browsers focus the title-bar menu on bare-Alt release
     * (Win32 menu-mnemonic convention), which yanks focus from the
     * page after the coordinator has already entered `'keyTipMode'`.
     * Without this, the next chord key (e.g. `H` after `Alt`) goes to
     * the browser chrome instead of the matcher, and KeyTips never
     * surface for Windows users. macOS has no equivalent default, so
     * the bug was invisible there.
     */
    const handleKeyUpCapture = createKeyUpCapture((e) => keyboardCoordinator.handleKeyUp(e));

    // Attach with capture: true to intercept before target
    document.addEventListener('keydown', handleKeyDownCapture, { capture: true });
    document.addEventListener('keyup', handleKeyUpCapture, { capture: true });

    return () => {
      document.removeEventListener('keydown', handleKeyDownCapture, { capture: true });
      document.removeEventListener('keyup', handleKeyUpCapture, { capture: true });
    };
  }, [
    coordinator,
    featureGates,
    hostCommands,
    onUIAction,
    platform,
    readOnly,
    shellService,
    uiStoreApi,
    workbook,
  ]);

  return <>{children}</>;
}

// =============================================================================
// Range Selection Coordination Setup
// =============================================================================

/**
 * Internal component that sets up range selection coordination.
 * Must be rendered inside BaseCoordinatorProvider to access coordinator.
 *
 * This wires up the range selection mode functionality:
 * - Monitors range selection mode state in UIStore
 * - Sends machine events to selection actor when entering/exiting mode
 * - Updates UIStore with live range updates from selection
 * - Handles dialog minimize/restore callbacks (currently no-ops)
 *
 */
function RangeSelectionCoordinatorSetup({ children }: { children: ReactNode }) {
  const coordinator = useCoordinator();
  const uiStoreApi = useUIStoreApi();

  useEffect(() => {
    // Set up range selection coordination
    // This handles dialog minimize/restore and selection updates
    const result = setupRangeSelectionCoordination({
      uiStore: uiStoreApi,
      selectionActor: coordinator.grid.access.actors.selection,
      // TODO: Implement actual dialog minimize/restore callbacks
      // For now, these are no-ops. Dialog components should handle their own visibility.
      onDialogMinimize: () => {
        // Dialog should minimize itself based on rangeSelectionMode.active state
      },
      onDialogRestore: () => {
        // Dialog should restore itself based on rangeSelectionMode.active state
      },
    });

    return result.cleanup;
  }, [coordinator, uiStoreApi]);

  return <>{children}</>;
}

// =============================================================================
// Collab Presence Bridge
// =============================================================================

/**
 * Internal component that bridges the coordinator's selection state
 * to the collab presence system. Broadcasts the local user's active
 * cell / selection range so remote participants see a live cursor.
 *
 * Must be rendered inside BaseCoordinatorProvider.
 */
function CollabPresenceBridge({ children }: { children: ReactNode }) {
  const coordinator = useCoordinator();
  const { setPresence } = useCollabPresence();
  useSelectionPresenceBroadcast(setPresence, coordinator);

  return <>{children}</>;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Integrates the XState coordinator with the existing DocumentContext.
 *
 * This component:
 * 1. Gets the CRDT document from DocumentContext
 * 2. Gets the initial sheet ID from UIStore
 * 3. Gets StoreRefs from SpreadsheetStore for FloatingObjectManager
 * 4. Creates the coordinator with these values
 * 5. Sets up sheet switch coordination to sync UIStore.activeSheetId with coordinator
 * 6. Sets up pane navigation context for F6 navigation (E1)
 * 7. Sets up undo-selection coordination for selection restoration on undo/redo
 * 8. Sets up editor dependencies for commit coordination and schema lookup
 *
 * The coordinator owns all XState actors (selection, editor, clipboard, renderer)
 * and handles cross-machine communication.
 */
export function SpreadsheetCoordinatorProvider({
  children,
  onMetric,
  enableKeyboard = true,
  onUIAction,
}: SpreadsheetCoordinatorProviderProps) {
  const activeSheetId = useActiveSheetId();
  const uiStoreApi = useUIStoreApi();
  const platformIdentity = usePlatformIdentity();
  const readOnly = useReadOnly();
  const importDurability = useDocumentContext().importDurability;

  // Get validation dialog actions from UI store. The coordinator lives above the
  // component tree, so it can't use React hooks; the UI store is the bridge that
  // lets it surface modal dialogs (strict / warning / information).
  const showValidationError = uiStoreApi.getState().showValidationError;
  const showValidationWarning = uiStoreApi.getState().showValidationWarning;
  const showFormulaError = uiStoreApi.getState().showFormulaError;

  // Consume the unified Workbook from DocumentProvider (created during initialization).
  // Workbook is now created once in DocumentProvider, not here.
  const workbook = useWorkbook();
  const pendingSelectionCheckpointRef = useRef<SelectionCheckpoint | null>(null);
  const circularReferenceDialog = useCircularReferenceDialog();
  const {
    state: circularReferenceDialogState,
    showDialog: showCircularReferenceDialog,
    handleEnableIterative,
    handleCancel: handleCircularReferenceCancel,
  } = circularReferenceDialog;

  // Create editor dependencies for commit coordination and schema lookup
  // These enable the editor to commit values and resolve editor types from schemas
  const editorDependencies = useMemo<EditorDependencies>(() => {
    const cellCheckpoint = (
      sheetId: SelectionCheckpoint['sheetId'],
      row: number,
      col: number,
    ): SelectionCheckpoint => ({
      sheetId,
      ranges: [{ startRow: row, startCol: col, endRow: row, endCol: col }],
      activeCell: { row, col },
      anchor: null,
      direction: 'down-right',
    });

    const rangeCheckpoint = (
      sheetId: SelectionCheckpoint['sheetId'],
      range: CellRange,
    ): SelectionCheckpoint => ({
      sheetId,
      ranges: [
        {
          startRow: range.startRow,
          startCol: range.startCol,
          endRow: range.endRow,
          endCol: range.endCol,
        },
      ],
      activeCell: { row: range.startRow, col: range.startCol },
      anchor: null,
      direction: 'down-right',
    });

    const withSelectionCheckpoint = async <T,>(
      checkpoint: SelectionCheckpoint,
      mutation: () => Promise<T>,
    ): Promise<T> => {
      pendingSelectionCheckpointRef.current = checkpoint;
      try {
        return await mutation();
      } finally {
        if (pendingSelectionCheckpointRef.current === checkpoint) {
          pendingSelectionCheckpointRef.current = null;
        }
      }
    };

    return {
      // Write cell value to store via unified Worksheet API (ws.setCell).
      // Format preservation is now handled in the Rust viewport patch layer
      // (produce_viewport_patches enriches format_idx from the effective format).
      //
      // The `async`/`await` form preserves rejections so the editor machine's
      // `commitCellValue` invoke can route Rust errors (e.g.
      // `ComputeError::PartialArrayWrite`) through its `onError` transition
      // instead of silently completing. The previous `.then(() => {})` form
      // dropped both the resolved value and any rejection.
      setCellValue: async (sheetId, row, col, value) => {
        const ws = workbook.getSheetById(sheetId);
        const tableHeader = await resolveTableHeaderCellContext(sheetId, row, col, workbook);
        if (tableHeader) {
          if (tableHeader.columnName !== value) {
            await withSelectionCheckpoint(cellCheckpoint(sheetId, row, col), () =>
              ws.tables.renameColumn(tableHeader.tableName, tableHeader.columnIndex, value),
            );
          }
          return;
        }

        await withSelectionCheckpoint(cellCheckpoint(sheetId, row, col), () =>
          ws.setCell(row, col, value),
        );
        if (value.startsWith('=')) {
          const autoFill = await checkCalculatedColumnAutoFill(sheetId, row, col, value, workbook);
          if (autoFill) {
            await ws.tables.setCalculatedColumn(autoFill.tableId, autoFill.columnIndex, value);
          }
        }
      },
      setDateValue: async (sheetId, row, col, isoDate, kind) => {
        const ws = workbook.getSheetById(sheetId);
        if (kind === 'datetime') {
          const current = ws.viewport.getCellData(row, col)?.value;
          const fraction =
            typeof current === 'number' && Number.isFinite(current)
              ? current - Math.floor(current)
              : 0;
          if (fraction > 0) {
            const { dateComponentsToSerial } = await import('@mog/spreadsheet-utils/datetime');
            const [year, month, day] = isoDate.split('-').map(Number);
            await withSelectionCheckpoint(cellCheckpoint(sheetId, row, col), () =>
              ws.setCell(row, col, String(dateComponentsToSerial(year, month, day) + fraction)),
            );
            return;
          }
        }
        await withSelectionCheckpoint(cellCheckpoint(sheetId, row, col), () =>
          ws.setDateValue(row, col, isoDate),
        );
      },
      // Set pending undo description for next action
      setPendingUndoDescription: (description) => {
        workbook.setPendingUndoDescription(description);
      },
      // Validate a candidate cell value against its covering schema via the
      // public Worksheet API. Returns null when no rule covers the cell so the
      // editor commit pipeline auto-succeeds.
      //
      // The public API surfaces `errorStyle` ("stop" | "warning" | "information"
      // | "none") — we translate to the editor coordinator's internal
      // `enforcement` vocabulary here.
      validateCellValue: async (sheetId, row, col, value) => {
        const result = await workbook.getSheetById(sheetId).validations.validate(row, col, value);
        if (result.errorStyle === 'none') {
          // No rule covers this cell — auto-succeed.
          return null;
        }
        const enforcement: 'strict' | 'warning' | 'info' | 'none' =
          result.errorStyle === 'stop'
            ? 'strict'
            : result.errorStyle === 'warning'
              ? 'warning'
              : 'info';
        return {
          valid: result.valid,
          errorMessage: result.errorMessage,
          errorTitle: result.errorTitle,
          enforcement,
        };
      },
      validateCircularReference: async (sheetId, row, col, formula) => {
        if (!formula.trimStart().startsWith('=')) {
          return null;
        }

        if (await workbook.getIterativeCalculation()) {
          return null;
        }

        return workbook.getSheetById(sheetId).validateFormulaCircularReference(formula, row, col);
      },
      // Validate authored formula text against the Rust parser before the
      // commit reaches the mutation path. The mutation path intentionally still
      // normalizes formulas for import/programmatic writes; interactive commits
      // must reject raw incomplete syntax first.
      validateFormulaSyntax: async (sheetId, formula, row, col) => {
        const ws = workbook.getSheetById(sheetId);
        const syntaxResult = await ws.validateFormulaSyntax(formula);
        if (!syntaxResult) return null;

        if (!hasImplicitRowStructuredReference(formula)) {
          return syntaxResult;
        }

        const context = await resolveCalculatedColumnCellContext(sheetId, row, col, workbook, {
          requireAutoCalculatedColumns: true,
        });
        if (!context) {
          return syntaxResult;
        }

        const qualifiedFormula = qualifyImplicitRowStructuredReferences(formula, context.tableName);
        const qualifiedSyntaxResult = await ws.validateFormulaSyntax(qualifiedFormula);
        return qualifiedSyntaxResult ? syntaxResult : null;
      },
      // Show validation error dialog for strict enforcement
      onValidationError: (message, title, onRetry, onCancel) => {
        showValidationError(message, title, onRetry, onCancel, 'stop');
      },
      // Show validation warning dialog for warning enforcement (Yes / No / Cancel)
      onValidationWarning: (message, title, onProceed, onCancel, onRetry) => {
        showValidationWarning(message, title, 'warning', onProceed, onCancel, onRetry);
      },
      // Show validation information dialog for info enforcement (OK / Cancel)
      onValidationInformation: (message, title, onProceed, onCancel) => {
        showValidationWarning(message, title, 'information', onProceed, onCancel);
      },
      onFormulaError: (formula, errorMessage, onEdit, onAcceptAsText, onCancel, errorPosition) => {
        showFormulaError(formula, errorMessage, onEdit, onAcceptAsText, onCancel, errorPosition);
      },
      onCircularReferenceWarning: (cellAddress, formula, onEnableIterative, onCancel) => {
        showCircularReferenceDialog(
          cellAddress,
          formula,
          () => {
            void workbook
              .setIterativeCalculation(true)
              .then(() => workbook.calculate())
              .then(() => {
                onEnableIterative();
              })
              .catch((error) => {
                console.error(
                  '[SpreadsheetCoordinatorProvider] Failed to enable iterative calculation',
                  error,
                );
                onCancel();
              });
          },
          onCancel,
        );
      },
      // Enter a CSE (Ctrl+Shift+Enter) array formula on the selected
      // range. Routes through the Worksheet API to Rust
      // `compute-core::set_array_formula` — the engine marks the
      // anchor in `mirror.cse_anchors` and registers the projection
      // extent. The formula bar reads `metadata.region.kind` off the
      // active cell to render `{=…}` braces (D5); the editor.ts
      // partial-write guard surfaces
      // `ComputeError::PartialArrayWrite` on rejected member writes.
      // No client-side `arrayFormulaCells` registry, no
      // `__dt.getCellValue` monkey-patch.
      setArrayFormula: (sheetId, range, formulaValue) => {
        const ws = workbook.getSheetById(sheetId);
        return withSelectionCheckpoint(rangeCheckpoint(sheetId, range), () =>
          ws.setArrayFormula(
            {
              startRow: range.startRow,
              startCol: range.startCol,
              endRow: range.endRow,
              endCol: range.endCol,
            },
            formulaValue,
          ),
        );
      },
    };
  }, [
    workbook,
    pendingSelectionCheckpointRef,
    showCircularReferenceDialog,
    showFormulaError,
    showValidationError,
    showValidationWarning,
  ]);

  return (
    <>
      <BaseCoordinatorProvider
        initialSheetId={activeSheetId}
        platform={platformIdentity.os}
        onMetric={onMetric}
        uiStoreApi={uiStoreApi}
        importDurability={importDurability}
        editorDependencies={editorDependencies}
        enableKeyboard={enableKeyboard}
        onUIAction={onUIAction}
        // Explicit clipboard wiring - same pattern as other features
        clipboardDependencies={{
          getActiveSheetId: () => uiStoreApi.getState().activeSheetId,
          // Cut-paste overwrite confirmation: open the dialog with pending data.
          // The Confirm/Cancel handlers (CONFIRM_PASTE_OVERWRITE / CANCEL_PASTE_OVERWRITE)
          // close the dialog and either re-fire paste with skipOverwriteCheck=true
          // or clear the clipboard.
          onCutOverwriteConfirm: (pendingData) => {
            uiStoreApi.getState().openPasteOverwriteConfirmDialog({
              targetCell: pendingData.targetCell,
              sheetId: pendingData.sheetId,
              pasteOptions: pendingData.pasteOptions,
            });
          },
          onProtectionError: (message) => {
            uiStoreApi.getState().showProtectionAlert(message);
          },
        }}
        workbook={workbook}
        readOnly={readOnly}
      >
        <KeyboardCaptureSetup workbook={workbook}>
          <UndoSelectionCoordinatorSetup
            pendingSelectionCheckpointRef={pendingSelectionCheckpointRef}
          >
            <RangeSelectionCoordinatorSetup>
              <PaneNavigationSetup>
                <CollabPresenceBridge>{children}</CollabPresenceBridge>
              </PaneNavigationSetup>
            </RangeSelectionCoordinatorSetup>
          </UndoSelectionCoordinatorSetup>
        </KeyboardCaptureSetup>
      </BaseCoordinatorProvider>
      <CircularReferenceDialog
        state={circularReferenceDialogState}
        onEnableIterative={handleEnableIterative}
        onCancel={handleCircularReferenceCancel}
        iterativeSettings={{ maxIterations: 100, maxChange: 0.001 }}
      />
    </>
  );
}

// Re-export the hook for convenience
