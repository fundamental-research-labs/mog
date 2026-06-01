/**
 * Formula Autocomplete Hook
 *
 * React hook for formula autocomplete functionality.
 * Reads state from editor machine and provides computed suggestions
 * and actions for function/name completion and argument hints.
 *
 * Design principles:
 * - Reads autocomplete state from editor machine (single source of truth)
 * - Computes suggestions using memoization
 * - Provides actions that send events to editor machine
 * - Uses granular selector with custom equality to prevent scroll re-renders
 *
 * PERFORMANCE OPTIMIZATION:
 * This hook uses a SINGLE useSelector call with a custom equality function
 * to prevent unnecessary re-renders during scroll operations. Without this,
 * the hook would cause 59 unnecessary re-renders during scroll, consuming
 * 39% of total render time.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
 */

import { useSelector } from '@xstate/react';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { globalRegistry } from '@mog/spreadsheet-utils/function-registry';
import { ensureFunctionCatalog } from '@mog/spreadsheet-utils/function-catalog';
import type { FunctionMetadata } from '@mog-sdk/contracts/utils/function-registry';

import type { FormulaContext, FunctionStackEntry } from '@mog-sdk/contracts/actors';
import { editorSelectors } from '../../selectors';
import type { FunctionInfo } from '@mog-sdk/contracts/api';
import type { FunctionArgument } from '@mog-sdk/contracts/utils';
import {
  clampToViewport,
  getAutoCompletePosition,
  type CursorScreenPosition,
} from '../../domain/editor/cursor-position';
import type { ArgumentHintAnchor } from '../../components/editor/FormulaArgumentHint';
import {
  detectTableRefContext,
  formatNameForInsertion,
  getNameSuggestions,
  type NameSuggestion,
} from '../../domain/editor/name-completion';
import {
  createFormulaNameCompletionStore,
  getFormulaMetadataCache,
} from '../../domain/editor/formula-metadata-cache';

import { useWorkbook } from '../../infra/context';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// TYPES
// =============================================================================

export interface UseFormulaAutocompleteReturn {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE (from editor machine)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Formula context computed by analyzeFormulaContext */
  formulaContext: FormulaContext | null;

  /** Whether function suggestions popup should be visible */
  isSuggestionsOpen: boolean;

  /** Whether argument hint tooltip should be visible */
  isArgumentHintOpen: boolean;

  /** Currently selected suggestion index */
  selectedSuggestionIndex: number;

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTED VALUES
  // ═══════════════════════════════════════════════════════════════════════════

  /** Filtered function suggestions based on current prefix */
  functionSuggestions: FunctionInfo[];

  /** Filtered name suggestions (defined names, tables, sheet names) */
  nameSuggestions: NameSuggestion[];

  /** Current function's metadata for argument hint */
  currentFunctionInfo: FunctionInfo | undefined;

  /** Screen position for suggestions popup */
  suggestionsPosition: CursorScreenPosition;

  /** Anchor rect (viewport coords) for the argument hint tooltip, or null. */
  argumentHintAnchor: ArgumentHintAnchor | null;

  /** Preferred placement of the argument hint relative to its anchor. */
  argumentHintPlacement: 'above' | 'below';

  /** Combined suggestion count (functions + names) */
  totalSuggestionCount: number;

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Accept the currently selected suggestion */
  acceptCurrentSuggestion: () => void;

  /** Accept a specific function or name suggestion */
  acceptSuggestion: (name: string, appendOpeningParen?: boolean) => void;

  /** Navigate suggestions up or down */
  navigateSuggestions: (direction: 'up' | 'down') => void;

  /** Dismiss the suggestions popup */
  dismissSuggestions: () => void;

  /** Set ref to input element for precise positioning */
  setInputElement: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
}

// =============================================================================
// INTERNAL STATE TYPE FOR SELECTOR
// =============================================================================

/**
 * State slice extracted from editor actor for autocomplete.
 * Contains only the values needed for autocomplete functionality.
 */
