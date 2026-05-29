/**
 * Editor Machine Types
 *
 * Type definitions for the editor state machine including:
 * - EditorContext: The context object containing editor state
 * - EditorEvent: Union type of all events the editor machine can receive
 * - EditorEntryMode: How the editor was activated (click, double-click, F2, typing, etc.)
 * - initialEditorContext: The initial context for the editor machine
 *
 * Extracted from editor-machine.ts as part of decomposition.
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellEditorType } from '@mog-sdk/contracts/editor';
import type { Direction, IFunctionRegistry } from '@mog-sdk/contracts/machines';
import { FORMULA_RANGE_COLORS } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { RichTextSegment, TextFormat } from '@mog-sdk/contracts/rich-text';
import type { CellSchema } from '@mog-sdk/contracts/schema';

import type { FormulaContext, StructureChange } from '../../../shared/utils';

// =============================================================================
// CONTEXT TYPE
// =============================================================================

export interface EditorContext {
  /**
   * Whether we're in Edit Mode (true) or Enter Mode (false).
   *
   * Edit Mode (isEditMode = true):
   * - Arrow keys move cursor within text
   * - Activated by: F2, double-click, formula bar click
   *
   * Enter Mode (isEditMode = false):
   * - Arrow keys commit edit and move selection (or insert formula references)
   * - Activated by: typing characters directly
   *
   */
  isEditMode: boolean;

  /** The cell being edited — set once on START_EDITING, never changes during the edit session.
   * This is separate from selection.activeCell which moves during formula point mode.
   * Used by commit coordination to write the value to the correct cell.
   */
  editingCell: CellCoord | null;
  /** The sheet the edited cell is on */
  sheetId: string | null;
  /** Merged region bounds if editing a merged cell (for in-cell editor sizing) */
  mergeBounds: CellRange | null;
  /** Current editor value (may include partial formulas) */
  value: string;
  /**
   * True when the edited cell's effective number format is Text (`@`).
   * In that mode formula-shaped input is literal text, so editor formula
   * mode and formula pre-validation must not run.
   */
  formulaInputIsLiteral: boolean;
  /** Cursor position within the value string */
  cursorPosition: number;

  // =========================================================================
  // Text Selection State
  // =========================================================================

  /**
   * Selection anchor - the position where selection started (Shift+click/drag).
   * When no selection, this equals cursorPosition.
   */
  selectionAnchor: number;

  /**
   * Whether there's an active text selection.
   * When true, selection spans from selectionAnchor to cursorPosition.
   */
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
  /** Date picker commit payload, separate from generic text commits. */
  datePickerCommit: { isoDate: string; kind: 'date' | 'datetime' } | null;
  /** Key that triggered the commit — used for Tab/Enter routing through selection machine */
  commitKey: 'tab' | 'shift-tab' | 'enter' | 'shift-enter' | null;
  /** IME composition text (not yet committed) */
  compositionText: string;
  /** Flag to show notification when remote user deleted the cell */
  wasRemotelyDeleted: boolean;
  /** Flag to show notification when remote user deleted the sheet */
  wasSheetDeleted: boolean;
  /** Flag indicating a dialog is open during editing (focus-based keyboard handling) */
  pausedForDialog: boolean;
  /** Flag to show notification when editing was cancelled due to structure change */
  wasStructurallyCancelled: boolean;

  // =========================================================================
  // Function Registry (Injected Dependency)
  // =========================================================================

  /**
   * Function registry for looking up function metadata.
   * Injected by coordinator to decouple machines from calculator-engine.
   * Used by insertFunctionArgs to generate argument placeholders.
   *
   */
  functionRegistry: IFunctionRegistry | null;

  // =========================================================================
  // Issue 2: Cell Dropdowns / In-Cell Pickers
  // =========================================================================

  /**
   * The resolved editor type for the current cell.
   * Determines which input control to render (text, dropdown, checkbox, etc.)
   * Set by coordinator via SET_EDITOR_TYPE after schema lookup.
   */
  editorType: CellEditorType;

  /**
   * The cell's schema (if any) for validation/dropdown items.
   * Set by coordinator via SET_EDITOR_TYPE after schema lookup.
   */
  cellSchema: CellSchema | null;

  /**
   * Resolved enum items for dropdown picker.
   * From static enum or resolved enumSource.
   */
  enumItems: unknown[] | null;

  /**
   * Whether the picker (dropdown, date picker, etc.) is currently open.
   * Ephemeral UI state - not synced to collaborators.
   */
  isPickerOpen: boolean;

  /**
   * Data Validation - Flag to open dropdown after activation.
   * Set by START_EDITING with openDropdown: true (from Alt+Down).
   * Consumed when SET_EDITOR_TYPE is received if editor is dropdown type.
   */
  pendingOpenDropdown: boolean;

  // =========================================================================
  // Autocomplete State
  // =========================================================================

  /**
   * Derived formula context - which function/argument is being edited.
   * Updated on every INPUT event via pure analyzeFormulaContext().
   * Null when not editing a formula or formula context not applicable.
   */
  formulaContext: FormulaContext | null;

  /**
   * Whether function suggestions popup is visible.
   * Controlled by formula prefix detection and user actions.
   */
  isSuggestionsOpen: boolean;

  /**
   * Currently selected suggestion index (for keyboard navigation).
   * Reset to 0 when suggestions list changes.
   */
  selectedSuggestionIndex: number;

  /**
   * Whether argument hint tooltip is visible.
   * Shown when inside function parentheses.
   */
  isArgumentHintOpen: boolean;

  // =========================================================================
  // Formula Auditing
  // =========================================================================

  /**
   * Whether this formula is being entered as an array formula (CSE).
   * Set to true when user presses Ctrl+Shift+Enter instead of Enter.
   * Passed through to execution layer to store in cell metadata.
   */
  isArrayFormula: boolean;

  /**
   * Selection ranges captured before the edit session collapsed selection
   * to the editing cell. CSE array formula commits use this as the output
   * extent even after formula editing and point mode mutate selection.
   */
  editStartSelectionRanges: CellRange[] | null;

  // =========================================================================
  // Commit-time Selection Snapshot
  // Populated by snapshotSelectionForCommit action on VALIDATION_SUCCESS,
  // so the commitCellValue service reads these from input instead of
  // calling selectionActorRef.getSnapshot() (Rule 18).
  // =========================================================================

  /** Selection activeCell snapshot taken at commit time (fallback for editingCell). */
  commitActiveCell: CellCoord | null;

  /** Selection ranges snapshot taken at commit time (used for array formulas). */
  commitSelectionRanges: CellRange[] | null;

  // =========================================================================
  // Formula Point Mode Tracking
  // =========================================================================

  /**
   * Start position of the last formula range reference inserted via point mode.
   * Used to replace (not append) the reference on consecutive arrow keys.
   * Cleared when user types (INPUT event) to start a new reference slot.
   */
  formulaRefInsertStart: number | null;

  /**
   * End position of the last formula range reference inserted via point mode.
   * When cursor equals this value, the next FORMULA_RANGE_SELECTED replaces
   * the text from formulaRefInsertStart..formulaRefInsertEnd instead of inserting.
   */
  formulaRefInsertEnd: number | null;

  // =========================================================================
  // Rich Text Editing State
  // =========================================================================

  /**
   * Rich text segments when editing a rich text cell.
   * Only populated in richTextEditing state.
   * null when not editing rich text.
   */
  richTextSegments: RichTextSegment[] | null;

  /**
   * Character-level selection start position (different from cell selection).
   * This is the character offset in the plain text representation.
   */
  charSelectionStart: number;

  /**
   * Character-level selection end position.
   * When equal to charSelectionStart, there's just a cursor (no selection).
   */
  charSelectionEnd: number;

  /**
   * Whether there's a character-level selection (charSelectionStart !== charSelectionEnd).
   */
  hasCharSelection: boolean;

  /**
   * Current format at cursor/selection for toolbar state.
   * Shows the format that applies to the current selection.
   * null when not in rich text editing mode or no selection.
   */
  currentFormat: Partial<TextFormat> | null;
}

