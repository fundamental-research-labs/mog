/**
 * Editor Machine Cursor Movement
 *
 * Actions for handling cursor movement and text selection within the editor including:
 * - Cursor positioning (arrow keys, home, end)
 * - Text selection (shift + arrow keys, select all)
 * - Mouse-based selection
 * - Navigation between formula references
 *
 * Helper functions extracted from editor-machine.ts
 * Cursor movement and text selection actions extracted
 */

import { assign } from 'xstate';

// =============================================================================
// Word Boundary Helpers
// =============================================================================

/**
 * Word boundary pattern - matches word characters (letters, numbers, underscore)
 */
export const WORD_CHAR_PATTERN = /[\w]/;

/**
 * Find the previous word boundary from the given position.
 * Skips whitespace first, then moves to the start of the current word.
 *
 * @param value - The string to search in
 * @param position - Current cursor position
 * @returns Position of the previous word boundary
 */
export function findPreviousWordBoundary(value: string, position: number): number {
  if (position <= 0) return 0;

  let pos = position - 1;

  // Skip any whitespace/non-word characters
  while (pos > 0 && !WORD_CHAR_PATTERN.test(value[pos])) {
    pos--;
  }

  // Skip word characters until we hit a non-word character or start
  while (pos > 0 && WORD_CHAR_PATTERN.test(value[pos - 1])) {
    pos--;
  }

  return pos;
}

/**
 * Find the next word boundary from the given position.
 * Skips to the end of current word, then skips whitespace.
 *
 * @param value - The string to search in
 * @param position - Current cursor position
 * @returns Position of the next word boundary
 */
export function findNextWordBoundary(value: string, position: number): number {
  const len = value.length;
  if (position >= len) return len;

  let pos = position;

  // Skip word characters until we hit a non-word character
  while (pos < len && WORD_CHAR_PATTERN.test(value[pos])) {
    pos++;
  }

  // Skip any whitespace/non-word characters
  while (pos < len && !WORD_CHAR_PATTERN.test(value[pos])) {
    pos++;
  }

  return pos;
}

// =============================================================================
// Cursor Movement Actions
// =============================================================================

/**
 * Move cursor one character to the left.
 * Clears any existing selection.
 */
export const moveCursorLeft = assign(({ context }) => {
  const newPos = Math.max(0, context.cursorPosition - 1);
  return {
    cursorPosition: newPos,
    selectionAnchor: newPos,
    hasSelection: false,
  };
});

/**
 * Move cursor one character to the right.
 * Clears any existing selection.
 */
export const moveCursorRight = assign(({ context }) => {
  const newPos = Math.min(context.value.length, context.cursorPosition + 1);
  return {
    cursorPosition: newPos,
    selectionAnchor: newPos,
    hasSelection: false,
  };
});

/**
 * Move cursor to the previous word boundary.
 * Clears any existing selection.
 */
export const moveCursorWordLeft = assign(({ context }) => {
  const newPos = findPreviousWordBoundary(context.value, context.cursorPosition);
  return {
    cursorPosition: newPos,
    selectionAnchor: newPos,
    hasSelection: false,
  };
});

/**
 * Move cursor to the next word boundary.
 * Clears any existing selection.
 */
export const moveCursorWordRight = assign(({ context }) => {
  const newPos = findNextWordBoundary(context.value, context.cursorPosition);
  return {
    cursorPosition: newPos,
    selectionAnchor: newPos,
    hasSelection: false,
  };
});

/**
 * Move cursor to the start of the value (Home key).
 * Clears any existing selection.
 */
export const moveCursorToStart = assign({
  cursorPosition: 0,
  selectionAnchor: 0,
  hasSelection: false,
});

/**
 * Move cursor to the end of the value (End key).
 * Clears any existing selection.
 */
export const moveCursorToEnd = assign(({ context }) => ({
  cursorPosition: context.value.length,
  selectionAnchor: context.value.length,
  hasSelection: false,
}));

// =============================================================================
// Text Selection Actions
// =============================================================================

/**
 * Extend selection one character to the left (Shift+Left).
 * On first selection, anchor stays at original position.
 */
export const selectLeft = assign(({ context }) => {
  const newCursorPos = Math.max(0, context.cursorPosition - 1);
  // If no selection yet, anchor is the current position before moving
  const anchor = context.hasSelection ? context.selectionAnchor : context.cursorPosition;
  return {
    cursorPosition: newCursorPos,
    selectionAnchor: anchor,
    hasSelection: newCursorPos !== anchor,
  };
});

/**
 * Extend selection one character to the right (Shift+Right).
 */
export const selectRight = assign(({ context }) => {
  const newCursorPos = Math.min(context.value.length, context.cursorPosition + 1);
  const anchor = context.hasSelection ? context.selectionAnchor : context.cursorPosition;
  return {
    cursorPosition: newCursorPos,
    selectionAnchor: anchor,
    hasSelection: newCursorPos !== anchor,
  };
});