interface AutocompleteStateSlice {
  /** Formula context (function name, argument position, etc.) */
  formulaContext: FormulaContext | null;
  /** Whether function suggestions popup should be visible */
  isSuggestionsOpen: boolean;
  /** Whether argument hint tooltip should be visible */
  isArgumentHintOpen: boolean;
  /** Currently selected suggestion index */
  selectedSuggestionIndex: number;
  /** Current editor value */
  value: string;
  /** Cursor position within the value string */
  cursorPosition: number;
  /** The sheet being edited */
  sheetId: string | null;
}

// =============================================================================
// EQUALITY FUNCTIONS
// =============================================================================

/**
 * Compare two FunctionStackEntry objects for equality.
 */
function functionStackEntryEqual(a: FunctionStackEntry, b: FunctionStackEntry): boolean {
  return a.name === b.name && a.argIndex === b.argIndex && a.parenStart === b.parenStart;
}

/**
 * Compare two FormulaContext objects for deep equality.
 * This is critical for preventing unnecessary re-renders - we must compare
 * ALL fields, including the nested functionStack array.
 */
function formulaContextEqual(a: FormulaContext | null, b: FormulaContext | null): boolean {
  // Handle null cases
  if (a === b) return true; // Both null or same reference
  if (a === null || b === null) return false; // One null, one not

  // Compare primitive fields
  if (a.currentFunction !== b.currentFunction) return false;
  if (a.currentArgIndex !== b.currentArgIndex) return false;
  if (a.functionPrefix !== b.functionPrefix) return false;
  if (a.shouldShowSuggestions !== b.shouldShowSuggestions) return false;
  if (a.shouldShowArgumentHint !== b.shouldShowArgumentHint) return false;

  // Compare functionStack array (deep comparison)
  if (a.functionStack.length !== b.functionStack.length) return false;
  for (let i = 0; i < a.functionStack.length; i++) {
    if (!functionStackEntryEqual(a.functionStack[i], b.functionStack[i])) return false;
  }

  return true;
}

/**
 * Custom equality function for AutocompleteStateSlice comparison.
 * Only returns true (preventing re-render) if all tracked fields are identical.
 *
 * This is CRITICAL for performance:
 * - Without this, FormulaBar re-renders 92 times during type+scroll (59 during scroll alone)
 * - With this, FormulaBar only re-renders when autocomplete state actually changes
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
 */
function autocompleteStateEqual(a: AutocompleteStateSlice, b: AutocompleteStateSlice): boolean {
  return (
    formulaContextEqual(a.formulaContext, b.formulaContext) &&
    a.isSuggestionsOpen === b.isSuggestionsOpen &&
    a.isArgumentHintOpen === b.isArgumentHintOpen &&
    a.selectedSuggestionIndex === b.selectedSuggestionIndex &&
    a.value === b.value &&
    a.cursorPosition === b.cursorPosition &&
    a.sheetId === b.sheetId
  );
}

// =============================================================================
// HELPER: Convert FunctionMetadata to FunctionInfo
// =============================================================================

// Ensure function catalog is loaded at module level (not inside useMemo)
ensureFunctionCatalog();

