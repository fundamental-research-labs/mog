/**
 * Column Values Autocomplete Hook
 *
 * I.1: Previously entered values in column suggested.
 * React hook for suggesting previously entered values from the same column
 * as the user types in a cell.
 *
 * Design principles:
 * - Only shows suggestions for text values (not formulas)
 * - Filters based on what the user is typing
 * - Tab/Enter accepts the current suggestion
 * - Different from formula autocomplete - this is for plain text entry
 *
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Worksheet } from '@mog-sdk/contracts/api';

import { useActiveSheetId, useWorkbook } from '../../infra/context';
import { useEditor } from './use-editor';

// =============================================================================
// TYPES
// =============================================================================

export interface ColumnValueSuggestion {
  /** The value string */
  value: string;
  /** Row where this value appears (for reference) */
  rowIndex: number;
}

export interface UseColumnValuesAutocompleteReturn {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Whether suggestions should be shown */
  showSuggestions: boolean;

  /** Filtered suggestions based on current input */
  suggestions: ColumnValueSuggestion[];

  /** Currently highlighted suggestion index */
  highlightedIndex: number;

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Accept a suggestion value (inserts into editor) */
  acceptSuggestion: (value: string) => void;

  /** Navigate to next/previous suggestion */
  navigateSuggestion: (direction: 'up' | 'down') => void;

  /** Dismiss the suggestions dropdown */
  dismissSuggestions: () => void;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum number of unique values to scan in a column */
const MAX_ROWS_TO_SCAN = 10000;

/** Maximum number of suggestions to show */
const MAX_SUGGESTIONS = 10;

/** Minimum characters before showing suggestions */
const MIN_CHARS_FOR_SUGGESTIONS = 1;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get unique text values from a column via the Worksheet API.
 *
 * Uses ws.getRange() to fetch the entire column span in one call.
 *
 * @param ws - Worksheet instance
 * @param col - Column index
 * @param excludeRow - Row to exclude (the current editing row)
 * @returns Promise resolving to array of unique text values
 */
async function getColumnTextValues(
  ws: Worksheet,
  col: number,
  excludeRow: number,
): Promise<string[]> {
  const uniqueValues = new Set<string>();

  // Query the entire column range in one call
  const rangeData = await ws.getRange(0, col, MAX_ROWS_TO_SCAN - 1, col);

  for (let row = 0; row < rangeData.length; row++) {
    if (row === excludeRow) continue;

    const cell = rangeData[row][0];
    if (!cell) continue;

    // Only include non-empty string text values (not formulas).
    // formula indicates the cell value is a formula result — skip those.
    // We want user-entered text only.
    const rawValue = cell.value;
    if (typeof rawValue === 'string' && rawValue && !cell.formula) {
      uniqueValues.add(rawValue);
    }
  }

  return Array.from(uniqueValues).sort();
}

/**
 * Filter suggestions based on current input.
 *
 * @param allValues - All unique values in column
 * @param currentInput - Current input text
 * @returns Filtered and ranked suggestions
 */
function filterSuggestions(allValues: string[], currentInput: string): ColumnValueSuggestion[] {
  if (!currentInput || currentInput.length < MIN_CHARS_FOR_SUGGESTIONS) {
    return [];
  }

  const inputLower = currentInput.toLowerCase();

  // Filter values that start with the input (case insensitive)
  const matches = allValues
    .filter((value) => value.toLowerCase().startsWith(inputLower))
    .filter((value) => value.toLowerCase() !== inputLower) // Exclude exact matches
    .slice(0, MAX_SUGGESTIONS);

  return matches.map((value, index) => ({
    value,
    rowIndex: index, // Just for key purposes, not actual row
  }));
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for column values autocomplete.
 *
 * Shows suggestions from previously entered values in the same column
 * as the user types in a cell.
 *
 * @example
 * ```tsx
 * function CellEditor() {
 * const {
 * showSuggestions,
 * suggestions,
 * highlightedIndex,
 * acceptSuggestion,
 * navigateSuggestion
 * } = useColumnValuesAutocomplete;
 *
 * return (
 * <>
 * <input ... />
 * {showSuggestions && suggestions.length > 0 && (
 * <ColumnValueSuggestions
 * suggestions={suggestions}
 * highlightedIndex={highlightedIndex}
 * onSelect={acceptSuggestion}
 * />
 * )}
 * </>
 * );
 * }
 * ```
 */
export function useColumnValuesAutocomplete(): UseColumnValuesAutocompleteReturn {
  const wb = useWorkbook();
  const editor = useEditor();
  const activeSheetId = useActiveSheetId();

  // Get editing context
  const editingCell = editor.editingCell;
  const editorValue = editor.value;
  const isEditing = editor.isEditing;
  const isFormulaEditing = editor.isFormulaEditing;

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE: Track highlighted index locally (not in editor machine to keep it simple)
  // ═══════════════════════════════════════════════════════════════════════════

  // Note: For a full implementation, this would be tracked in the editor machine
  // For now, we'll track it locally and it resets when suggestions change
  const highlightedIndex = 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTED: Get column values and filter suggestions
  // ═══════════════════════════════════════════════════════════════════════════

  // Get all unique values in the current column
  const [columnValues, setColumnValues] = useState<string[]>([]);

  useEffect(() => {
    if (!editingCell || !activeSheetId || !isEditing) {
      setColumnValues([]);
      return;
    }

    let cancelled = false;
    const ws = wb.getSheetById(activeSheetId);
    void getColumnTextValues(ws, editingCell.col, editingCell.row).then((values) => {
      if (!cancelled) {
        setColumnValues(values);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [wb, activeSheetId, editingCell, isEditing]);

  // Filter suggestions based on current input
  const suggestions = useMemo((): ColumnValueSuggestion[] => {
    // Don't show for formulas or empty input
    if (isFormulaEditing || !editorValue) {
      return [];
    }

    return filterSuggestions(columnValues, editorValue);
  }, [columnValues, editorValue, isFormulaEditing]);

  // Should show suggestions?
  const showSuggestions = useMemo((): boolean => {
    return (
      isEditing &&
      !isFormulaEditing &&
      editorValue.length >= MIN_CHARS_FOR_SUGGESTIONS &&
      suggestions.length > 0
    );
  }, [isEditing, isFormulaEditing, editorValue, suggestions.length]);

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const acceptSuggestion = useCallback(
    (value: string) => {
      // Update editor value with the selected suggestion
      editor.input(value, value.length);
    },
    [editor],
  );

  const navigateSuggestion = useCallback((_direction: 'up' | 'down') => {
    // For a full implementation, this would update the highlighted index
    // in the editor machine. For now, it's a no-op placeholder.
    // TODO: Implement proper navigation state in editor machine
  }, []);

  const dismissSuggestions = useCallback(() => {
    // For a full implementation, this would hide suggestions
    // by setting a flag in the editor machine
    // TODO: Implement dismiss state in editor machine
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      showSuggestions,
      suggestions,
      highlightedIndex,
      acceptSuggestion,
      navigateSuggestion,
      dismissSuggestions,
    }),
    [
      showSuggestions,
      suggestions,
      highlightedIndex,
      acceptSuggestion,
      navigateSuggestion,
      dismissSuggestions,
    ],
  );
}