/**
 * Extend selection to previous word boundary (Ctrl+Shift+Left).
 */
export const selectWordLeft = assign(({ context }) => {
  const newCursorPos = findPreviousWordBoundary(context.value, context.cursorPosition);
  const anchor = context.hasSelection ? context.selectionAnchor : context.cursorPosition;
  return {
    cursorPosition: newCursorPos,
    selectionAnchor: anchor,
    hasSelection: newCursorPos !== anchor,
  };
});

/**
 * Extend selection to next word boundary (Ctrl+Shift+Right).
 */
export const selectWordRight = assign(({ context }) => {
  const newCursorPos = findNextWordBoundary(context.value, context.cursorPosition);
  const anchor = context.hasSelection ? context.selectionAnchor : context.cursorPosition;
  return {
    cursorPosition: newCursorPos,
    selectionAnchor: anchor,
    hasSelection: newCursorPos !== anchor,
  };
});

/**
 * Extend selection to start of value (Shift+Home).
 */
export const selectToStart = assign(({ context }) => {
  const anchor = context.hasSelection ? context.selectionAnchor : context.cursorPosition;
  return {
    cursorPosition: 0,
    selectionAnchor: anchor,
    hasSelection: anchor !== 0,
  };
});

/**
 * Extend selection to end of value (Shift+End).
 */
export const selectToEnd = assign(({ context }) => {
  const anchor = context.hasSelection ? context.selectionAnchor : context.cursorPosition;
  return {
    cursorPosition: context.value.length,
    selectionAnchor: anchor,
    hasSelection: anchor !== context.value.length,
  };
});

/**
 * Select all text (Ctrl+A).
 */
export const selectAll = assign(({ context }) => ({
  cursorPosition: context.value.length,
  selectionAnchor: 0,
  hasSelection: context.value.length > 0,
}));

// =============================================================================
// B.1: Multi-Line Cursor Navigation Actions
// =============================================================================

/**
 * Helper to find line boundaries in multi-line text.
 * Returns { lineStart, lineEnd, lineNumber } for the line containing the position.
 */
function getLineInfo(
  value: string,
  position: number,
): { lineStart: number; lineEnd: number; lineNumber: number; lineOffset: number } {
  const lines = value.split('\n');
  let currentPos = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length;
    const lineEnd = currentPos + lineLength;

    if (position <= lineEnd) {
      return {
        lineStart: currentPos,
        lineEnd,
        lineNumber: i,
        lineOffset: position - currentPos,
      };
    }

    // Account for the newline character
    currentPos = lineEnd + 1;
  }

  // Position is at the very end
  const lastLineStart = value.lastIndexOf('\n') + 1;
  return {
    lineStart: lastLineStart,
    lineEnd: value.length,
    lineNumber: lines.length - 1,
    lineOffset: position - lastLineStart,
  };
}

/**
 * Helper to get line start positions for all lines in the text.
 */
