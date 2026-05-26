/**
 * Core keyboard primitives.
 *
 * Physical key types, input classification, binding utilities, and shortcut types.
 * Types and runtime code for the public @mog-sdk/kernel/keyboard subpath.
 *
 * NOTE: App-specific code (shortcut definitions, actions, display utils,
 * customization, excel reference) has been moved to apps/spreadsheet/src/keyboard/.
 */

// =============================================================================
// Physical Key Types & Runtime
// =============================================================================

export type {
  DigitKeyCode,
  EditingKeyCode,
  FunctionKeyCode,
  ImeKeyCode,
  LetterKeyCode,
  KeyboardEventCode,
  ModifierKey,
  ModifierKeyCode,
  ModifierState,
  NavigationKeyCode,
  NumpadKeyCode,
  PhysicalKeyCode,
  Platform,
  PunctuationKeyCode,
  RegisterTransitionKeyCode,
  SpecialKeyCode,
} from './physical-keys';

export {
  createModifierState,
  emptyModifierState,
  getActiveModifiers,
  isModifierKey,
  isModifierKeyCode,
  isPhysicalKeyCode,
  isRegisterTransitionKey,
  modifierStatesEqual,
} from './physical-keys';

// =============================================================================
// Input Types & Runtime
// =============================================================================

export type { ClassifiedInput, KeyboardInput, KeyboardInputType } from './input';

export {
  classifyInput,
  createKeyboardInput,
  hasCommandModifier,
  hasExactModifiers,
  hasNoModifiers,
  hasPlatformCommandModifier,
} from './input';

// =============================================================================
// Shortcut Types & Runtime
// =============================================================================

export type {
  BrowserConflict,
  BrowserConflictPolicy,
  ChordFollowOn,
  KeyboardShortcut,
  KeyboardShortcutBase,
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
} from './shortcuts/types';

export { PRIORITY_ORDER, getPriorityValue } from './shortcuts/types';

// =============================================================================
// Binding Utilities
// =============================================================================

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
} from './binding-utils';
