/**
 * Editor Machine Formula Editing
 *
 * Actions and utilities for formula-specific editing behavior including:
 * - Formula parsing and tokenization
 * - Range reference highlighting with colors
 * - Formula range navigation and selection
 * - Cell reference conversion (relative/absolute)
 * - Formula validation
 *
 * Helper functions extracted from editor-machine.ts
 * Formula editing actions extracted from editor-machine.ts
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import { FORMULA_RANGE_COLORS } from '@mog-sdk/contracts/machines';
import { getNextFormulaRangeColor } from '@mog/spreadsheet-utils/machines/types';
import { assign } from 'xstate';

import { cellRangeToSheetA1 } from '@mog/spreadsheet-utils/a1';

import { rangeToA1 } from '../../../shared/types';
import {
  analyzeFormulaContext,
  extractFormulaRanges,
  updateFormulaReference,
} from '../../../shared/utils';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if the current value is a formula.
 * Excel treats =, +, and - as formula starters.
 *
 */
export function isFormula(value: string): boolean {
  const firstChar = value.charAt(0);
  return firstChar === '=' || firstChar === '+' || firstChar === '-';
}

const REFERENCE_EXPECTING_CHARS = new Set([
  '=',
  '(',
  ',',
  '+',
  '-',
  '*',
  '/',
  '&',
  '^',
  '<',
  '>',
  '%',
]);

export function isCursorAtReferencePosition(value: string, cursorPosition: number): boolean {
  if (cursorPosition <= 0) return false;
  let i = cursorPosition - 1;
  while (i >= 0 && value[i] === ' ') i--;
  if (i < 0) return false;
  return REFERENCE_EXPECTING_CHARS.has(value[i]);
}

/**
 * Insert a range reference at the cursor position in a formula
 */
export function insertRangeAtCursor(
  value: string,
  cursorPosition: number,
  rangeText: string,
): { newValue: string; newCursorPosition: number } {
  const before = value.slice(0, cursorPosition);
  const after = value.slice(cursorPosition);
  const newValue = before + rangeText + after;
  return {
    newValue,
    newCursorPosition: cursorPosition + rangeText.length,
  };
}

/**
 * Regex to match cell references in formulas.
 * Matches: A1, $A1, A$1, $A$1, Sheet1!A1, 'Sheet Name'!A1
 * Also matches ranges: A1:B2, $A$1:$B$2
 *
 * Groups:
 * - Full match includes the reference
 * - We need to preserve sheet prefix if present
 */
export const CELL_REF_PATTERN =
  /(?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)!)?\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?/gi;

/**
 * Cycle a single cell reference through absolute/relative modes.
 * A1 -> $A$1 -> A$1 -> $A1 -> A1
 *
 * @param ref - Cell reference like A1, $A$1, A$1, or $A1
 * @returns The next reference in the cycle
 */
export function cycleRefMode(ref: string): string {
  // Extract sheet prefix if present (e.g., "Sheet1!" or "'Sheet Name'!")
  const sheetMatch = ref.match(/^(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)!/);
  const sheetPrefix = sheetMatch ? sheetMatch[0] : '';
  const refWithoutSheet = sheetPrefix ? ref.slice(sheetPrefix.length) : ref;

  // Check if it's a range (contains :)
  if (refWithoutSheet.includes(':')) {
    const [start, end] = refWithoutSheet.split(':');
    return sheetPrefix + cycleRefMode(start) + ':' + cycleRefMode(end);
  }

  // Parse the reference: optional $ + letters + optional $ + digits
  const match = refWithoutSheet.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/i);
  if (!match) return ref; // Can't parse, return as-is

  const [, colAbsolute, col, rowAbsolute, row] = match;
  const hasColAbsolute = colAbsolute === '$';
  const hasRowAbsolute = rowAbsolute === '$';

  // Cycle order: relative -> all absolute -> row absolute -> col absolute -> relative
  // A1 -> $A$1 -> A$1 -> $A1 -> A1
  if (!hasColAbsolute && !hasRowAbsolute) {
    // A1 -> $A$1
    return sheetPrefix + '$' + col.toUpperCase() + '$' + row;
  } else if (hasColAbsolute && hasRowAbsolute) {
    // $A$1 -> A$1
    return sheetPrefix + col.toUpperCase() + '$' + row;
  } else if (!hasColAbsolute && hasRowAbsolute) {
    // A$1 -> $A1
    return sheetPrefix + '$' + col.toUpperCase() + row;
  } else {
    // $A1 -> A1
    return sheetPrefix + col.toUpperCase() + row;
  }
}

/**
 * Find and cycle the reference at or near the cursor position.
 * F4 behavior in Excel: finds the reference containing/adjacent to cursor and cycles it.
 *
 * @param value - The formula string
 * @param cursorPosition - Current cursor position in the string
 * @returns Updated value and cursor position, or null if no reference found
 */