function getLineStarts(value: string): number[] {
  const starts = [0];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * Move cursor up in multi-line cell (ArrowUp in Edit Mode).
 * Moves to the same column offset on the previous line, or to start if shorter.
 *
 */
export const moveCursorUp = assign(({ context }) => {
  const { value, cursorPosition } = context;

  // Check if there are multiple lines
  if (!value.includes('\n')) {
    // Single line - cursor stays at current position (no-op for vertical movement)
    // The actual behavior would be to exit edit mode, but that's handled by keyboard coordination
    return {};
  }

  const lineInfo = getLineInfo(value, cursorPosition);

  // If on first line, move to start of line
  if (lineInfo.lineNumber === 0) {
    return {
      cursorPosition: 0,
      selectionAnchor: 0,
      hasSelection: false,
    };
  }

  // Find the previous line
  const lineStarts = getLineStarts(value);
  const prevLineStart = lineStarts[lineInfo.lineNumber - 1];
  const prevLineEnd = lineInfo.lineNumber > 0 ? lineStarts[lineInfo.lineNumber] - 1 : lineStarts[0];
  const prevLineLength = prevLineEnd - prevLineStart;

  // Move to same column offset, or end of line if shorter
  const newOffset = Math.min(lineInfo.lineOffset, prevLineLength);
  const newPos = prevLineStart + newOffset;

  return {
    cursorPosition: newPos,
    selectionAnchor: newPos,
    hasSelection: false,
  };
});

/**
 * Move cursor down in multi-line cell (ArrowDown in Edit Mode).
 * Moves to the same column offset on the next line, or to end if shorter.
 *
 */
export const moveCursorDown = assign(({ context }) => {
  const { value, cursorPosition } = context;

  // Check if there are multiple lines
  if (!value.includes('\n')) {
    // Single line - cursor stays at current position (no-op for vertical movement)
    return {};
  }

  const lineInfo = getLineInfo(value, cursorPosition);
  const lineStarts = getLineStarts(value);
  const totalLines = lineStarts.length;

  // If on last line, move to end of line
  if (lineInfo.lineNumber >= totalLines - 1) {
    return {
      cursorPosition: value.length,
      selectionAnchor: value.length,
      hasSelection: false,
    };
  }

  // Find the next line
  const nextLineStart = lineStarts[lineInfo.lineNumber + 1];
  const nextLineEnd =
    lineInfo.lineNumber + 2 < totalLines ? lineStarts[lineInfo.lineNumber + 2] - 1 : value.length;
  const nextLineLength = nextLineEnd - nextLineStart;

  // Move to same column offset, or end of line if shorter
  const newOffset = Math.min(lineInfo.lineOffset, nextLineLength);
  const newPos = nextLineStart + newOffset;

  return {
    cursorPosition: newPos,
    selectionAnchor: newPos,
    hasSelection: false,
  };
});

// =============================================================================
// B.3: Word Deletion Actions
// =============================================================================

/**
 * Delete word forward from cursor (Ctrl+Delete in Edit Mode).
 * Deletes from cursor to the end of the current/next word.
 *
 */
export const deleteWordForward = assign(({ context }) => {
  const { value, cursorPosition, selectionAnchor, hasSelection } = context;

  // If there's a selection, delete the selection instead
  if (hasSelection) {
    const start = Math.min(cursorPosition, selectionAnchor);
    const end = Math.max(cursorPosition, selectionAnchor);
    return {
      value: value.substring(0, start) + value.substring(end),
      cursorPosition: start,
      selectionAnchor: start,
      hasSelection: false,
    };
  }

  // Find the next word boundary
  const nextBoundary = findNextWordBoundary(value, cursorPosition);

  // Delete from cursor to next word boundary
  const newValue = value.substring(0, cursorPosition) + value.substring(nextBoundary);

  return {
    value: newValue,
    // cursor position stays the same since we deleted forward
  };
});

/**
 * Delete word backward from cursor (Ctrl+Backspace in Edit Mode).
 * Deletes from cursor to the beginning of the current/previous word.
 *
 */
export const deleteWordBackward = assign(({ context }) => {
  const { value, cursorPosition, selectionAnchor, hasSelection } = context;

  // If there's a selection, delete the selection instead
  if (hasSelection) {
    const start = Math.min(cursorPosition, selectionAnchor);
    const end = Math.max(cursorPosition, selectionAnchor);
    return {
      value: value.substring(0, start) + value.substring(end),
      cursorPosition: start,
      selectionAnchor: start,
      hasSelection: false,
    };
  }

  // Find the previous word boundary
  const prevBoundary = findPreviousWordBoundary(value, cursorPosition);

  // Delete from previous word boundary to cursor
  const newValue = value.substring(0, prevBoundary) + value.substring(cursorPosition);

  return {
    value: newValue,
    cursorPosition: prevBoundary,
    selectionAnchor: prevBoundary,
  };
});

/**
 * Delete to end of line from cursor (Ctrl+K in Edit Mode).
 * Deletes from cursor to the end of the current line (or to the next newline).
 */
export const deleteToEndOfLine = assign(({ context }) => {
  const { value, cursorPosition, selectionAnchor, hasSelection } = context;

  // If there's a selection, delete the selection instead
  if (hasSelection) {
    const start = Math.min(cursorPosition, selectionAnchor);
    const end = Math.max(cursorPosition, selectionAnchor);
    return {
      value: value.substring(0, start) + value.substring(end),
      cursorPosition: start,
      selectionAnchor: start,
      hasSelection: false,
    };
  }

  // Find the end of the current line (next newline or end of string)
  const nextNewline = value.indexOf('\n', cursorPosition);
  const lineEnd = nextNewline === -1 ? value.length : nextNewline;

  // Delete from cursor to end of line
  const newValue = value.substring(0, cursorPosition) + value.substring(lineEnd);

  return {
    value: newValue,
    // cursor position stays the same since we deleted forward
  };
});

// =============================================================================
// Mode Toggle Action
// =============================================================================

/**
 * Toggle between Enter Mode and Edit Mode.
 * Called when F2 is pressed while editing.
 */
export const toggleEditMode = assign(({ context }) => ({
  isEditMode: !context.isEditMode,
}));

// =============================================================================
// Exports for machine config
// =============================================================================

/**
 * All cursor movement and text selection actions for the editor machine.
 */
export const cursorMovementActions = {
  // Cursor movement (horizontal)
  moveCursorLeft,
  moveCursorRight,
  moveCursorWordLeft,
  moveCursorWordRight,
  moveCursorToStart,
  moveCursorToEnd,
  // B.1: Cursor movement (vertical - multi-line cells)
  moveCursorUp,
  moveCursorDown,
  // Text selection
  selectLeft,
  selectRight,
  selectWordLeft,
  selectWordRight,
  selectToStart,
  selectToEnd,
  selectAll,
  // B.3: Word deletion
  deleteWordForward,
  deleteWordBackward,
  deleteToEndOfLine,
  // Mode toggle
  toggleEditMode,
};
