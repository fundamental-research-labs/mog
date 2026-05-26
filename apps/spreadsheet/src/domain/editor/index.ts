/**
 * Editor Utilities
 *
 * Pure utility functions for cell editing and formula autocomplete.
 *
 */

// Formula context analyzer
export {
  analyzeFormulaContext,
  isInsideString,
  type FormulaContext,
  type FunctionStackEntry,
} from './formula-context';

// Rich text selection manager
export {
  RichTextSelectionManager,
  richTextSelectionManager,
  type CharacterOffsets,
} from './selection-manager';

// Cursor position utilities
export {
  calculateFlipPosition,
  clampToViewport,
  getArgumentHintPosition,
  getAutoCompletePosition,
  type CellGeometryLike,
  type CursorScreenPosition,
  type PopupSize,
} from './cursor-position';

// Name completion utilities
export {
  detectTableRefContext,
  formatNameForInsertion,
  getNameSuggestionIcon,
  getNameSuggestions,
  type DefinedNameDefinition,
  type NameCompletionStoreLike,
  type NameSuggestion,
  type NameSuggestionType,
  type SheetInfo,
  type TableInfo,
  type TableRefContext,
} from './name-completion';