export function cycleReferenceAtCursor(
  value: string,
  cursorPosition: number,
): { newValue: string; newCursorPosition: number } | null {
  // Find all cell references in the formula
  const matches: Array<{ match: string; start: number; end: number }> = [];

  let match: RegExpExecArray | null;
  // Reset regex lastIndex for global pattern
  CELL_REF_PATTERN.lastIndex = 0;

  while ((match = CELL_REF_PATTERN.exec(value)) !== null) {
    matches.push({
      match: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (matches.length === 0) return null;

  // Find the reference that contains the cursor, or is closest to the left of cursor
  let targetRef: (typeof matches)[0] | null = null;

  // First, check if cursor is within a reference
  for (const m of matches) {
    if (cursorPosition >= m.start && cursorPosition <= m.end) {
      targetRef = m;
      break;
    }
  }

  // If not within a reference, find the closest reference to the left
  if (!targetRef) {
    for (const m of matches) {
      if (m.end <= cursorPosition) {
        targetRef = m;
      } else {
        break;
      }
    }
  }

  // If still no reference found, use the first one if cursor is before it
  if (!targetRef && matches.length > 0) {
    targetRef = matches[0];
  }

  if (!targetRef) return null;

  // Cycle the reference
  const cycledRef = cycleRefMode(targetRef.match);

  // Build new value
  const before = value.slice(0, targetRef.start);
  const after = value.slice(targetRef.end);
  const newValue = before + cycledRef + after;

  // Adjust cursor position - keep it at the end of the reference
  const lengthDiff = cycledRef.length - targetRef.match.length;
  let newCursorPosition = cursorPosition;

  if (cursorPosition > targetRef.start) {
    if (cursorPosition >= targetRef.end) {
      // Cursor was after the reference
      newCursorPosition = cursorPosition + lengthDiff;
    } else {
      // Cursor was within the reference - move to end of cycled reference
      newCursorPosition = targetRef.start + cycledRef.length;
    }
  }

  return { newValue, newCursorPosition };
}

// =============================================================================
// ACTION IMPLEMENTATIONS
// =============================================================================

/**
 * Insert formula range reference at cursor.
 * Called when user clicks a cell/range while in formula editing mode.
 *
 * Uses structuredRef if provided (for table references),
 * otherwise falls back to A1 notation.
 */
export const insertFormulaRange = assign(({ context, event }) => {
  if (event.type !== 'FORMULA_RANGE_SELECTED') return {};
  // Use structured reference if provided, otherwise fall back to A1.
  // When the target sheet differs from the editing origin sheet, produce
  // a sheet-qualified reference like Sheet2!A1 or 'Sheet Name'!A1:B3.
  let rangeText: string;
  if (event.structuredRef) {
    rangeText = event.structuredRef;
  } else if (
    event.sheetId &&
    event.sheetName &&
    context.sheetId &&
    event.sheetId !== context.sheetId
  ) {
    rangeText = cellRangeToSheetA1(event.range, event.sheetName);
  } else {
    rangeText = rangeToA1(event.range);
  }

  const isReplacingActiveRef =
    context.formulaRefInsertStart !== null &&
    context.formulaRefInsertEnd !== null &&
    context.cursorPosition === context.formulaRefInsertEnd;

  if (
    !isReplacingActiveRef &&
    !isCursorAtReferencePosition(context.value, context.cursorPosition)
  ) {
    return {};
  }

  let newValue: string;
  let newCursorPosition: number;
  let insertStart: number;

  if (isReplacingActiveRef) {
    // Replace the previous reference
    const before = context.value.slice(0, context.formulaRefInsertStart!);
    const after = context.value.slice(context.formulaRefInsertEnd!);
    newValue = before + rangeText + after;
    insertStart = context.formulaRefInsertStart!;
    newCursorPosition = insertStart + rangeText.length;
  } else {
    // Insert at cursor (first arrow or after typing an operator)
    insertStart = context.cursorPosition;
    const result = insertRangeAtCursor(context.value, context.cursorPosition, rangeText);
    newValue = result.newValue;
    newCursorPosition = result.newCursorPosition;
  }

  // Don't cycle color when replacing — we're adjusting the same reference
  const colorUpdate = isReplacingActiveRef
    ? {}
    : (() => {
        const { color, nextIndex } = getNextFormulaRangeColor(context.rangeColorIndex);
        return { currentRangeColor: color, rangeColorIndex: nextIndex };
      })();

  return {
    value: newValue,
    cursorPosition: newCursorPosition,
    formulaRefInsertStart: insertStart,
    formulaRefInsertEnd: newCursorPosition,
    ...colorUpdate,
  };
});

/**
 * Advance to the next formula range color.
 * Used when inserting multiple ranges in a formula.
 */
export const advanceFormulaRangeColor = assign(({ context }) => {
  const { color, nextIndex } = getNextFormulaRangeColor(context.rangeColorIndex);
  return {
    currentRangeColor: color,
    rangeColorIndex: nextIndex,
  };
});

/**
 * Reset formula range colors to the first color.
 * Called when entering formula editing mode.
 */
export const resetFormulaColors = assign({
  rangeColorIndex: 0,
  currentRangeColor: FORMULA_RANGE_COLORS[0],
});

/**
 * Cycle the reference at cursor through absolute/relative modes (F4).
 * A1 -> $A$1 -> A$1 -> $A1 -> A1
 */
export const cycleReference = assign(({ context }) => {
  const result = cycleReferenceAtCursor(context.value, context.cursorPosition);
  if (!result) return {}; // No reference found, no change
  return {
    value: result.newValue,
    cursorPosition: result.newCursorPosition,
  };
});

/**
 * Set array formula flag and store commit direction.
 * Called when user presses Ctrl+Shift+Enter to commit as array formula.
 */
export const setArrayFormulaAndCommit = assign({
  isArrayFormula: true,
  commitDirection: 'down' as 'up' | 'down' | 'left' | 'right' | 'none' | null,
});

/**
 * Reset array formula flag (included in resetContext but explicit for clarity).
 * Resets to normal formula mode.
 */
export const resetArrayFormulaFlag = assign({
  isArrayFormula: false,
});

/**
 * Update a formula range reference after drag-resize.
 * C.3/H.3: Range box dragging to edit formula references.
 *
 * @param value - The formula string
 * @param rangeIndex - Index of the reference in the formula
 * @param newRange - The new range coordinates after drag
 */
export function updateFormulaRangeReference(
  value: string,
  rangeIndex: number,
  newRange: CellRange,
): { newValue: string; newCursorPosition: number } | null {
  const references = extractFormulaRanges(value);
  const reference = references.find((r) => r.index === rangeIndex);

  if (!reference) {
    return null;
  }

  const result = updateFormulaReference(value, reference, newRange, true);
  // Rename from newFormula to newValue for consistency with action return type
  return {
    newValue: result.newFormula,
    newCursorPosition: result.newCursorPosition,
  };
}

/**
 * Action to update a formula range reference.
 * Called when user drags a formula range box to resize/move it.
 * C.3/H.3: Range box dragging to edit formula references.
 */
export const updateFormulaRangeAction = assign(({ context, event }) => {
  if (event.type !== 'UPDATE_FORMULA_RANGE') return {};

  const result = updateFormulaRangeReference(context.value, event.rangeIndex, event.newRange);

  if (!result) return {};

  return {
    value: result.newValue,
    cursorPosition: result.newCursorPosition,
    // Update formula context with new cursor position
    formulaContext: analyzeFormulaContext(result.newValue, result.newCursorPosition),
  };
});

/**
 * Insert function argument placeholders at cursor position.
 * When cursor is after a function name like "SUM(", inserts argument hints.
 * Example: "=SUM(" -> "=SUM(number1, [number2], ...)"
 *
 * Uses injected functionRegistry from context instead of direct globalRegistry import.
 */
export const insertFunctionArgs = assign(({ context }) => {
  // Only works when inside a function (cursor after opening paren)
  const funcName = context.formulaContext?.currentFunction;
  if (!funcName) {
    return {}; // Not inside a function, do nothing
  }

  // Use injected function registry instead of direct import
  // This decouples machines from calculator-engine
  const registry = context.functionRegistry;
  if (!registry) {
    return {}; // Registry not injected, do nothing
  }

  const metadata = registry.getMetadata(funcName);

  if (!metadata) {
    return {}; // Unknown function, do nothing
  }

  // Generate argument placeholder string
  const minArgs = metadata.minArgs ?? 0;
  const maxArgs = metadata.maxArgs ?? minArgs;

  let argsStr = '';
  if (minArgs === 0 && maxArgs === 0) {
    // No arguments
    argsStr = '';
  } else if (maxArgs === Infinity) {
    // Variadic function like SUM, AVERAGE
    argsStr = 'number1, [number2], ...';
  } else {
    // Fixed argument count
    const args: string[] = [];
    for (let i = 0; i < maxArgs; i++) {
      const isOptional = i >= minArgs;
      args.push(isOptional ? `[arg${i + 1}]` : `arg${i + 1}`);
    }
    argsStr = args.join(', ');
  }

  // Insert at cursor position
  const before = context.value.slice(0, context.cursorPosition);
  const after = context.value.slice(context.cursorPosition);
  const newValue = before + argsStr + after;
  const newCursorPosition = context.cursorPosition + argsStr.length;

  return {
    value: newValue,
    cursorPosition: newCursorPosition,
    selectionAnchor: newCursorPosition,
    hasSelection: false,
    // Update formula context
    formulaContext: analyzeFormulaContext(newValue, newCursorPosition),
  };
});

// =============================================================================
// ACTIONS OBJECT FOR MACHINE CONFIG
// =============================================================================

/**
 * Formula editing actions for use in the editor machine.
 * Export as a single object for easy integration.
 */
export const formulaEditingActions = {
  insertFormulaRange,
  advanceFormulaRangeColor,
  resetFormulaColors,
  cycleReference,
  setArrayFormulaAndCommit,
  resetArrayFormulaFlag,
  insertFunctionArgs,
  // C.3/H.3: Range box dragging to edit formula references
  updateFormulaRange: updateFormulaRangeAction,
};
