/**
 * Shared helpers for formatting action handlers.
 *
 * This module provides common utilities used across all formatting sub-modules:
 * - Type helpers for accessing UIStore
 * - Selection helpers for getting active cell and ranges
 * - Rich text editing helpers for character-level formatting
 * - Multi-sheet helpers for broadcasting
 */

import type { ActionDependencies, ActionResult } from '@mog-sdk/contracts/actions';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { RichTextSegment, TextFormat } from '@mog-sdk/contracts/rich-text';

import type { UIState } from '../../../ui-store';
import { getUIStore, handled } from '../handler-utils';

// Re-export shared handler utilities for formatting sub-modules
export { getUIStore, handled };

// =============================================================================
// Type Helpers
// =============================================================================

/**
 * Call a UIStore action method with proper typing.
 * Convenience wrapper: gets state from the typed store and passes it to the action callback.
 */
export function callUIStoreAction(deps: ActionDependencies, action: (state: UIState) => void) {
  action(getUIStore(deps).getState());
}

/**
 * Get UIState snapshot directly from ActionDependencies.
 * Convenience wrapper for callers that just need the state object.
 */
export function getUIState(deps: ActionDependencies): UIState {
  return getUIStore(deps).getState();
}

/**
 * Get target sheet IDs for multi-sheet operations.
 * Returns selected sheets if available, otherwise falls back to [activeSheetId].
 *
 * Multi-Sheet Selection
 */
// getSelectedSheetIds is now async — sync callers use active sheet as safe default
export function getTargetSheetIds(deps: ActionDependencies): SheetId[] {
  return [deps.getActiveSheetId()];
}

/**
 * Get selection context (active cell and ranges) via accessors.
 */
export function getSelectionContext(deps: ActionDependencies): {
  activeCell: { row: number; col: number };
  ranges: CellRange[];
} {
  return {
    activeCell: deps.accessors.selection.getActiveCell(),
    ranges: deps.accessors.selection.getRanges(),
  };
}

// =============================================================================
// Rich Text Editing Helpers
// =============================================================================

/**
 * Context for rich text editing state.
 * Used when determining whether to apply formatting to characters or cells.
 */
export interface RichTextEditingContext {
  /** Whether we're in rich text editing mode with character selection */
  isRichTextEditing: boolean;
  /** The current character selection start position */
  selectionStart: number;
  /** The current character selection end position */
  selectionEnd: number;
  /** Whether there's an actual character selection (not just cursor) */
  hasCharSelection: boolean;
  /** Current rich text segments being edited */
  segments: RichTextSegment[];
  /** Current format at cursor/selection position */
  currentFormat: Partial<TextFormat> | undefined;
}

/**
 * Check if we're in rich text editing mode with character selection.
 * Returns context about the editing state for format application decisions.
 *
 * Toolbar Integration for Partial Text Formatting
 * - Detects if the editor is in `richTextEditing` state
 * - Returns selection information for character-level formatting
 *
 * @param deps - Action dependencies containing editor accessor
 * @returns Rich text editing context or null if not in rich text editing mode
 */
export function getRichTextEditingContext(deps: ActionDependencies): RichTextEditingContext | null {
  // Check if editor is in richTextEditing state via accessor
  const isRichTextEditing = deps.accessors.editor.isRichTextEditing();

  if (isRichTextEditing) {
    // Extract selection information via accessors
    const selectionStart = deps.accessors.editor.getCharSelectionStart();
    const selectionEnd = deps.accessors.editor.getCharSelectionEnd();
    const hasCharSelection = deps.accessors.editor.hasCharSelection();
    const segments: RichTextSegment[] = deps.accessors.editor.getRichTextSegments() ?? [];
    const currentFormat = deps.accessors.editor.getCurrentFormat() ?? undefined;

    return {
      isRichTextEditing: true,
      selectionStart,
      selectionEnd,
      hasCharSelection,
      segments,
      currentFormat,
    };
  }

  if (deps.accessors.editor.isEditing() && deps.accessors.editor.hasSelection()) {
    const value = deps.accessors.editor.getValue();
    const cursorPosition = deps.accessors.editor.getCursorPosition();
    const selectionAnchor = deps.accessors.editor.getSelectionAnchor();
    const selectionStart = Math.min(cursorPosition, selectionAnchor);
    const selectionEnd = Math.max(cursorPosition, selectionAnchor);
    const segments: RichTextSegment[] =
      deps.accessors.editor.getRichTextSegments() ?? (value ? [{ text: value }] : []);

    return {
      isRichTextEditing: false,
      selectionStart,
      selectionEnd,
      hasCharSelection: selectionStart !== selectionEnd,
      segments,
      currentFormat: undefined,
    };
  }

  return null;
}

/**
 * Compute the format that applies to the entire character selection.
 * Returns undefined for properties that have mixed values in the selection.
 *
 * Used for determining toggle state and current format.
 *
 * @param segments - Rich text segments being edited
 * @param selectionStart - Start character index (inclusive)
 * @param selectionEnd - End character index (exclusive)
 * @returns Format properties common to entire selection
 */
export function computeCurrentFormat(
  segments: RichTextSegment[],
  selectionStart: number,
  selectionEnd: number,
): Partial<TextFormat> {
  if (segments.length === 0 || selectionStart === selectionEnd) {
    // No selection or empty segments - return empty format
    return {};
  }

  // Build character-level format array
  const charFormats: (Partial<TextFormat> | undefined)[] = [];
  for (const segment of segments) {
    for (let i = 0; i < segment.text.length; i++) {
      charFormats.push(segment.format);
    }
  }

  // Get formats for the selected range
  const selectedFormats = charFormats.slice(selectionStart, selectionEnd);
  if (selectedFormats.length === 0) {
    return {};
  }

  // Start with the first character's format
  const result: Partial<TextFormat> = { ...selectedFormats[0] };

  // Check each format property for consistency across selection
  const formatKeys: (keyof TextFormat)[] = [
    'bold',
    'italic',
    'underlineType',
    'strikethrough',
    'fontFamily',
    'fontSize',
    'fontColor',
    'superscript',
    'subscript',
  ];

  for (const key of formatKeys) {
    const firstValue = selectedFormats[0]?.[key];
    const allSame = selectedFormats.every((fmt) => fmt?.[key] === firstValue);
    if (!allSame) {
      // Mixed values - set to undefined to indicate indeterminate state
      delete result[key];
    }
  }

  return result;
}

/**
 * Apply character-level format to rich text selection.
 * Uses editor commands to apply the format.
 *
 * Character-level format application
 *
 * @param deps - Action dependencies
 * @param format - Format to apply to selected characters
 * @returns ActionResult indicating success
 */
export function applyCharFormat(
  deps: ActionDependencies,
  format: Partial<TextFormat>,
): ActionResult {
  if (!deps.accessors.editor.isRichTextEditing() && deps.accessors.editor.hasSelection()) {
    const value = deps.accessors.editor.getValue();
    const cursorPosition = deps.accessors.editor.getCursorPosition();
    const selectionAnchor = deps.accessors.editor.getSelectionAnchor();
    const selectionStart = Math.min(cursorPosition, selectionAnchor);
    const selectionEnd = Math.max(cursorPosition, selectionAnchor);
    const segments: RichTextSegment[] = value ? [{ text: value }] : [];
    deps.commands.editor.startRichTextEditing(segments);
    deps.commands.editor.charSelectionChanged(selectionStart, selectionEnd);
  }
  deps.commands.editor.applyCharFormat(format);
  return handled();
}
