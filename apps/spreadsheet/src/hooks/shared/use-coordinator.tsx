/**
 * Coordinator Provider and Hook
 *
 * Provides the SheetCoordinator instance to all child components via React Context.
 * The coordinator owns all XState actors and handles cross-machine communication.
 *
 * Usage:
 * ```tsx
 * // At app root
 * <CoordinatorProvider doc={doc} initialSheetId="sheet1">
 * <SpreadsheetApp />
 * </CoordinatorProvider>
 *
 * // In any child
 * const coordinator = useCoordinator();
 * const selectionActor = coordinator.getSelectionActor();
 * ```
 *
 * @see ARCHITECTURE.md - Coordinator Pattern
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { StoreApi } from 'zustand';

import {
  SheetCoordinator,
  createSheetCoordinator as createFullCoordinator,
} from '../../coordinator';
import type {
  ClipboardDependencies,
  EditorDependencies,
  SheetSwitchImportDurabilityGate,
} from '../../coordinator/types';
import type { Platform } from '@mog-sdk/contracts/platform';
import type { Metric } from '../../systems/shared/types';
import type { UIState } from '../../ui-store';

// =============================================================================
// RE-EXPORT TYPES FROM FULL COORDINATOR
// =============================================================================

export type { SheetCoordinator } from '../../coordinator';

/**
 * Configuration for creating a SheetCoordinator.
 */
export interface SheetCoordinatorConfig {
  /** Initial sheet ID to display */
  initialSheetId: string;
  /** Keyboard platform for shortcut resolution (e.g., 'macos' uses Cmd, 'windows' uses Ctrl) */
  platform?: Platform;
  /** Optional callback for metrics/observability */
  onMetric?: (metric: Metric) => void;
  /** UI store API for sheet switch coordination (per-sheet view state) */
  uiStoreApi?: StoreApi<UIState>;
  /** Import durability gate for host-backed XLSX documents. */
  importDurability?: SheetSwitchImportDurabilityGate;
  /** Editor dependencies for commit coordination and schema lookup */
  editorDependencies?: EditorDependencies;
  /**
   * Explicitly enable keyboard coordinator.
   * When true, keyboard shortcuts and navigation will be active.
   */
  enableKeyboard?: boolean;
  /**
   * Callback to trigger UI-level actions (open find dialog, etc.)
   * Used by keyboard coordinator and action system.
   */
  onUIAction?: (action: string) => void;
  /**
   * Clipboard dependencies for copy/cut/paste operations.
   * Required for clipboard functionality.
   */
  clipboardDependencies?: ClipboardDependencies;

  /** Unified Workbook API for data operations */
  workbook: import('@mog-sdk/contracts/api').WorkbookInternal;

  /** When true, blocks mutating operations (read-only mode). */
  readOnly?: boolean;
}

/**
 * Creates a SheetCoordinator instance using the full implementation
 * from state/coordinator/index.ts with cross-machine coordination.
 */
export function createSheetCoordinator(config: SheetCoordinatorConfig): SheetCoordinator {
  return createFullCoordinator({
    initialSheetId: config.initialSheetId,
    platform: config.platform,
    onMetric: config.onMetric,
    // Pass sheet switch dependencies if uiStoreApi is provided
    sheetSwitchDependencies: config.uiStoreApi
      ? { uiStoreApi: config.uiStoreApi, importDurability: config.importDurability }
      : undefined,
    // Pass toolbar dependencies (independent of sheet switch) if uiStoreApi is provided
    toolbarDependencies: config.uiStoreApi ? { uiStoreApi: config.uiStoreApi } : undefined,
    // Inject browser confirm dialog for destructive operations (H4: testable coordinator)
    confirmDialog: (message: string) => window.confirm(message),
    // Pass editor dependencies for commit coordination and schema lookup
    editorDependencies: config.editorDependencies,
    // Decoupled dependencies (coordinator-dependency-decoupling.md)
    enableKeyboard: config.enableKeyboard,
    onUIAction: config.onUIAction,
    // Derive active sheet ID getter from UI store (avoids stale initialSheetId)
    getActiveSheetId: config.uiStoreApi
      ? () => config.uiStoreApi!.getState().activeSheetId
      : undefined,
    // Explicit clipboard wiring
    clipboardDependencies: config.clipboardDependencies,
    // Unified Workbook API
    workbook: config.workbook,
    // Read-only mode
    readOnly: config.readOnly,
  });
}

// =============================================================================
// REACT CONTEXT
// =============================================================================

const CoordinatorContext = createContext<SheetCoordinator | null>(null);

