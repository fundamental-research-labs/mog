/**
 * Keyboard Shortcuts Module
 *
 * Exports the ShortcutMatcher and related types for keyboard shortcut handling.
 *
 * @module kernel/keyboard/shortcuts
 */

export { SPREADSHEET_SHORTCUT_CONTEXT_HIERARCHY, ShortcutMatcher } from './matcher';
export type {
  ChordMatchResult,
  PendingShortcut,
  ShortcutContextHierarchy,
  ShortcutMatchDetailedResult,
  ShortcutMatcherOptions,
} from './matcher';

// Re-export shortcut infrastructure types (via matcher re-exports)
export type {
  BrowserConflict,
  ChordFollowOn,
  KeyboardInput,
  KeyboardShortcut,
  KeyboardShortcutBase,
  ModifierKey,
  ModifierState,
  MuscleMemoryLevel,
  PhysicalKeyBinding,
  PhysicalKeyCode,
  Platform,
  PlatformKeyBindings,
  ShortcutCategory,
  ShortcutCategoryBase,
  ShortcutContext,
  ShortcutContextBase,
  ShortcutPriority,
} from './matcher';
