/**
 * Editor Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * @module @mog-sdk/contracts/actors/editor
 */

import type { RichTextSegment, TextFormat } from '@mog/types-core/rich-text';
import type { CellRange } from '@mog/types-core';
import type { CellSchema } from '@mog/types-commands/schema';
import type { CellEditorType } from '@mog/types-editor/editor/editor';
import type { Direction } from '../machines/types';

// =============================================================================
// FORMULA CONTEXT TYPES
// =============================================================================

/**
 * Function call context in the parse stack.
 * Tracks nested function calls for proper argument tracking.
 */
export interface FunctionStackEntry {
  /** Function name (uppercase) */
  name: string;
  /** Current argument index (0-based) */
  argIndex: number;
  /** Position of opening parenthesis */
  parenStart: number;
}

/**
 * Formula editing context at a given cursor position.
 * Computed by analyzeFormulaContext() pure function.
 */
export interface FormulaContext {
  /** Current function being edited (innermost). Null if not inside a function call. */
  currentFunction: string | null;
  /** Index of current argument (0-based). 0 if at first argument or not in function. */
  currentArgIndex: number;
  /** Stack of nested functions for context (outermost first). */
  functionStack: FunctionStackEntry[];
  /** Text being typed for function name completion (e.g., "SU" when typing "=SU"). Null if not typing a function name. */
  functionPrefix: string | null;
  /** Whether cursor is in a position where function suggestions should show. */
  shouldShowSuggestions: boolean;
  /** Whether cursor is inside function parens (should show argument hint). */
  shouldShowArgumentHint: boolean;
}

// =============================================================================
// STATE TYPE (minimal version for selectors)
// =============================================================================

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 * This is a subset of the full EditorContext, containing only what selectors need.
 */
export interface EditorState {
  context: {
    /** Whether we're in Edit Mode (true) or Enter Mode (false) */
    isEditMode: boolean;
    /** The sheet the edited cell is on */
    sheetId: string | null;
    /** Merged region bounds if editing a merged cell */
    mergeBounds: CellRange | null;
    /** Current editor value (may include partial formulas) */
    value: string;
    /** Cursor position within the value string */
    cursorPosition: number;
    /** Selection anchor position for text selection */
    selectionAnchor: number;
    /** Whether there's an active text selection */
    hasSelection: boolean;
    /** Current color for formula range highlighting */
    currentRangeColor: string;
    /** Index into FORMULA_RANGE_COLORS for cycling */
    rangeColorIndex: number;
    /** Whether a remote user has modified this cell while editing */
    hasConflict: boolean;
    /** Error message if validation failed */
    errorMessage: string | null;
    /** Direction to move selection after commit */
    commitDirection: Direction | 'none' | null;
    /** IME composition text (not yet committed) */
    compositionText: string;
    /** Flag to show notification when remote user deleted the cell */
    wasRemotelyDeleted: boolean;
    /** Flag to show notification when remote user deleted the sheet */
    wasSheetDeleted: boolean;
    /** Flag indicating a dialog is open during editing */
    pausedForDialog: boolean;
    /** Flag for structure change cancellation */
    wasStructurallyCancelled: boolean;
    /** The resolved editor type for the current cell */
    editorType: CellEditorType;
    /** The cell's schema (if any) for validation/dropdown items */
    cellSchema: CellSchema | null;
    /** Resolved enum items for dropdown picker */
    enumItems: unknown[] | null;
    /** Whether the picker is currently open */
    isPickerOpen: boolean;
    /** Whether function suggestions popup is visible */
    isSuggestionsOpen: boolean;
    /** Currently selected suggestion index */
    selectedSuggestionIndex: number;
    /** Whether argument hint tooltip is visible */
    isArgumentHintOpen: boolean;
    /** Whether this is an array formula (CSE) */
    isArrayFormula: boolean;
    /** Rich text segments when editing a rich text cell */
    richTextSegments: RichTextSegment[] | null;
    /** Character-level selection start position */
    charSelectionStart: number;
    /** Character-level selection end position */
    charSelectionEnd: number;
    /** Whether there's a character-level selection */
    hasCharSelection: boolean;
    /** Current format at cursor/selection */
    currentFormat: Partial<TextFormat> | null;
    /** Formula context for autocomplete (function name, argument position, etc.) */
    formulaContext: FormulaContext | null;
    /** Selection ranges captured when the current edit started */
    editStartSelectionRanges: CellRange[] | null;
  };
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

/**
 * EditorAccessor provides point-in-time reads of editor state for handlers.
 * Each method mirrors a selector 1:1.
 */
export interface EditorAccessor {
  // ===========================================================================
  // Value accessors
  // ===========================================================================

  getValue(): string;
  getCursorPosition(): number;
  getSheetId(): string | null;
  getMergeBounds(): CellRange | null;
  getSelectionAnchor(): number;
  hasSelection(): boolean;
  getCurrentRangeColor(): string;
  getRangeColorIndex(): number;
  hasConflict(): boolean;
  getErrorMessage(): string | null;
  getCommitDirection(): Direction | 'none' | null;
  getCompositionText(): string;
  wasRemotelyDeleted(): boolean;
  wasSheetDeleted(): boolean;
  isPausedForDialog(): boolean;
  wasStructurallyCancelled(): boolean;
  getEditorType(): CellEditorType;
  getEnumItems(): unknown[] | null;
  isPickerOpen(): boolean;
  isSuggestionsOpen(): boolean;
  getSelectedSuggestionIndex(): number;
  isArgumentHintOpen(): boolean;
  isArrayFormula(): boolean;
  getRichTextSegments(): RichTextSegment[] | null;
  getCharSelectionStart(): number;
  getCharSelectionEnd(): number;
  hasCharSelection(): boolean;
  getCurrentFormat(): Partial<TextFormat> | null;
  getFormulaContext(): FormulaContext | null;
  getEditStartSelectionRanges(): CellRange[] | null;

  // ===========================================================================
  // State matching accessors
  // ===========================================================================

  isInactive(): boolean;
  isEditing(): boolean;
  isFormulaEditing(): boolean;
  isRichTextEditing(): boolean;
  isEnterMode(): boolean;
  isEditMode(): boolean;
  isImeComposing(): boolean;
  isValidating(): boolean;
  isCommitting(): boolean;
  isError(): boolean;
  isActivating(): boolean;
}
