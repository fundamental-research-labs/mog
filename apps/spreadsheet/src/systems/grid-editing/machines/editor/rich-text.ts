/**
 * Editor Machine Rich Text
 *
 * Actions for handling rich text editing operations including:
 * - Text formatting (bold, italic, underline, color, etc.)
 * - Format application to selected text
 * - Rich text segment manipulation
 * - Format preservation during editing
 *
 * Helper functions extracted from editor-machine.ts
 * Rich text editing actions extracted from editor-machine.ts
 */

import type { RichTextSegment, TextFormat } from '@mog-sdk/contracts/rich-text';
import { applyFormat, isRichText, normalizeRichText } from '@mog/spreadsheet-utils/rich-text';
import { assign } from 'xstate';

// =============================================================================
// Rich Text Helpers
// =============================================================================

/**
 * Get segments that fall within a character range.
 * Used for computing current format from selection.
 *
 * @param segments - Rich text segments
 * @param startIndex - Start character index (inclusive)
 * @param endIndex - End character index (exclusive)
 * @returns Array of segments (or partial segments) in the range
 */
export function getSegmentsInRange(
  segments: RichTextSegment[],
  startIndex: number,
  endIndex: number,
): RichTextSegment[] {
  if (!segments || segments.length === 0) return [];

  const result: RichTextSegment[] = [];
  let charIndex = 0;

  for (const segment of segments) {
    const segmentStart = charIndex;
    const segmentEnd = charIndex + segment.text.length;

    // Check if this segment overlaps with the range
    if (segmentEnd > startIndex && segmentStart < endIndex) {
      result.push(segment);
    }

    charIndex = segmentEnd;

    // Early exit if we've passed the end
    if (charIndex >= endIndex) break;
  }

  return result;
}

/**
 * Compute the current format from selection.
 * Returns format properties that apply to the entire selection.
 * Mixed formats return undefined for that property.
 *
 * This is used for toolbar button state (pressed/unpressed/indeterminate).
 *
 * @param segments - Rich text segments
 * @param selectionStart - Start character index
 * @param selectionEnd - End character index
 * @returns Format properties consistent across selection, undefined for mixed
 */