// =============================================================================
// ENTRY MODE TYPE
// =============================================================================

/**
 * Entry mode for START_EDITING event.
 * Determines whether to start in Enter Mode or Edit Mode.
 *
 * - 'F2': User pressed F2 -> Edit Mode (cursor at end, arrows move cursor)
 * - 'doubleClick': User double-clicked cell -> Edit Mode (cursor at click position)
 * - 'typing': User typed a character -> Enter Mode (arrows commit and move)
 * - 'formulaBar': User clicked formula bar -> Edit Mode
 *
 */
export type EditorEntryMode = 'F2' | 'doubleClick' | 'typing' | 'formulaBar';

// =============================================================================
// EVENT TYPES
// =============================================================================

export type EditorEvent =
  | {
      type: 'START_EDITING';
      cell: CellCoord;
      sheetId: string;
      initialValue?: string;
      mergedRegion?: CellRange;
      /**
       * How editing was initiated. Determines Enter Mode vs Edit Mode.
       * - 'F2', 'doubleClick', 'formulaBar' -> Edit Mode (arrows move cursor)
       * - 'typing' -> Enter Mode (arrows commit and move)
       * @default 'typing' for backward compatibility
       */
      entryMode?: EditorEntryMode;
      /**
       * Initial cursor position. For double-click, this is the position
       * calculated from the click coordinates. For other modes, defaults
       * to end of value (Edit Mode) or 0 (Enter Mode).
       */
      cursorPosition?: number;
      formulaInputIsLiteral?: boolean;
      /**
       * Data Validation - Signal to open dropdown immediately.
       * When true, the editor should open the dropdown picker after activating.
       * This is used by Alt+Down shortcut to start editing and open dropdown in one action.
       */
      openDropdown?: boolean;
      /**
       * Selection ranges captured before edit start collapses the selection.
       * Used as the CSE array formula output range on Ctrl+Shift+Enter.
       */
      preEditSelectionRanges?: CellRange[];
    }
  | { type: 'ACTIVATED' }
  | { type: 'INPUT'; value: string; cursorPosition: number }
  | { type: 'SET_CURSOR'; position: number }
  | { type: 'IME_START' }
  | { type: 'IME_UPDATE'; compositionText: string }
  | { type: 'IME_END'; finalText: string }
  // F.2: Two-step ESC cancel - first ESC cancels composition, returns to editing
  | { type: 'IME_CANCEL_COMPOSITION' }
  | {
      type: 'COMMIT';
      direction: Direction | 'none';
      commitKey?: 'tab' | 'shift-tab' | 'enter' | 'shift-enter';
    }
  | { type: 'CANCEL' }
  | { type: 'BLUR' }
  | { type: 'PICKER_COMMIT'; value: unknown; direction: Direction | 'none' }
  | {
      type: 'DATE_PICKER_COMMIT';
      isoDate: string;
      kind: 'date' | 'datetime';
      direction: Direction | 'none';
    }
  | {
      type: 'FORMULA_RANGE_SELECTED';
      range: CellRange;
      color: string;
      /**
       * Optional structured reference text.
       * When provided, this text is inserted instead of the A1 reference.
       * Used for table column references like [@Column] or TableName[Column].
       */
      structuredRef?: string;
      /** Target sheet ID — used to detect cross-sheet references */
      sheetId?: string;
      /** Target sheet name — used to produce qualified A1 like Sheet2!B3 */
      sheetName?: string;
    }
  | { type: 'VALIDATION_SUCCESS' }
  | { type: 'VALIDATION_ERROR'; message: string }
  | { type: 'COMMIT_COMPLETE' }
  | { type: 'COMMIT_REJECTED'; reason: string }
  | { type: 'RETRY' }
  | { type: 'REMOTE_CELL_CHANGED'; cell: CellCoord; newValue: unknown }
  | { type: 'REMOTE_CELL_DELETED'; cell: CellCoord }
  | { type: 'REMOTE_SHEET_DELETED'; sheetId: string }
  // Focus-based keyboard handling events
  | { type: 'DIALOG_OPENED'; dialogId: string }
  | { type: 'DIALOG_CLOSED' }
  // Issue 2: Cell Dropdowns / In-Cell Pickers
  | {
      type: 'SET_EDITOR_TYPE';
      editorType: CellEditorType;
      cellSchema: CellSchema | null;
      enumItems: unknown[] | null;
    }
  | { type: 'CLEAR_PENDING_PICKER_INTENT' }
  | { type: 'OPEN_PICKER' }
  | { type: 'CLOSE_PICKER' }
  | { type: 'PICKER_SELECT'; value: unknown }
  | { type: 'REMOTE_SCHEMA_CHANGED'; cell: CellCoord }
  // Issue 1: Structure Change Coordination - Cancel editing when structure changes affect edit cell
  | { type: 'STRUCTURE_CHANGE'; sheetId: string; change: StructureChange }
  // Issue 5: Remote Structure Changes - Cancel editing when remote user inserts/deletes rows/columns
  | {
      type: 'REMOTE_STRUCTURE_CHANGE';
      sheetId: string;
      operation: 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns';
      startIndex: number;
      count: number;
    }
  // Formula editing: F4 to cycle absolute/relative references
  | { type: 'CYCLE_REFERENCE' }
  // Array formula entry (Ctrl+Shift+Enter)
  | { type: 'ENTER_ARRAY_FORMULA' }
  // Insert function arguments (Ctrl+Shift+A)
  | { type: 'INSERT_FUNCTION_ARGS' }
  // Autocomplete events
  | { type: 'SHOW_SUGGESTIONS' }
  | { type: 'HIDE_SUGGESTIONS' }
  | { type: 'SELECT_SUGGESTION'; index: number }
  | { type: 'ACCEPT_SUGGESTION'; name: string }
  | { type: 'NAVIGATE_SUGGESTION'; direction: 'up' | 'down' }
  // Toggle between Enter Mode and Edit Mode
  | { type: 'TOGGLE_EDIT_MODE' }
  // Cursor movement events (for Edit Mode)
  | { type: 'CURSOR_MOVE_LEFT' }
  | { type: 'CURSOR_MOVE_RIGHT' }
  | { type: 'CURSOR_MOVE_WORD_LEFT' }
  | { type: 'CURSOR_MOVE_WORD_RIGHT' }
  | { type: 'CURSOR_MOVE_START' } // Home key
  | { type: 'CURSOR_MOVE_END' } // End key
  // Text selection events (Shift+Arrow)
  | { type: 'SELECT_LEFT' }
  | { type: 'SELECT_RIGHT' }
  | { type: 'SELECT_WORD_LEFT' }
  | { type: 'SELECT_WORD_RIGHT' }
  | { type: 'SELECT_TO_START' } // Shift+Home
  | { type: 'SELECT_TO_END' } // Shift+End
  | { type: 'SELECT_ALL' } // Ctrl+A
  // Alt+Enter: Insert newline in cell (8.5 Multi-Line Editing)
  | { type: 'INSERT_NEWLINE' }
  // B.1: Cursor navigation in multi-line cells (Edit Mode)
  // These events signal that vertical cursor movement should happen
  // The browser handles the actual movement via native input behavior
  | { type: 'CURSOR_UP' }
  | { type: 'CURSOR_DOWN' }
  // B.3: Word deletion (Edit Mode)
  // These events signal word-level deletion should happen
  // The browser handles the actual deletion via native input behavior
  | { type: 'DELETE_WORD_FORWARD' }
  | { type: 'DELETE_WORD_BACKWARD' }
  // Ctrl+K: Delete to end of line (Edit Mode)
  | { type: 'DELETE_TO_END_OF_LINE' }
  // Rich Text Editing Events
  | { type: 'CHAR_SELECTION_CHANGED'; start: number; end: number }
  | { type: 'APPLY_CHAR_FORMAT'; format: Partial<TextFormat> }
  | { type: 'CLEAR_CHAR_FORMAT' }
  | { type: 'INPUT_RICH_TEXT'; segments: RichTextSegment[] }
  // Start editing in rich text mode explicitly
  | { type: 'START_RICH_TEXT_EDITING'; segments: RichTextSegment[] }
  // C.3/H.3: Update formula range reference after drag-resize
  | { type: 'UPDATE_FORMULA_RANGE'; rangeIndex: number; newRange: CellRange }
  // Dependency injection: Set function registry for formula argument hints
  | { type: 'SET_FUNCTION_REGISTRY'; registry: IFunctionRegistry };

