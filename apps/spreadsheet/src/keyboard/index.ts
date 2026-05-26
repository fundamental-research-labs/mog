/**
 * Spreadsheet Keyboard Module
 *
 * App-specific keyboard shortcuts, actions, and utilities.
 * Infrastructure (processor, matcher, binding utils, types) stays in @mog-sdk/kernel/keyboard.
 */

export type {
  KeyboardShortcut,
  KeyboardShortcutBase,
  ShortcutCategory,
  ShortcutContext,
  ShortcutHandler,
  ShortcutMatchResult,
  ShortcutRegistry,
} from './types';

// Shortcut definitions (247 Excel shortcuts)
export {
  ACCESSIBILITY_SHORTCUTS,
  CLIPBOARD_SHORTCUTS,
  COMMENTS_SHORTCUTS,
  DATA_SHORTCUTS,
  EDITING_SHORTCUTS,
  FORMATTING_SHORTCUTS,
  FORMULA_SHORTCUTS,
  KEYBOARD_SHORTCUTS,
  NAVIGATION_SHORTCUTS,
  OBJECT_SHORTCUTS,
  SELECTION_SHORTCUTS,
  VIEW_SHORTCUTS,
  WORKBOOK_SHORTCUTS,
  getShortcutById,
  getShortcutStats,
  getShortcutsByCategory,
  getShortcutsByContext,
  validateShortcutIds,
} from './definitions';

// Action types & routing
export type {
  ActionTarget,
  ClipboardKeyboardAction,
  DataKeyboardAction,
  DialogKeyboardAction,
  EditorKeyboardAction,
  FileKeyboardAction,
  FormattingKeyboardAction,
  KeyboardAction,
  NavigationKeyboardAction,
  ObjectKeyboardAction,
  SelectionKeyboardAction,
  ViewKeyboardAction,
  WorkbookKeyboardAction,
} from './actions';

export { ACTION_TARGET_MAP } from './actions';

// Excel reference data
export type { ExcelShortcutReference } from './excel-reference';

export {
  EXCEL_REFERENCE,
  getImplementationGaps,
  getReferenceByCategory,
  getReferenceByMappedId,
  getReferenceCategories,
  getReferenceCoverage,
} from './excel-reference';

// Display utilities
export {
  formatMultipleShortcuts,
  getHelpDisplay,
  toDisplayString,
  toDisplayStringForPlatform,
  toLinuxDisplayString,
  toMacDisplayString,
  toShortcutDisplayString,
  toWindowsDisplayString,
} from './display-utils';

// Customization
export type {
  BuiltInProfileId,
  ConflictResult,
  CustomBinding,
  KeyboardProfile,
  SerializedProfile,
} from './customization';

export {
  BUILT_IN_PROFILES,
  applyCustomizations,
  copyProfile,
  createProfile,
  detectConflict,
  exportProfile,
  findShortcutsByBinding,
  importProfile,
  removeProfileBinding,
  updateProfileBinding,
} from './customization';