export function computeCurrentFormat(
  segments: RichTextSegment[] | null,
  selectionStart: number,
  selectionEnd: number,
): Partial<TextFormat> | null {
  if (!segments || segments.length === 0) return null;

  // For cursor (no selection), get format at cursor position
  if (selectionStart === selectionEnd) {
    const selectedSegments = getSegmentsInRange(
      segments,
      Math.max(0, selectionStart - 1),
      selectionStart + 1,
    );
    if (selectedSegments.length === 0) return null;
    return selectedSegments[0]?.format ?? null;
  }

  const selectedSegments = getSegmentsInRange(segments, selectionStart, selectionEnd);
  if (selectedSegments.length === 0) return null;

  // Start with first segment's format
  const result: Partial<TextFormat> = { ...selectedSegments[0]?.format };

  // Remove properties that aren't consistent across all segments
  for (const segment of selectedSegments.slice(1)) {
    for (const key of Object.keys(result) as Array<keyof TextFormat>) {
      if (result[key] !== segment.format?.[key]) {
        delete result[key]; // Mixed format
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Get the total character length of rich text segments.
 *
 * @param segments - Rich text segments
 * @returns Total character count
 */
export function getRichTextLength(segments: RichTextSegment[] | null): number {
  if (!segments) return 0;
  return segments.reduce((sum, seg) => sum + seg.text.length, 0);
}

// =============================================================================
// Rich Text Editing Actions
// =============================================================================

/**
 * Initialize rich text editing context.
 * Converts initial value to rich text segments if needed.
 * Called on entry to richTextEditing state.
 */
export const startRichTextEditing = assign(({ context, event }) => {
  // Handle START_RICH_TEXT_EDITING event
  if (event.type === 'START_RICH_TEXT_EDITING') {
    const segments = event.segments;
    const totalLength = getRichTextLength(segments);
    return {
      richTextSegments: segments,
      charSelectionStart: totalLength,
      charSelectionEnd: totalLength,
      hasCharSelection: false,
      currentFormat: computeCurrentFormat(segments, totalLength, totalLength),
    };
  }

  // Handle START_EDITING with rich text value
  if (event.type === 'START_EDITING' && event.initialValue !== undefined) {
    // Check if initial value is rich text
    if (isRichText(event.initialValue)) {
      const segments = event.initialValue as RichTextSegment[];
      const totalLength = getRichTextLength(segments);
      return {
        richTextSegments: segments,
        charSelectionStart: totalLength,
        charSelectionEnd: totalLength,
        hasCharSelection: false,
        currentFormat: computeCurrentFormat(segments, totalLength, totalLength),
      };
    }
  }

  // Default: convert plain string to single segment
  const text = context.value || '';
  const segments: RichTextSegment[] = text ? [{ text }] : [];
  const totalLength = text.length;
  return {
    richTextSegments: segments,
    charSelectionStart: totalLength,
    charSelectionEnd: totalLength,
    hasCharSelection: false,
    currentFormat: null,
  };
});

/**
 * Update character-level selection range.
 * Called when selection changes within rich text editor.
 */
export const updateCharSelection = assign(({ context, event }) => {
  if (event.type !== 'CHAR_SELECTION_CHANGED') return {};

  const start = Math.max(0, event.start);
  const end = Math.max(0, event.end);
  const hasSelection = start !== end;

  return {
    charSelectionStart: start,
    charSelectionEnd: end,
    hasCharSelection: hasSelection,
    currentFormat: computeCurrentFormat(context.richTextSegments, start, end),
  };
});

/**
 * Apply formatting to the current character selection.
 * Uses applyFormat from contracts to split/merge segments as needed.
 */
export const applyCharFormat = assign(({ context, event }) => {
  if (event.type !== 'APPLY_CHAR_FORMAT') return {};
  if (!context.richTextSegments) return {};

  const { charSelectionStart, charSelectionEnd } = context;

  // If no selection, format applies to next typed character (typing format)
  // For now, just store in currentFormat
  if (charSelectionStart === charSelectionEnd) {
    return {
      currentFormat: { ...context.currentFormat, ...event.format },
    };
  }

  // Apply format to selection range
  const newSegments = normalizeRichText(
    applyFormat(context.richTextSegments, charSelectionStart, charSelectionEnd, event.format),
  );

  return {
    richTextSegments: newSegments,
    currentFormat: computeCurrentFormat(newSegments, charSelectionStart, charSelectionEnd),
  };
});

/**
 * Clear formatting from the current character selection.
 */
export const clearCharFormat = assign(({ context }) => {
  if (!context.richTextSegments) return {};

  const { charSelectionStart, charSelectionEnd } = context;

  // If no selection, clear typing format
  if (charSelectionStart === charSelectionEnd) {
    return { currentFormat: null };
  }

  // Create unformatted segments for the selection range
  const newSegments = normalizeRichText(
    applyFormat(
      context.richTextSegments,
      charSelectionStart,
      charSelectionEnd,
      {}, // Empty format clears formatting
    ),
  );

  return {
    richTextSegments: newSegments,
    currentFormat: null,
  };
});

/**
 * Update rich text segments from input.
 * Called when content changes in the rich text editor.
 */
export const updateRichTextValue = assign(({ event }) => {
  if (event.type !== 'INPUT_RICH_TEXT') return {};

  const segments = normalizeRichText(event.segments);
  const totalLength = getRichTextLength(segments);

  return {
    richTextSegments: segments,
    // Update plain text value as well for compatibility
    value: segments.map((s) => s.text).join(''),
    cursorPosition: totalLength,
  };
});

/**
 * Reset rich text state when exiting rich text editing.
 */
export const resetRichTextState = assign({
  richTextSegments: null,
  charSelectionStart: 0,
  charSelectionEnd: 0,
  hasCharSelection: false,
  currentFormat: null,
});

// =============================================================================
// Exported Actions Object
// =============================================================================

/**
 * Rich text editing actions for the editor machine.
 * Import and spread into the machine's actions object.
 *
 * Action name mapping (for reference when updating editor-machine.ts):
 * - initializeRichTextEditing -> startRichTextEditing
 * - updateCharSelection -> updateCharSelection (same)
 * - applyFormatToSelection -> applyCharFormat
 * - clearCharFormat -> clearCharFormat (same)
 * - updateRichTextSegments -> updateRichTextValue
 */
export const richTextActions = {
  startRichTextEditing,
  updateCharSelection,
  applyCharFormat,
  clearCharFormat,
  updateRichTextValue,
  resetRichTextState,
};