// =============================================================================
// PROVIDER COMPONENT
// =============================================================================

export interface CoordinatorProviderProps {
  /** Child components */
  children: ReactNode;
  /** Initial sheet ID to display */
  initialSheetId: string;
  /** Keyboard platform for shortcut resolution (e.g., 'macos' uses Cmd, 'windows' uses Ctrl) */
  platform?: Platform;
  /** Optional callback for metrics/observability */
  onMetric?: (metric: Metric) => void;
  /** UI store API for sheet switch coordination (per-sheet view state) */
  uiStoreApi?: StoreApi<UIState>;
  /** Import durability gate for host-backed XLSX documents. */
  importDurability?: SheetSwitchImportDurabilityGate;
  /** Editor dependencies for commit coordination and schema lookup */
  editorDependencies?: EditorDependencies;
  /**
   * Explicitly enable keyboard coordinator.
   * When true, keyboard shortcuts and navigation will be active.
   */
  enableKeyboard?: boolean;
  /**
   * Callback to trigger UI-level actions (open find dialog, etc.)
   * Used by keyboard coordinator and action system.
   */
  onUIAction?: (action: string) => void;
  /**
   * Clipboard dependencies for copy/cut/paste operations.
   * Required for clipboard functionality.
   */
  clipboardDependencies?: SheetCoordinatorConfig['clipboardDependencies'];

  /** Unified Workbook API for data operations */
  workbook: import('@mog-sdk/contracts/api').WorkbookInternal;

  /** When true, blocks mutating operations (read-only mode). */
  readOnly?: boolean;
}

/**
 * Provides the SheetCoordinator to all child components.
 *
 * Creates the coordinator on mount, disposes on unmount.
 * The coordinator instance is stable across re-renders.
 *
 * @example
 * ```tsx
 * function App() {
 * const doc = useMemo( => createDoc, []);
 * return (
 * <CoordinatorProvider doc={doc} initialSheetId="sheet1">
 * <Spreadsheet />
 * </CoordinatorProvider>
 * );
 * }
 * ```
 */
export function CoordinatorProvider({
  children,
  initialSheetId,
  platform,
  onMetric,
  uiStoreApi,
  importDurability,
  editorDependencies,
  enableKeyboard,
  onUIAction,
  clipboardDependencies,
  workbook,
  readOnly,
}: CoordinatorProviderProps) {
  // Use ref to ensure coordinator is created only once
  const coordinatorRef = useRef<SheetCoordinator | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Create coordinator on mount
    coordinatorRef.current = createSheetCoordinator({
      initialSheetId,
      platform,
      onMetric,
      uiStoreApi,
      importDurability,
      editorDependencies,
      enableKeyboard,
      onUIAction,
      clipboardDependencies,
      workbook,
      readOnly,
    });
    // Expose coordinator for devtools/testing (dev mode only)
    (window as any).__COORDINATOR__ = coordinatorRef.current;
    setIsReady(true);

    // Dispose on unmount
    return () => {
      const coordinator = coordinatorRef.current;
      coordinator?.dispose();
      if ((window as any).__COORDINATOR__ === coordinator) {
        (window as any).__COORDINATOR__ = null;
      }
      coordinatorRef.current = null;
    };
    // Intentionally mount-only (empty deps). The coordinator is a session companion
    // to its Workbook — it must NOT hot-swap workbooks. Document switches are handled
    // by unmounting/remounting the entire SpreadsheetContent tree (via React key on
    // documentId in index.tsx), which disposes this coordinator and creates a fresh one.
  }, []);

  // Don't render children until coordinator is ready
  if (!isReady || !coordinatorRef.current) {
    return null;
  }

  return (
    <CoordinatorContext.Provider value={coordinatorRef.current}>
      {children}
    </CoordinatorContext.Provider>
  );
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Access the SheetCoordinator from any child component.
 *
 * @throws Error if used outside of CoordinatorProvider
 *
 * @example
 * ```tsx
 * function SelectionInfo() {
 * const coordinator = useCoordinator();
 * const actor = coordinator.getSelectionActor;
 * const state = useSelector(actor, (s) => s.context);
 * return <div>Selected: {state.ranges.length} ranges</div>;
 * }
 * ```
 */
export function useCoordinator(): SheetCoordinator {
  const coordinator = useContext(CoordinatorContext);

  if (!coordinator) {
    throw new Error(
      'useCoordinator must be used within a CoordinatorProvider. ' +
        'Wrap your component tree with <CoordinatorProvider>.',
    );
  }

  return coordinator;
}

// Types are already exported inline above