function metadataToFunctionInfo(meta: FunctionMetadata): FunctionInfo {
  const args: FunctionArgument[] = meta.arguments ?? [];

  // Build syntax string
  let syntax: string;
  if (args.length > 0) {
    const argParts = args.map((arg) => (arg.optional ? `[${arg.name}]` : arg.name));
    syntax = `${meta.name}(${argParts.join(', ')})`;
  } else {
    const min = meta.minArgs ?? 0;
    const max = meta.maxArgs ?? min;
    const argParts: string[] = [];
    for (let i = 0; i < Math.min(max, 5); i++) {
      argParts.push(i < min ? `arg${i + 1}` : `[arg${i + 1}]`);
    }
    if (max > 5) argParts.push('...');
    syntax = `${meta.name}(${argParts.join(', ')})`;
  }

  return {
    name: meta.name,
    category: meta.category,
    description: meta.description,
    syntax,
    arguments: args,
  };
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for formula autocomplete functionality.
 *
 * @example
 * ```tsx
 * function FormulaEditor() {
 * const {
 * isSuggestionsOpen,
 * functionSuggestions,
 * selectedSuggestionIndex,
 * suggestionsPosition,
 * acceptCurrentSuggestion,
 * navigateSuggestions,
 * dismissSuggestions,
 * setInputElement
 * } = useFormulaAutocomplete;
 *
 * return (
 * <>
 * <input ref={setInputElement} />
 * {isSuggestionsOpen && (
 * <FunctionSuggestions
 * prefix={formulaContext?.functionPrefix ?? ''}
 * allFunctions={functionSuggestions}
 * selectedIndex={selectedSuggestionIndex}
 * onSelect={acceptSuggestion}
 * onNavigate={navigateSuggestions}
 * onDismiss={dismissSuggestions}
 * position={suggestionsPosition}
 * />
 * )}
 * </>
 * );
 * }
 * ```
 */
export function useFormulaAutocomplete(): UseFormulaAutocompleteReturn {
  const coordinator = useCoordinator();
  const editorActor = coordinator.grid.access.actors.editor;
  const paneFocusActor = coordinator.input.access.actors.paneFocus;

  // Whether the formula bar (rather than the in-cell editor) owns focus. Used to
  // decide where the argument hint is anchored: below the formula bar when it has
  // focus, above the editing cell otherwise.
  const isFormulaBarFocused = useSelector(paneFocusActor, (state) => state.value === 'formulaBar');

  // Ref to input element for positioning
  const inputElementRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE SELECTOR (SINGLE GRANULAR SUBSCRIPTION)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // PERFORMANCE CRITICAL: This uses a SINGLE useSelector call with a custom
  // equality function instead of 7 separate useSelector calls.
  //
  // Why this matters:
  // - XState useSelector uses reference equality by default
  // - When editor actor processes ANY event, it creates a new state snapshot
  // - Without equality function, all 7 selectors detect "change" and schedule re-render
  // - This caused 92 re-renders (59 during scroll alone) = 39% of total render time
  //
  // Pattern follows useEditorState, useActiveCell, useFocus hooks.
  // @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
  // ═══════════════════════════════════════════════════════════════════════════

  const stateSlice = useSelector(
    editorActor,
    (state): AutocompleteStateSlice => ({
      formulaContext: editorSelectors.formulaContext(state),
      isSuggestionsOpen: editorSelectors.isSuggestionsOpen(state),
      isArgumentHintOpen: editorSelectors.isArgumentHintOpen(state),
      selectedSuggestionIndex: editorSelectors.selectedSuggestionIndex(state),
      value: editorSelectors.value(state),
      cursorPosition: editorSelectors.cursorPosition(state),
      sheetId: editorSelectors.sheetId(state),
    }),
    autocompleteStateEqual,
  );

  // Destructure for use in rest of hook
  const {
    formulaContext,
    isSuggestionsOpen,
    isArgumentHintOpen,
    selectedSuggestionIndex,
    value: editorValue,
    cursorPosition,
    sheetId,
  } = stateSlice;

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTED: Function Suggestions
  // ═══════════════════════════════════════════════════════════════════════════

  // Get all function info from global registry (memoized)
  const allFunctions = useMemo((): FunctionInfo[] => {
    const names = globalRegistry.getAllNames();
    const functions: FunctionInfo[] = [];
    for (const name of names) {
      const meta = globalRegistry.getMetadata(name);
      if (meta) {
        functions.push(metadataToFunctionInfo(meta));
      }
    }
    return functions.sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  // Filter functions by prefix
  const functionSuggestions = useMemo((): FunctionInfo[] => {
    if (!formulaContext?.functionPrefix) return [];

    const prefix = formulaContext.functionPrefix.toUpperCase();
    return allFunctions
      .filter((fn) => fn.name.toUpperCase().startsWith(prefix))
      .sort((a, b) => a.name.length - b.name.length) // Shorter names first (matches FunctionSuggestions score sort)
      .slice(0, 100); // Limit for performance
  }, [allFunctions, formulaContext?.functionPrefix]);

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTED: Name Suggestions
  // ═══════════════════════════════════════════════════════════════════════════

  // Get workbook API for accessing named ranges, tables, and sheets
  const wb = useWorkbook();

  const formulaMetadataCache = useMemo(() => getFormulaMetadataCache(wb), [wb]);
  const subscribeToFormulaMetadata = useCallback(
    (listener: () => void) => formulaMetadataCache.subscribe(listener),
    [formulaMetadataCache],
  );
  const getFormulaMetadataSnapshot = useCallback(
    () => formulaMetadataCache.getSnapshot(),
    [formulaMetadataCache],
  );
  const formulaMetadataSnapshot = useSyncExternalStore(
    subscribeToFormulaMetadata,
    getFormulaMetadataSnapshot,
    getFormulaMetadataSnapshot,
  );

  const shouldRequestFormulaMetadata =
    Boolean(formulaContext?.functionPrefix) && Boolean(sheetId) && isSuggestionsOpen;

  useEffect(() => {
    if (!shouldRequestFormulaMetadata) return;
    if (formulaMetadataSnapshot.status !== 'idle' && formulaMetadataSnapshot.status !== 'error') {
      return;
    }
    void formulaMetadataCache.request().catch(() => {
      // Silent: autocomplete degrades gracefully to function-only suggestions.
    });
  }, [
    formulaMetadataCache,
    formulaMetadataSnapshot.status,
    formulaMetadataSnapshot.version,
    shouldRequestFormulaMetadata,
  ]);

  // Create a store-like adapter for name completion
  // All reads use document-scoped cached async data from Workbook API.
  const nameLookup = useMemo(
    () => createFormulaNameCompletionStore(formulaMetadataSnapshot.metadata),
    [formulaMetadataSnapshot.metadata],
  );

  // Get name suggestions
  const nameSuggestions = useMemo((): NameSuggestion[] => {
    if (!formulaContext?.functionPrefix || !sheetId) return [];

    // Check if we're in a table reference context
    const tableContext = detectTableRefContext(editorValue, cursorPosition);

    return getNameSuggestions(formulaContext.functionPrefix, nameLookup, sheetId, tableContext);
  }, [formulaContext?.functionPrefix, nameLookup, sheetId, editorValue, cursorPosition]);

  // Total suggestion count
  const totalSuggestionCount = functionSuggestions.length + nameSuggestions.length;

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTED: Current Function Info (for argument hint)
  // ═══════════════════════════════════════════════════════════════════════════

  const currentFunctionInfo = useMemo((): FunctionInfo | undefined => {
    if (!formulaContext?.currentFunction) return undefined;
    const meta = globalRegistry.getMetadata(formulaContext.currentFunction);
    if (!meta) return undefined;
    return metadataToFunctionInfo(meta);
  }, [formulaContext?.currentFunction]);

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTED: Popup Positions
  // ═══════════════════════════════════════════════════════════════════════════

  const editingCell = coordinator.grid.getEditorSnapshot().editingCell;
  const geometry = coordinator.renderer.getGeometry();

  // Suggestions position (below input)
  const suggestionsPosition = useMemo((): CursorScreenPosition => {
    // Use geometry capability if available
    const coordLike = geometry
      ? {
          getCellRect: (cell: { row: number; col: number }) => {
            return geometry.getCellRect(cell);
          },
          getContainerRect: () => {
            const container = coordinator.renderer.getContainer();
            return container?.getBoundingClientRect() ?? new DOMRect(0, 0, 800, 600);
          },
        }
      : null;

    const rawPos = getAutoCompletePosition(
      coordLike,
      editingCell ?? { row: 0, col: 0 },
      cursorPosition,
      inputElementRef.current,
    );
    return clampToViewport(rawPos, { width: 400, height: 300 });
  }, [geometry, editingCell, cursorPosition, coordinator]);

  // Argument hint anchor + placement.
  //
  // We hand the hint an anchor rect (viewport coords) and a preferred side; the
  // FormulaArgumentHint component clamps to the viewport using its own measured
  // size, so there are no guessed popup dimensions here.
  //
  // - Formula bar focused: anchor to the formula bar input, prefer BELOW it. The
  //   bar sits at the top of the viewport, so an "above" hint would cover it.
  // - In-cell editing: anchor to the editing cell, prefer ABOVE it.
  const argumentHintPlacement: 'above' | 'below' = isFormulaBarFocused ? 'below' : 'above';
  const argumentHintAnchor = useMemo((): ArgumentHintAnchor | null => {
    const inputEl = inputElementRef.current;
    if (isFormulaBarFocused && inputEl) {
      const rect = inputEl.getBoundingClientRect();
      return { left: rect.left, top: rect.top, bottom: rect.bottom };
    }

    if (geometry) {
      const cellRect = geometry.getCellRect(editingCell ?? { row: 0, col: 0 });
      if (cellRect) {
        const container = coordinator.renderer.getContainer();
        const containerRect = container?.getBoundingClientRect() ?? new DOMRect(0, 0, 800, 600);
        const top = containerRect.top + cellRect.y;
        return { left: containerRect.left + cellRect.x, top, bottom: top + cellRect.height };
      }
    }

    return null;
    // cursorPosition is included so the anchor recomputes as the user types
    // (picking up the input element ref once it is attached), matching
    // suggestionsPosition above.
  }, [geometry, editingCell, coordinator, isFormulaBarFocused, cursorPosition]);

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const acceptSuggestion = useCallback(
    (name: string, appendOpeningParen = true) => {
      editorActor.send({ type: 'ACCEPT_SUGGESTION', name, appendOpeningParen });
    },
    [editorActor],
  );

  const acceptCurrentSuggestion = useCallback(() => {
    const totalSuggestions = functionSuggestions.length + nameSuggestions.length;
    const clampedIndex = Math.min(selectedSuggestionIndex, totalSuggestions - 1);

    if (clampedIndex < 0) return;
    const functionSuggestion = functionSuggestions[clampedIndex];
    if (functionSuggestion) {
      acceptSuggestion(functionSuggestion.name, true);
      return;
    }

    const nameSuggestion = nameSuggestions[clampedIndex - functionSuggestions.length];
    if (nameSuggestion) {
      acceptSuggestion(formatNameForInsertion(nameSuggestion), false);
    }
  }, [functionSuggestions, nameSuggestions, selectedSuggestionIndex, acceptSuggestion]);

  const navigateSuggestions = useCallback(
    (direction: 'up' | 'down') => {
      editorActor.send({ type: 'NAVIGATE_SUGGESTION', direction });
    },
    [editorActor],
  );

  const dismissSuggestions = useCallback(() => {
    editorActor.send({ type: 'HIDE_SUGGESTIONS' });
  }, [editorActor]);

  const setInputElement = useCallback((element: HTMLInputElement | HTMLTextAreaElement | null) => {
    inputElementRef.current = element;
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      // State
      formulaContext,
      isSuggestionsOpen,
      isArgumentHintOpen,
      selectedSuggestionIndex,

      // Computed
      functionSuggestions,
      nameSuggestions,
      currentFunctionInfo,
      suggestionsPosition,
      argumentHintAnchor,
      argumentHintPlacement,
      totalSuggestionCount,

      // Actions
      acceptCurrentSuggestion,
      acceptSuggestion,
      navigateSuggestions,
      dismissSuggestions,
      setInputElement,
    }),
    [
      formulaContext,
      isSuggestionsOpen,
      isArgumentHintOpen,
      selectedSuggestionIndex,
      functionSuggestions,
      nameSuggestions,
      currentFunctionInfo,
      suggestionsPosition,
      argumentHintAnchor,
      argumentHintPlacement,
      totalSuggestionCount,
      acceptCurrentSuggestion,
      acceptSuggestion,
      navigateSuggestions,
      dismissSuggestions,
      setInputElement,
    ],
  );
}