// =============================================================================
// INITIAL CONTEXT
// =============================================================================

export const initialEditorContext: EditorContext = {
  isEditMode: false,
  editingCell: null,
  sheetId: null,
  mergeBounds: null,
  value: '',
  formulaInputIsLiteral: false,
  cursorPosition: 0,
  selectionAnchor: 0,
  hasSelection: false,
  currentRangeColor: FORMULA_RANGE_COLORS[0],
  rangeColorIndex: 0,
  hasConflict: false,
  errorMessage: null,
  commitDirection: null,
  datePickerCommit: null,
  commitKey: null,
  compositionText: '',
  wasRemotelyDeleted: false,
  wasSheetDeleted: false,
  pausedForDialog: false,
  wasStructurallyCancelled: false,
  functionRegistry: null,
  editorType: 'text',
  cellSchema: null,
  enumItems: null,
  isPickerOpen: false,
  pendingOpenDropdown: false,
  formulaContext: null,
  isSuggestionsOpen: false,
  selectedSuggestionIndex: 0,
  isArgumentHintOpen: false,
  isArrayFormula: false,
  editStartSelectionRanges: null,
  commitActiveCell: null,
  commitSelectionRanges: null,
  formulaRefInsertStart: null,
  formulaRefInsertEnd: null,
  richTextSegments: null,
  charSelectionStart: 0,
  charSelectionEnd: 0,
  hasCharSelection: false,
  currentFormat: null,
};
