/**
 * Unified Keyboard Shortcut System - Type Definitions
 *
 * This module contains ONLY type definitions for the keyboard system.
 * Runtime implementation has been moved to @mog-sdk/kernel/keyboard.
 *
 * For runtime code (binding utilities, shortcut definitions, display utils, etc.),
 * import from: @mog-sdk/kernel/keyboard
 */

// =============================================================================
// Physical Key Types
// =============================================================================

export type {
  DigitKeyCode,
  EditingKeyCode,
  FunctionKeyCode,
  ImeKeyCode,
  LetterKeyCode,
  ModifierKey,
  ModifierKeyCode,
  ModifierState,
  NavigationKeyCode,
  NumpadKeyCode,
  PhysicalKeyCode,
  Platform,
  PunctuationKeyCode,
  SpecialKeyCode,
} from './physical-keys';

// =============================================================================
// Input Types
// =============================================================================

export type { ClassifiedInput, KeyboardInput, KeyboardInputType } from './input';

// =============================================================================
// Shortcut Types
// =============================================================================

export type {
  BrowserConflict,
  BrowserConflictPolicy,
  ChordFollowOn,
  KeyboardShortcut,
  MuscleMemoryLevel,
  PhysicalKeyBinding,
  PlatformKeyBindings,
  ShortcutCategory,
  ShortcutContext,
  ShortcutHandler,
  ShortcutMatchResult,
  ShortcutPriority,
  ShortcutRegistry,
} from './shortcuts/types';

// =============================================================================
// Action Types
// =============================================================================

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

// =============================================================================
// Customization Types
// =============================================================================

export type {
  BuiltInProfileId,
  ConflictResult,
  CustomBinding,
  KeyboardProfile,
  SerializedProfile,
} from './customization';

// =============================================================================
// Excel Reference Types
// =============================================================================

export type { ExcelShortcutReference } from './excel-reference';
