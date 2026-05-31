/**
 * Editor State Machine
 *
 * Manages the cell editing lifecycle including:
 * - Activation and initialization
 * - Text and formula editing
 * - Dropdown/picker editing (Issue 2: Cell Dropdowns)
 * - IME composition (CJK input)
 * - Validation and commit
 * - Remote collaboration events
 *
 * Architecture:
 * - Uses nested states under `editing` to reduce REMOTE_* handler duplication
 * - `editorType` in context determines which editor UI to render
 * - Coordinator handles schema lookup and sends SET_EDITOR_TYPE
 * - Logic has been extracted into separate modules for maintainability
 *
 * @see ARCHITECTURE.md for design decisions
 * @see Issue-2-Cell-Dropdowns-InCell-Pickers.md for dropdown architecture
 */

import { and, fromPromise, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';
// Extracted modules - Complete decomposition
import { autocompleteActions } from './editor/autocomplete';
import { coreActions } from './editor/core-actions';
import { cursorMovementActions } from './editor/cursor-movement';
import { formulaEditingActions } from './editor/formula-editing';
import { editorGuards } from './editor/guards';
import { pickerActions } from './editor/picker';
import { richTextActions } from './editor/rich-text';
// Types and events extracted to separate modules
import { initialEditorContext, type EditorContext, type EditorEvent } from './editor/types';

// =============================================================================
// EDITOR MACHINE
// =============================================================================

export const editorMachine = setup({
  types: {
    context: {} as EditorContext,
    events: {} as EditorEvent,
  },
  actors: {
    /**
     * Async service for committing a cell value to the engine.
     * Default: resolves immediately (for tests without .provide()).
     * Production: provided via .provide() in GridEditingSystem to call the bridge.
     *
     */
    commitCellValue: fromPromise<void, EditorContext>(async () => {}),
  },
  guards: {
    ...editorGuards,
  },
  // @ts-expect-error - Actions are properly typed but XState v5 cannot infer types across module boundaries
  actions: {
    ...coreActions,
    ...cursorMovementActions,
    ...formulaEditingActions,
    ...autocompleteActions,
    ...richTextActions,
    ...pickerActions,
    // Provided via .provide() in production — no-op default for tests
    reReadFromEngine: () => {},
    // Provided via .provide() — snapshots selection activeCell + ranges into
    // editor context so commitCellValue reads from input, not raw .getSnapshot().
    // @see Rule 18: no raw .getSnapshot() in fromPromise services
    snapshotSelectionForCommit: () => {},
  },
}).createMachine({
  id: 'editor',
  initial: 'inactive',
  context: initialEditorContext,

  states: {
    /**
     * INACTIVE: No editing in progress
     * Waiting for START_EDITING or START_RICH_TEXT_EDITING event
     */
    inactive: {
      on: {
        START_EDITING: {
          target: 'activating',
          actions: 'initializeEditing',
        },
        // Direct entry to rich text editing
        START_RICH_TEXT_EDITING: {
          target: 'richTextEditing.editMode',
          actions: 'startRichTextEditing',
        },
        // Dependency injection: Set function registry from coordinator
        SET_FUNCTION_REGISTRY: {
          actions: 'setFunctionRegistry',
        },
        // Intentional no-ops: not editing, so remote changes don't affect us
        REMOTE_CELL_CHANGED: { actions: [] },
        REMOTE_CELL_DELETED: { actions: [] },
        REMOTE_SHEET_DELETED: { actions: [] },
      },
    },

    /**
     * ACTIVATING: Preparing to edit
     * Short transition state for any async setup (fetching initial value, etc.)
     * In synchronous case, immediately transitions to editing
     *
     * Uses guarded transitions to determine initial substate
     * based on both isFormula and shouldEnterEditMode guards.
     */
    activating: {
      always: [
        // Formula mode with Edit Mode entry (F2/double-click/formula bar on formula cell)
        {
          guard: and(['isFormula', 'shouldEnterEditMode']),
          target: 'formulaEditing.editMode',
          actions: ['resetFormulaColors', 'computeFormulaContext'],
        },
        // Formula mode with Enter Mode entry (typing '=' to start formula)
        {
          guard: 'isFormula',
          target: 'formulaEditing.enterMode',
          actions: ['resetFormulaColors', 'computeFormulaContext'],
        },
        // Regular editing with Edit Mode entry (F2/double-click/formula bar)
        {
          guard: 'shouldEnterEditMode',
          target: 'editing.editMode',
        },
        // Regular editing with Enter Mode entry (typing characters - default)
        { target: 'editing.enterMode' },
      ],
      on: {
        // Can also be triggered externally when async setup is done
        ACTIVATED: [
          {
            guard: and(['isFormula', 'shouldEnterEditMode']),
            target: 'formulaEditing.editMode',
            actions: ['resetFormulaColors', 'computeFormulaContext'],
          },
          {
            guard: 'isFormula',
            target: 'formulaEditing.enterMode',
            actions: ['resetFormulaColors', 'computeFormulaContext'],
          },
          {
            guard: 'shouldEnterEditMode',
            target: 'editing.editMode',
          },
          { target: 'editing.enterMode' },
        ],
        CANCEL: {
          target: 'inactive',
          actions: 'resetContext',
        },
      },
    },

    /**
     * EDITING: Normal text/number editing
     * May transition to formulaEditing if user types =
     *
     * Nested states for Enter Mode vs Edit Mode
     * - enterMode: Arrow keys commit and move selection
     * - editMode: Arrow keys move cursor within text
     *
     * Issue 2: Also handles dropdown/picker editing via SET_EDITOR_TYPE
     */
    editing: {
      // Default substate - guarded transitions from activating override this
      initial: 'enterMode',

      // Nested substates for Enter/Edit mode
      states: {
        /**
         * Enter Mode: Arrow keys commit and move selection.
         * Activated by: typing directly into a cell.
         */
        enterMode: {
          on: {
            TOGGLE_EDIT_MODE: {
              target: 'editMode',
              actions: 'toggleEditMode',
            },
          },
        },
        /**
         * Edit Mode: Arrow keys move cursor within text.
         * Activated by: F2, double-click, formula bar click.
         *
         * Cursor movement events only handled in Edit Mode.
         */
        editMode: {
          on: {
            TOGGLE_EDIT_MODE: {
              target: 'enterMode',
              actions: 'toggleEditMode',
            },
            // Cursor movement in Edit Mode
            CURSOR_MOVE_LEFT: { actions: 'moveCursorLeft' },
            CURSOR_MOVE_RIGHT: { actions: 'moveCursorRight' },
            CURSOR_MOVE_WORD_LEFT: { actions: 'moveCursorWordLeft' },
            CURSOR_MOVE_WORD_RIGHT: { actions: 'moveCursorWordRight' },
            CURSOR_MOVE_START: { actions: 'moveCursorToStart' },
            CURSOR_MOVE_END: { actions: 'moveCursorToEnd' },
            // B.1: Vertical cursor movement in multi-line cells
            CURSOR_UP: { actions: 'moveCursorUp' },
            CURSOR_DOWN: { actions: 'moveCursorDown' },
            // Text selection in Edit Mode
            SELECT_LEFT: { actions: 'selectLeft' },
            SELECT_RIGHT: { actions: 'selectRight' },
            SELECT_WORD_LEFT: { actions: 'selectWordLeft' },
            SELECT_WORD_RIGHT: { actions: 'selectWordRight' },
            SELECT_TO_START: { actions: 'selectToStart' },
            SELECT_TO_END: { actions: 'selectToEnd' },
            SELECT_ALL: { actions: 'selectAll' },
            // B.3: Word deletion in Edit Mode
            DELETE_WORD_FORWARD: { actions: 'deleteWordForward' },
            DELETE_WORD_BACKWARD: { actions: 'deleteWordBackward' },
            DELETE_TO_END_OF_LINE: { actions: 'deleteToEndOfLine' },
          },
        },
      },

      // Common events that apply to both Enter Mode and Edit Mode
      on: {
        INPUT: [
          // If input starts with =, transition to formula editing with autocomplete
          // Typing '=' always goes to Enter Mode (for inserting references with arrows)
          {
            guard: 'inputStartsFormula',
            target: 'formulaEditing.enterMode',
            actions: ['updateValue', 'setEnterMode', 'resetFormulaColors', 'computeFormulaContext'],
          },
          // Normal input - also close picker if open (typing overrides dropdown)
          { actions: ['updateValue', 'closePicker'] },
        ],
        SET_CURSOR: { actions: 'setCursor' },
        TEXT_SELECTION_CHANGED: { actions: 'setTextSelection' },
        START_RICH_TEXT_EDITING: {
          target: 'richTextEditing.editMode',
          actions: 'startRichTextEditing',
        },
        IME_START: { target: 'imeComposing', actions: ['startIMEComposition', 'closePicker'] },
        COMMIT: { target: 'validating', actions: ['storeCommitDirection', 'closePicker'] },
        PICKER_COMMIT: { target: 'validating', actions: ['applyPickerCommit', 'closePicker'] },
        DATE_PICKER_COMMIT: {
          target: 'validating',
          actions: ['applyDatePickerCommit', 'closePicker'],
        },
        CANCEL: { target: 'inactive', actions: ['resetContext', 'resetPickerState'] },
        // 8.5 Multi-Line Editing: Alt+Enter inserts newline at cursor
        INSERT_NEWLINE: { actions: 'insertNewlineAtCursor' },

        // Issue 2: Cell Dropdowns / In-Cell Pickers
        SET_EDITOR_TYPE: { actions: 'setEditorType' },
        CLEAR_PENDING_PICKER_INTENT: { actions: 'clearPendingPickerIntent' },
        OPEN_PICKER: { actions: 'openPicker' },
        CLOSE_PICKER: { actions: 'closePicker' },
        PICKER_SELECT: {
          // When selecting from picker, update value and close, then commit
          actions: 'handlePickerSelect',
          // Note: Component should call COMMIT after this if auto-commit is desired
        },

        // Remote collaboration events
        // NOTE: Guards removed - coordinator filters events before sending them
        // If the machine receives the event, it applies to the editing cell
        // @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
        REMOTE_CELL_CHANGED: {
          actions: 'setConflict',
          // Stay in editing - let user decide
        },
        REMOTE_CELL_DELETED: {
          target: 'inactive',
          actions: ['resetWithRemotelyDeleted', 'resetPickerState'],
        },
        REMOTE_SHEET_DELETED: [
          {
            guard: 'isEditingOnThisSheet',
            target: 'inactive',
            actions: ['resetWithSheetDeleted', 'resetPickerState'],
          },
        ],
        // Issue 2: Handle remote schema changes
        REMOTE_SCHEMA_CHANGED: {
          actions: ['setConflict', 'closePicker'],
          // Stay in editing - show conflict indicator, close picker
        },

        // Issue 1: Structure Change Coordination
        // Cancel editing - coordinator only sends this if cell is affected
        STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: ['cancelForStructureChange', 'resetPickerState'],
        },

        // Issue 5: Remote Structure Change Collaboration
        // Cancel editing - coordinator only sends this if cell is affected
        REMOTE_STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: ['cancelForStructureChange', 'resetPickerState'],
        },

        // Focus-based keyboard handling events
        DIALOG_OPENED: { actions: ['setPausedForDialog', 'closePicker'] },
        DIALOG_CLOSED: { actions: 'clearPausedForDialog' },
      },
    },

    /**
     * FORMULA_EDITING: Editing a formula with range highlighting
     * Supports FORMULA_RANGE_SELECTED from selection machine
     *
     * Nested states for Enter Mode vs Edit Mode
     * - enterMode: Arrow keys insert cell references into formula
     * - editMode: Arrow keys move cursor within formula text
     */
    formulaEditing: {
      // Default substate - guarded transitions from activating override this
      initial: 'enterMode',

      // Nested substates for Enter/Edit mode
      states: {
        /**
         * Enter Mode: Arrow keys insert cell references into formula.
         * Activated by: typing '=' to start a formula.
         */
        enterMode: {
          on: {
            TOGGLE_EDIT_MODE: {
              target: 'editMode',
              actions: 'toggleEditMode',
            },
          },
        },
        /**
         * Edit Mode: Arrow keys move cursor within formula text.
         * Activated by: F2 on a formula cell, double-click, formula bar click.
         *
         * Cursor movement events only handled in Edit Mode.
         */
        editMode: {
          on: {
            TOGGLE_EDIT_MODE: {
              target: 'enterMode',
              actions: 'toggleEditMode',
            },
            // Cursor movement in Edit Mode
            CURSOR_MOVE_LEFT: { actions: 'moveCursorLeft' },
            CURSOR_MOVE_RIGHT: { actions: 'moveCursorRight' },
            CURSOR_MOVE_WORD_LEFT: { actions: 'moveCursorWordLeft' },
            CURSOR_MOVE_WORD_RIGHT: { actions: 'moveCursorWordRight' },
            CURSOR_MOVE_START: { actions: 'moveCursorToStart' },
            CURSOR_MOVE_END: { actions: 'moveCursorToEnd' },
            // B.1: Vertical cursor movement in multi-line cells
            CURSOR_UP: { actions: 'moveCursorUp' },
            CURSOR_DOWN: { actions: 'moveCursorDown' },
            // Text selection in Edit Mode
            SELECT_LEFT: { actions: 'selectLeft' },
            SELECT_RIGHT: { actions: 'selectRight' },
            SELECT_WORD_LEFT: { actions: 'selectWordLeft' },
            SELECT_WORD_RIGHT: { actions: 'selectWordRight' },
            SELECT_TO_START: { actions: 'selectToStart' },
            SELECT_TO_END: { actions: 'selectToEnd' },
            SELECT_ALL: { actions: 'selectAll' },
            // B.3: Word deletion in Edit Mode
            DELETE_WORD_FORWARD: { actions: 'deleteWordForward' },
            DELETE_WORD_BACKWARD: { actions: 'deleteWordBackward' },
            DELETE_TO_END_OF_LINE: { actions: 'deleteToEndOfLine' },
          },
        },
      },

      // Common events that apply to both Enter Mode and Edit Mode
      on: {
        INPUT: [
          // If input no longer starts with =, exit formula mode
          // Preserve Edit Mode / Enter Mode when exiting formula mode
          {
            guard: and(['inputExitsFormula', 'isInEditMode']),
            target: 'editing.editMode',
            actions: ['updateValue', 'resetAutocompleteState'],
          },
          {
            guard: 'inputExitsFormula',
            target: 'editing.enterMode',
            actions: ['updateValue', 'resetAutocompleteState'],
          },
          // Normal formula input - compute formula context for autocomplete
          { actions: ['updateValue', 'computeFormulaContext'] },
        ],
        SET_CURSOR: { actions: ['setCursor', 'computeFormulaContext'] },
        TEXT_SELECTION_CHANGED: { actions: ['setTextSelection', 'computeFormulaContext'] },
        IME_START: { target: 'imeComposing', actions: ['startIMEComposition', 'hideSuggestions'] },
        FORMULA_RANGE_SELECTED: { actions: ['insertFormulaRange', 'computeFormulaContext'] },
        // C.3/H.3: Update formula range reference after drag-resize
        UPDATE_FORMULA_RANGE: { actions: ['updateFormulaRange', 'computeFormulaContext'] },
        // F4: Cycle absolute/relative reference
        CYCLE_REFERENCE: { actions: ['cycleReference', 'computeFormulaContext'] },
        COMMIT: {
          target: 'validating',
          actions: [
            'completePointModeFormulaForCommit',
            'storeCommitDirection',
            'resetAutocompleteState',
          ],
        },
        // Ctrl+Shift+Enter to commit as array formula (CSE)
        ENTER_ARRAY_FORMULA: {
          target: 'validating',
          actions: ['setArrayFormulaAndCommit', 'resetAutocompleteState'],
        },
        // Insert function arguments (Ctrl+Shift+A)
        INSERT_FUNCTION_ARGS: { actions: 'insertFunctionArgs' },
        // Two-step Escape: first Escape dismisses autocomplete (if open),
        // second Escape cancels editing entirely. Excel parity.
        CANCEL: [
          {
            guard: 'isSuggestionsOpen',
            actions: 'hideSuggestions',
          },
          {
            target: 'inactive',
            actions: ['resetContext', 'resetAutocompleteState'],
          },
        ],
        // 8.5 Multi-Line Editing: Alt+Enter inserts newline at cursor
        INSERT_NEWLINE: { actions: 'insertNewlineAtCursor' },

        // Autocomplete events
        SHOW_SUGGESTIONS: { actions: 'showSuggestions' },
        HIDE_SUGGESTIONS: { actions: 'hideSuggestions' },
        SELECT_SUGGESTION: { actions: 'selectSuggestion' },
        ACCEPT_SUGGESTION: { actions: 'acceptSuggestion' },
        NAVIGATE_SUGGESTION: { actions: 'navigateSuggestion' },

        // Remote collaboration events - guards removed, coordinator filters
        // @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
        REMOTE_CELL_CHANGED: { actions: 'setConflict' },
        REMOTE_CELL_DELETED: {
          target: 'inactive',
          actions: ['resetWithRemotelyDeleted', 'resetAutocompleteState'],
        },
        REMOTE_SHEET_DELETED: [
          {
            guard: 'isEditingOnThisSheet',
            target: 'inactive',
            actions: ['resetWithSheetDeleted', 'resetAutocompleteState'],
          },
        ],

        // Issue 1: Structure Change Coordination - coordinator filters
        STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: ['cancelForStructureChange', 'resetAutocompleteState'],
        },

        // Issue 5: Remote Structure Change - coordinator filters
        REMOTE_STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: ['cancelForStructureChange', 'resetAutocompleteState'],
        },

        // Focus-based keyboard handling events
        DIALOG_OPENED: { actions: ['setPausedForDialog', 'hideSuggestions'] },
        DIALOG_CLOSED: { actions: 'clearPausedForDialog' },
      },
    },

    /**
     * RICH_TEXT_EDITING: Editing rich text content with character-level formatting
     * Supports character selection and partial text formatting.
     *
     * Rich Text Editor Implementation
     *
     * Nested states for Enter Mode vs Edit Mode (similar to editing/formulaEditing):
     * - enterMode: Arrow keys commit and move selection
     * - editMode: Arrow keys move cursor within text (character-level)
     */
    richTextEditing: {
      initial: 'enterMode',

      // Entry action to initialize rich text state
      entry: 'startRichTextEditing',

      states: {
        /**
         * Enter Mode: Arrow keys commit edit and move cell selection.
         * Activated by: typing directly into a rich text cell.
         */
        enterMode: {
          on: {
            TOGGLE_EDIT_MODE: {
              target: 'editMode',
              actions: 'toggleEditMode',
            },
          },
        },

        /**
         * Edit Mode: Arrow keys move cursor within rich text.
         * Character selection supported for partial formatting.
         * Activated by: F2, double-click, formula bar click.
         */
        editMode: {
          on: {
            TOGGLE_EDIT_MODE: {
              target: 'enterMode',
              actions: 'toggleEditMode',
            },
            // Character selection changed (from RichTextEditor component)
            CHAR_SELECTION_CHANGED: { actions: 'updateCharSelection' },
            // Cursor movement in Edit Mode
            CURSOR_MOVE_LEFT: { actions: 'moveCursorLeft' },
            CURSOR_MOVE_RIGHT: { actions: 'moveCursorRight' },
            CURSOR_MOVE_WORD_LEFT: { actions: 'moveCursorWordLeft' },
            CURSOR_MOVE_WORD_RIGHT: { actions: 'moveCursorWordRight' },
            CURSOR_MOVE_START: { actions: 'moveCursorToStart' },
            CURSOR_MOVE_END: { actions: 'moveCursorToEnd' },
            // B.1: Vertical cursor movement in multi-line cells
            CURSOR_UP: { actions: 'moveCursorUp' },
            CURSOR_DOWN: { actions: 'moveCursorDown' },
            // Text selection in Edit Mode
            SELECT_LEFT: { actions: 'selectLeft' },
            SELECT_RIGHT: { actions: 'selectRight' },
            SELECT_WORD_LEFT: { actions: 'selectWordLeft' },
            SELECT_WORD_RIGHT: { actions: 'selectWordRight' },
            SELECT_TO_START: { actions: 'selectToStart' },
            SELECT_TO_END: { actions: 'selectToEnd' },
            SELECT_ALL: { actions: 'selectAll' },
            // B.3: Word deletion in Edit Mode
            DELETE_WORD_FORWARD: { actions: 'deleteWordForward' },
            DELETE_WORD_BACKWARD: { actions: 'deleteWordBackward' },
            DELETE_TO_END_OF_LINE: { actions: 'deleteToEndOfLine' },
          },
        },
      },

      // Common events that apply to both Enter Mode and Edit Mode
      on: {
        // Rich text input - update segments
        INPUT_RICH_TEXT: { actions: 'updateRichTextValue' },

        // Also handle plain text input (for compatibility)
        INPUT: { actions: 'updateValue' },

        // Character formatting events
        APPLY_CHAR_FORMAT: { actions: 'applyCharFormat' },
        CLEAR_CHAR_FORMAT: { actions: 'clearCharFormat' },

        SET_CURSOR: { actions: 'setCursor' },
        TEXT_SELECTION_CHANGED: { actions: 'setTextSelection' },
        IME_START: { target: 'imeComposing', actions: 'startIMEComposition' },
        COMMIT: {
          target: 'validating',
          actions: 'storeCommitDirection',
        },
        CANCEL: {
          target: 'inactive',
          actions: ['resetContext', 'resetRichTextState'],
        },
        // Multi-line editing support
        INSERT_NEWLINE: { actions: 'insertNewlineAtCursor' },

        // Remote collaboration events
        REMOTE_CELL_CHANGED: { actions: 'setConflict' },
        REMOTE_CELL_DELETED: {
          target: 'inactive',
          actions: ['resetWithRemotelyDeleted', 'resetRichTextState'],
        },
        REMOTE_SHEET_DELETED: [
          {
            guard: 'isEditingOnThisSheet',
            target: 'inactive',
            actions: ['resetWithSheetDeleted', 'resetRichTextState'],
          },
        ],

        // Structure change coordination
        STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: ['cancelForStructureChange', 'resetRichTextState'],
        },
        REMOTE_STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: ['cancelForStructureChange', 'resetRichTextState'],
        },

        // Focus-based keyboard handling events
        DIALOG_OPENED: { actions: 'setPausedForDialog' },
        DIALOG_CLOSED: { actions: 'clearPausedForDialog' },
      },
    },

    /**
     * IME_COMPOSING: IME composition in progress (CJK input)
     * Critical for international users - composition must complete before other actions
     */
    imeComposing: {
      on: {
        IME_UPDATE: { actions: 'updateIMEComposition' },
        IME_END: [
          // After IME ends, go back to appropriate editing mode and substate
          // Formula + Edit Mode → formulaEditing.editMode
          {
            guard: and(['isFormula', 'isInEditMode']),
            target: 'formulaEditing.editMode',
            actions: 'commitIMEComposition',
          },
          // Formula + Enter Mode → formulaEditing.enterMode
          {
            guard: 'isFormula',
            target: 'formulaEditing.enterMode',
            actions: 'commitIMEComposition',
          },
          // Regular + Edit Mode → editing.editMode
          {
            guard: 'isInEditMode',
            target: 'editing.editMode',
            actions: 'commitIMEComposition',
          },
          // Regular + Enter Mode (default) → editing.enterMode
          {
            target: 'editing.enterMode',
            actions: 'commitIMEComposition',
          },
        ],
        // F.2: Two-step ESC cancel - first ESC cancels composition only
        // Discards compositionText and returns to previous editing state.
        // A second ESC (now in editing state) will cancel the edit entirely.
        IME_CANCEL_COMPOSITION: [
          // Formula + Edit Mode → formulaEditing.editMode
          {
            guard: and(['isFormula', 'isInEditMode']),
            target: 'formulaEditing.editMode',
            actions: 'cancelIMEComposition',
          },
          // Formula + Enter Mode → formulaEditing.enterMode
          {
            guard: 'isFormula',
            target: 'formulaEditing.enterMode',
            actions: 'cancelIMEComposition',
          },
          // Regular + Edit Mode → editing.editMode
          {
            guard: 'isInEditMode',
            target: 'editing.editMode',
            actions: 'cancelIMEComposition',
          },
          // Regular + Enter Mode (default) → editing.enterMode
          {
            target: 'editing.enterMode',
            actions: 'cancelIMEComposition',
          },
        ],

        // IME carveout: the only blur→commit edge in this machine.
        // IME composition completes via DOM blur as a deliberate OS-level signal,
        // distinct from the spreadsheet's user-intent contract. All other states
        // (editing, formulaEditing, richTextEditing) treat blur as a side effect
        // and require an explicit COMMIT/CANCEL/PICKER_COMMIT to leave editing.
        BLUR: {
          target: 'validating',
          actions: ['commitIMEComposition', 'storeBlurAsCommit'],
        },

        COMMIT: {
          target: 'validating',
          actions: ['commitIMEComposition', 'storeCommitDirection'],
        },

        // IME must complete before these actions can happen
        // In practice, browser enforces this, but we model it explicitly
        // CANCEL (second ESC) cancels the entire edit
        CANCEL: {
          target: 'inactive',
          actions: 'resetContext',
        },

        // Remote events during IME - guards removed, coordinator filters
        // @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
        REMOTE_CELL_CHANGED: { actions: 'setConflict' },
        REMOTE_CELL_DELETED: {
          target: 'inactive',
          actions: 'resetWithRemotelyDeleted',
        },
        REMOTE_SHEET_DELETED: [
          {
            guard: 'isEditingOnThisSheet',
            target: 'inactive',
            actions: 'resetWithSheetDeleted',
          },
        ],

        // Issue 1: Structure Change Coordination - coordinator filters
        STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: 'cancelForStructureChange',
        },

        // Issue 5: Remote Structure Change - coordinator filters
        REMOTE_STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: 'cancelForStructureChange',
        },
      },
    },

    /**
     * VALIDATING: Checking value before commit
     * May involve async formula parsing, data validation rules, etc.
     *
     * Added RETRY handler for warning dialog "No" button.
     * User can choose to return to edit mode to correct the invalid value.
     */
    validating: {
      on: {
        VALIDATION_SUCCESS: { target: 'committing', actions: 'snapshotSelectionForCommit' },
        VALIDATION_ERROR: { target: 'error', actions: 'setValidationError' },
        CANCEL: { target: 'inactive', actions: 'resetContext' },
        // RETRY returns to appropriate editing state
        // This is triggered by "No" button in warning dialog
        RETRY: [
          // Formula + Edit Mode
          {
            guard: and(['isFormula', 'isInEditMode']),
            target: 'formulaEditing.editMode',
          },
          // Formula + Enter Mode
          { guard: 'isFormula', target: 'formulaEditing.enterMode' },
          // Regular + Edit Mode
          { guard: 'isInEditMode', target: 'editing.editMode' },
          // Regular + Enter Mode (default)
          { target: 'editing.enterMode' },
        ],
        RETRY_SELECT_ALL: [
          {
            guard: and(['isFormula', 'isInEditMode']),
            target: 'formulaEditing.editMode',
            actions: 'selectCurrentValue',
          },
          {
            guard: 'isFormula',
            target: 'formulaEditing.enterMode',
            actions: 'selectCurrentValue',
          },
          {
            guard: 'isInEditMode',
            target: 'editing.editMode',
            actions: 'selectCurrentValue',
          },
          { target: 'editing.enterMode', actions: 'selectCurrentValue' },
        ],

        // Remote events - guards removed, coordinator filters
        // @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
        REMOTE_CELL_CHANGED: { actions: 'setConflict' },
        REMOTE_CELL_DELETED: {
          target: 'inactive',
          actions: 'resetWithRemotelyDeleted',
        },
        REMOTE_SHEET_DELETED: [
          {
            guard: 'isEditingOnThisSheet',
            target: 'inactive',
            actions: 'resetWithSheetDeleted',
          },
        ],

        // Issue 1: Structure Change Coordination - coordinator filters
        STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: 'cancelForStructureChange',
        },

        // Issue 5: Remote Structure Change - coordinator filters
        REMOTE_STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: 'cancelForStructureChange',
        },
      },
    },

    /**
     * COMMITTING: Writing value to engine via async bridge call.
     * Uses xstate invoke to await the bridge promise — the machine stays in
     * `committing` until the write confirms (onDone) or fails (onError).
     *
     */
    committing: {
      invoke: {
        src: 'commitCellValue',
        input: ({ context }) => context,
        onDone: {
          target: 'inactive',
          actions: 'resetContext',
        },
        onError: {
          target: 'inactive',
          actions: ['reReadFromEngine', 'resetContext'],
        },
      },
      on: {
        // Backward compat: tests that manually send COMMIT_COMPLETE still work.
        // In production, the invoke's onDone handles the transition instead.
        COMMIT_COMPLETE: { target: 'inactive', actions: 'resetContext' },
        COMMIT_REJECTED: { target: 'inactive', actions: 'resetContext' },

        // Remote events - guards removed, coordinator filters
        // @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
        REMOTE_CELL_CHANGED: { actions: 'setConflict' },
        REMOTE_CELL_DELETED: {
          target: 'inactive',
          actions: 'resetWithRemotelyDeleted',
        },
        REMOTE_SHEET_DELETED: [
          {
            guard: 'isEditingOnThisSheet',
            target: 'inactive',
            actions: 'resetWithSheetDeleted',
          },
        ],

        // Issue 1: Structure Change Coordination - coordinator filters
        STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: 'cancelForStructureChange',
        },

        // Issue 5: Remote Structure Change - coordinator filters
        REMOTE_STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: 'cancelForStructureChange',
        },
      },
    },

    /**
     * ERROR: Validation failed, showing error
     * User can retry or cancel
     */
    error: {
      on: {
        RETRY: [
          // Go back to appropriate editing state and substate
          // Formula + Edit Mode
          {
            guard: and(['isFormula', 'isInEditMode']),
            target: 'formulaEditing.editMode',
            actions: 'clearError',
          },
          // Formula + Enter Mode
          { guard: 'isFormula', target: 'formulaEditing.enterMode', actions: 'clearError' },
          // Regular + Edit Mode
          { guard: 'isInEditMode', target: 'editing.editMode', actions: 'clearError' },
          // Regular + Enter Mode (default)
          { target: 'editing.enterMode', actions: 'clearError' },
        ],
        RETRY_SELECT_ALL: [
          {
            guard: and(['isFormula', 'isInEditMode']),
            target: 'formulaEditing.editMode',
            actions: ['clearError', 'selectCurrentValue'],
          },
          {
            guard: 'isFormula',
            target: 'formulaEditing.enterMode',
            actions: ['clearError', 'selectCurrentValue'],
          },
          {
            guard: 'isInEditMode',
            target: 'editing.editMode',
            actions: ['clearError', 'selectCurrentValue'],
          },
          { target: 'editing.enterMode', actions: ['clearError', 'selectCurrentValue'] },
        ],
        CANCEL: { target: 'inactive', actions: 'resetContext' },
        INPUT: [
          // Allow editing while in error state
          // New formula input goes to Enter Mode (typing '=' means Enter Mode)
          {
            guard: 'inputStartsFormula',
            target: 'formulaEditing.enterMode',
            actions: ['updateValue', 'setEnterMode', 'clearError', 'resetFormulaColors'],
          },
          // Regular input - preserve current mode
          {
            guard: 'isInEditMode',
            target: 'editing.editMode',
            actions: ['updateValue', 'clearError'],
          },
          { target: 'editing.enterMode', actions: ['updateValue', 'clearError'] },
        ],

        // Remote events - guards removed, coordinator filters
        // @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
        REMOTE_CELL_CHANGED: { actions: 'setConflict' },
        REMOTE_CELL_DELETED: {
          target: 'inactive',
          actions: 'resetWithRemotelyDeleted',
        },
        REMOTE_SHEET_DELETED: [
          {
            guard: 'isEditingOnThisSheet',
            target: 'inactive',
            actions: 'resetWithSheetDeleted',
          },
        ],

        // Issue 1: Structure Change Coordination - coordinator filters
        STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: 'cancelForStructureChange',
        },

        // Issue 5: Remote Structure Change - coordinator filters
        REMOTE_STRUCTURE_CHANGE: {
          target: 'inactive',
          actions: 'cancelForStructureChange',
        },
      },
    },
  },
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type EditorActor = ActorRefFrom<typeof editorMachine>;
export type EditorMachine = typeof editorMachine;
export type EditorState = SnapshotFrom<typeof editorMachine>;
