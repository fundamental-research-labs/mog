/**
 * Editor Machine Guards
 *
 * Guard functions for the editor state machine that control state transitions.
 * Guards check conditions before allowing transitions to occur.
 */

import type { EditorContext, EditorEvent } from './types';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a value starts with a formula prefix (=, +, or -)
 */
function isFormula(value: string): boolean {
  const firstChar = value.charAt(0);
  return firstChar === '=' || firstChar === '+' || firstChar === '-';
}

// =============================================================================
// FORMULA GUARDS
// =============================================================================

/**
 * Check if value starts with formula prefix (=, +, or -)
 */
export const isFormulaGuard = ({ context }: { context: EditorContext }) =>
  !context.formulaInputIsLiteral && isFormula(context.value);

/**
 * Check if input would start a formula (=, +, or -)
 */
export const inputStartsFormula = ({
  context,
  event,
}: {
  context: EditorContext;
  event: EditorEvent;
}) => {
  if (event.type !== 'INPUT') return false;
  if (context.formulaInputIsLiteral) return false;
  const firstChar = event.value.charAt(0);
  return firstChar === '=' || firstChar === '+' || firstChar === '-';
};

/**
 * Check if input would exit formula mode (no longer starts with =, +, or -)
 */
export const inputExitsFormula = ({ event }: { event: EditorEvent }) => {
  if (event.type !== 'INPUT') return false;
  const firstChar = event.value.charAt(0);
  return firstChar !== '=' && firstChar !== '+' && firstChar !== '-';
};

// =============================================================================
// MODE GUARDS
// =============================================================================

/**
 * Check if we should enter Edit Mode based on entryMode.
 * F2, double-click, or formula bar click → Edit Mode
 * Typing (default) → Enter Mode
 *
 */
export const shouldEnterEditMode = ({ event }: { event: EditorEvent }) => {
  if (event.type !== 'START_EDITING') return false;
  const entryMode = event.entryMode ?? 'typing';
  return entryMode === 'F2' || entryMode === 'doubleClick' || entryMode === 'formulaBar';
};

/**
 * Check if currently in Edit Mode (for returning from IME/error states).
 * Uses the isEditMode context flag which is the source of truth.
 */
export const isInEditMode = ({ context }: { context: EditorContext }) => context.isEditMode;

// =============================================================================
// SHEET/CELL GUARDS
// =============================================================================

/**
 * Check if remote sheet deletion affects the sheet we're editing on
 */
export const isEditingOnThisSheet = ({
  context,
  event,
}: {
  context: EditorContext;
  event: EditorEvent;
}) => {
  if (event.type !== 'REMOTE_SHEET_DELETED') return false;
  return context.sheetId === event.sheetId;
};

// =============================================================================
// EDITOR TYPE GUARDS
// =============================================================================

/**
 * Check if editor type is dropdown (should show dropdown picker)
 *
 * @see Issue-2-Cell-Dropdowns-InCell-Pickers.md
 */
export const isDropdownEditor = ({ context }: { context: EditorContext }) =>
  context.editorType === 'dropdown';

/**
 * Check if editor type is checkbox (should toggle directly)
 *
 * @see Issue-2-Cell-Dropdowns-InCell-Pickers.md
 */
export const isCheckboxEditor = ({ context }: { context: EditorContext }) =>
  context.editorType === 'checkbox';

/**
 * Check if picker is currently open
 *
 * @see Issue-2-Cell-Dropdowns-InCell-Pickers.md
 */
export const isPickerOpen = ({ context }: { context: EditorContext }) => context.isPickerOpen;

// =============================================================================
// AUTOCOMPLETE GUARDS
// =============================================================================

/**
 * Check if suggestions are currently open
 *
 * Autocomplete
 */
export const isSuggestionsOpen = ({ context }: { context: EditorContext }) =>
  context.isSuggestionsOpen;

/**
 * Check if argument hint is currently open
 *
 * Autocomplete
 */
export const isArgumentHintOpen = ({ context }: { context: EditorContext }) =>
  context.isArgumentHintOpen;

// =============================================================================
// RICH TEXT GUARDS
// =============================================================================

/**
 * Check if we're currently in rich text editing state
 *
 */
export const isRichTextEditing = ({ context }: { context: EditorContext }) =>
  context.richTextSegments !== null;

/**
 * Check if there's a character-level selection
 *
 */
export const hasCharSelection = ({ context }: { context: EditorContext }) =>
  context.hasCharSelection;

// =============================================================================
// GUARDS OBJECT FOR MACHINE CONFIG
// =============================================================================

/**
 * All editor guards exported as an object for use in the machine setup() config.
 *
 * Note: 'isFormula' uses 'isFormulaGuard' to avoid naming conflict with helper function.
 */
export const editorGuards = {
  isFormula: isFormulaGuard,
  inputStartsFormula,
  inputExitsFormula,
  shouldEnterEditMode,
  isInEditMode,
  isEditingOnThisSheet,
  isDropdownEditor,
  isCheckboxEditor,
  isPickerOpen,
  isSuggestionsOpen,
  isArgumentHintOpen,
  isRichTextEditing,
  hasCharSelection,
};
