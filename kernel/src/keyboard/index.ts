/**
 * Keyboard Event Processing
 *
 * This module provides the single entry point for keyboard event handling
 * in the Spreadsheet OS. All keyboard events should be processed through
 * the KeyboardEventProcessor to get normalized, platform-agnostic input.
 *
 * Infrastructure only: processor, matcher, physical-key utils, input utils,
 * binding utils, and shortcut types. App-specific code (shortcut definitions,
 * actions, display utils, customization, excel reference) lives in
 * apps/spreadsheet/src/keyboard/.
 *
 */

// =============================================================================
// Processor
// =============================================================================

export { KeyboardEventProcessor, createTestKeyboardInput } from './processor';
export type { PartialTestKeyboardInput } from './processor';

// =============================================================================
// Types
// =============================================================================

export type {
  ClassifiedInput,
  DigitKeyCode,
  EditingKeyCode,
  FunctionKeyCode,
  ImeKeyCode,
  KeyboardEventCode,
  KeyboardInput,
  KeyboardInputType,
  LetterKeyCode,
  ModifierKeyCode,
  ModifierState,
  NavigationKeyCode,
  NumpadKeyCode,
  PhysicalKeyCode,
  Platform,
  PunctuationKeyCode,
  SpecialKeyCode,
} from './primitives/index';

// =============================================================================
// Runtime utilities
// =============================================================================

export { isModifierKey } from './primitives/index';

// Physical key utilities
export {
  createModifierState,
  emptyModifierState,
  getActiveModifiers,
  isModifierKeyCode,
  isPhysicalKeyCode,
  isRegisterTransitionKey,
  modifierStatesEqual,
} from './primitives/index';

// Re-export physical-key types from primitives
export type { RegisterTransitionKeyCode } from './primitives/index';

// Input utilities
export {
  classifyInput,
  hasCommandModifier,
  hasExactModifiers,
  hasNoModifiers,
  hasPlatformCommandModifier,
} from './primitives/index';

// Shortcut types & runtime
export { PRIORITY_ORDER, getPriorityValue } from './primitives/index';

// Binding utilities
export {
  altBinding,
  binding,
  bindingMatches,
  bindingsEqual,
  crossPlatformBinding,
  extractCharacterFromCode,
  inferMatchBy,
  macSpecificBinding,
  parseBinding,
  platformBindings,
  resolveBinding,
  serializeBinding,
  serializeBindingByKey,
  universalBinding,
} from './primitives/index';

// =============================================================================
// Shortcuts Matcher
// =============================================================================

export { SPREADSHEET_SHORTCUT_CONTEXT_HIERARCHY, ShortcutMatcher } from './shortcuts/index';
export type {
  ChordMatchResult,
  PendingShortcut,
  ShortcutContextHierarchy,
  ShortcutMatchDetailedResult,
  ShortcutMatcherOptions,
} from './shortcuts/index';

// Re-export shortcut-related types from primitives
export type {
  BrowserConflict,
  BrowserConflictPolicy,
  ChordFollowOn,
  KeyboardShortcut,
  KeyboardShortcutBase,
  ModifierKey,
  MuscleMemoryLevel,
  PhysicalKeyBinding,
  PlatformKeyBindings,
  ShortcutCategory,
  ShortcutCategoryBase,
  ShortcutContext,
  ShortcutContextBase,
  ShortcutHandler,
  ShortcutMatchResult,
  ShortcutPriority,
  ShortcutRegistry,
} from './primitives/index';
