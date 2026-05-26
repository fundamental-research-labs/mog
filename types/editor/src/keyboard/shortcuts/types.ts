/**
 * @file Keyboard Shortcut Types
 *
 * Defines the complete keyboard shortcut type system including bindings,
 * contexts, categories, and full shortcut definitions.
 */

import type { ModifierKey, PhysicalKeyCode } from '../physical-keys';
import type { ActionType, KeyboardActionPayload } from '../../actions/action-types';
// Re-export so consumers that import PhysicalKeyBinding/KeyboardShortcut
// also have access to the types those interfaces reference.
export type { ModifierKey, PhysicalKeyCode };

// =============================================================================
// Physical Key Binding
// =============================================================================

/**
 * A physical key binding specifies which physical key and modifiers
 * trigger a shortcut.
 *
 * @example
 * ```ts
 * // Ctrl+C (Copy)
 * const copyBinding: PhysicalKeyBinding = {
 *   code: 'KeyC',
 *   modifiers: ['ctrl']
 * };
 *
 * // Ctrl+Shift+Z (Redo on Windows)
 * const redoBinding: PhysicalKeyBinding = {
 *   code: 'KeyZ',
 *   modifiers: ['ctrl', 'shift']
 * };
 * ```
 */
export interface PhysicalKeyBinding {
  /**
   * The physical key code that triggers this shortcut.
   */
  readonly code: PhysicalKeyCode;

  /**
   * The modifier keys required for this shortcut.
   *
   * Empty array means no modifiers (just the key itself).
   * Order doesn't matter - ['ctrl', 'shift'] equals ['shift', 'ctrl'].
   */
  readonly modifiers: readonly ModifierKey[];
}

// =============================================================================
// Platform Key Bindings
// =============================================================================

/**
 * Platform-specific key bindings for a shortcut.
 *
 * Most shortcuts use the same key across platforms (with Ctrl/Cmd swap),
 * but some need completely different keys on different platforms.
 *
 * @example
 * ```ts
 * // Simple case - same key, automatic Ctrl/Cmd swap
 * const save: PlatformKeyBindings = {
 *   default: { code: 'KeyS', modifiers: ['ctrl'] }
 *   // Mac automatically uses Cmd+S
 * };
 *
 * // Complex case - different keys per platform
 * const redo: PlatformKeyBindings = {
 *   default: { code: 'KeyY', modifiers: ['ctrl'] },       // Windows: Ctrl+Y
 *   macos: { code: 'KeyZ', modifiers: ['meta', 'shift'] } // Mac: Cmd+Shift+Z
 * };
 * ```
 */
export interface PlatformKeyBindings {
  /**
   * The default binding used when no platform-specific binding is defined.
   *
   * For non-Mac platforms, this is used as-is.
   * For macOS, if no macos binding is specified, Ctrl is automatically
   * converted to Meta (Cmd).
   */
  readonly default: PhysicalKeyBinding;

  /**
   * macOS-specific binding override.
   *
   * If not specified, the default binding is used with Ctrl->Cmd conversion.
   */
  readonly macos?: PhysicalKeyBinding;

  /**
   * Windows-specific binding override.
   *
   * If not specified, the default binding is used.
   */
  readonly windows?: PhysicalKeyBinding;

  /**
   * Linux-specific binding override.
   *
   * If not specified, the default binding is used.
   */
  readonly linux?: PhysicalKeyBinding;
}

// =============================================================================
// Shortcut Contexts
// =============================================================================

/**
 * Contexts in which shortcuts can be active.
 *
 * A shortcut may be available in multiple contexts. The active context
 * is determined by the current focus and application state.
 *
 * - 'global': Always available (e.g., Ctrl+S save)
 * - 'grid': Grid is focused but not in edit mode
 * - 'flashFillPreview': Grid is focused, no edit, AND a Flash Fill preview popup
 *   is showing. Specializes 'grid'; Enter/Tab/Escape route to flash-fill
 *   accept/reject. Other 'grid' shortcuts (arrows, Cmd+C, etc.) still match
 *   via hierarchy, so the popup is non-modal.
 * - 'editing': Generic editing mode (cell or formula bar)
 * - 'enterMode': Cell editor in Enter mode (navigating commits)
 * - 'editMode': Cell editor in Edit mode (arrow keys move cursor)
 * - 'formulaEnterMode': Formula bar in Enter mode
 * - 'formulaEditMode': Formula bar in Edit mode
 * - 'formulaEditing': Either formula mode (for formula-specific shortcuts)
 * - 'objectSelected': A floating object is selected
 * - 'dialog': A modal dialog is open
 * - 'menu': A menu or dropdown is open
 * - 'keyTipMode': An Alt-prefixed chord shortcut is in flight (KeyTip overlay visible, awaiting follow-on)
 * - 'view': Parent context for all view-specific contexts
 * - 'kanban': Kanban board view
 * - 'kanbanEditing': Editing within kanban view
 * - 'gallery': Gallery view
 * - 'calendar': Calendar view
 * - 'timeline': Timeline view
 * - 'any': Available in all contexts
 */
export type ShortcutContext =
  | 'global'
  | 'grid'
  | 'flashFillPreview'
  | 'editing'
  | 'enterMode'
  | 'editMode'
  | 'formulaEnterMode'
  | 'formulaEditMode'
  | 'formulaEditing'
  | 'objectSelected'
  | 'dialog'
  | 'menu'
  | 'drawing'
  | 'diagramNodeSelected'
  | 'keyTipMode'
  | 'view'
  | 'kanban'
  | 'kanbanEditing'
  | 'gallery'
  | 'calendar'
  | 'timeline'
  | 'any';

// =============================================================================
// Shortcut Categories
// =============================================================================

/**
 * Categories for organizing shortcuts in help dialogs and documentation.
 */
export type ShortcutCategory =
  | 'navigation'
  | 'selection'
  | 'editing'
  | 'formatting'
  | 'clipboard'
  | 'formula'
  | 'comments'
  | 'data'
  | 'view'
  | 'file'
  | 'workbook'
  | 'object'
  | 'accessibility';

// =============================================================================
// Shortcut Priority
// =============================================================================

/**
 * Priority level for shortcuts when conflicts occur.
 *
 * Higher priority shortcuts are matched first when multiple shortcuts
 * could match the same key combination.
 *
 * - 'critical': System-level shortcuts that must always work (Escape, etc.)
 * - 'high': Important user actions (Save, Undo, Cut/Copy/Paste)
 * - 'medium': Common operations (formatting, navigation)
 * - 'low': Less common or context-specific operations
 */
export type ShortcutPriority = 'critical' | 'high' | 'medium' | 'low';

// =============================================================================
// Muscle Memory Level
// =============================================================================

/**
 * Muscle memory importance for shortcuts.
 *
 * This helps prioritize which shortcuts should match Excel exactly
 * for users migrating from Excel.
 *
 * - 'essential': Must match Excel exactly (Ctrl+C, Ctrl+V, Ctrl+Z)
 * - 'common': Frequently used, should match Excel (Ctrl+B, Ctrl+I, F2)
 * - 'occasional': Used regularly but not constantly (Ctrl+;, Ctrl+Shift+;)
 * - 'rare': Power user shortcuts (F4 for absolute refs, Ctrl+`)
 */
export type MuscleMemoryLevel = 'essential' | 'common' | 'occasional' | 'rare';

// =============================================================================
// Browser Conflict
// =============================================================================

/**
 * Conflict policy when a shortcut conflicts with browser default behavior.
 *
 * - 'override': Always prevent browser default (use for essential shortcuts)
 * - 'defer': Let browser handle it (use when browser behavior is desired)
 * - 'none': No browser conflict (most shortcuts)
 */
export type BrowserConflictPolicy = 'override' | 'defer' | 'none';

/**
 * Browser conflict information for a shortcut.
 */
export interface BrowserConflict {
  /**
   * Description of what the browser does with this shortcut.
   *
   * @example "Opens browser devtools"
   * @example "Refreshes the page"
   */
  readonly conflictsWith?: string;

  /**
   * How to handle the conflict.
   */
  readonly policy: BrowserConflictPolicy;

  /**
   * Alternative way for users to perform the browser action.
   *
   * @example "F5 or browser menu still works for refresh"
   * @example "Use browser menu"
   */
  readonly workaround?: string;
}

// =============================================================================
// Chord Follow-On (Excel Alt+H,L style sequences)
// =============================================================================

/**
 * Follow-on entry for an Excel-style chord shortcut.
 *
 * Each entry is either a bare {@link PhysicalKeyCode} (no modifiers permitted
 * on the follow-on) or `{ code, shift: true }` for Shift-modified follow-ons
 * (Excel's `Alt+H,$` = `Alt+H,Shift+Digit4`).
 *
 * On a follow-on, **Shift is the only permitted modifier**; Ctrl, Alt, or
 * Meta cancels the chord and the input falls through to plain matching.
 */
export type ChordFollowOn =
  | PhysicalKeyCode
  | { readonly code: PhysicalKeyCode; readonly shift: true };

// =============================================================================
// Keyboard Shortcut Definition
// =============================================================================

/**
 * Complete keyboard shortcut definition.
 *
 * This contains all information needed to:
 * - Match keyboard input to the shortcut
 * - Display the shortcut in UI/help
 * - Handle platform differences
 * - Manage conflicts with browser shortcuts
 * - Allow user customization
 *
 * @example
 * ```ts
 * const saveShortcut: KeyboardShortcut = {
 *   id: 'file.save',
 *   bindings: {
 *     default: { code: 'KeyS', modifiers: ['ctrl'] }
 *   },
 *   description: 'Save the current workbook',
 *   action: 'save',
 *   enabled: true,
 *   priority: 'high',
 *   category: 'file',
 *   contexts: ['global'],
 *   muscleMemory: 'essential',
 *   browserConflict: {
 *     conflictsWith: 'Browser save page dialog',
 *     policy: 'override'
 *   },
 *   allowRepeat: false
 * };
 * ```
 */
export interface KeyboardShortcutBase {
  /**
   * Unique identifier for this shortcut.
   *
   * Use dot-notation for namespacing: 'category.action'
   *
   * @example 'file.save'
   * @example 'edit.undo'
   * @example 'format.bold'
   */
  readonly id: string;

  /**
   * Key bindings for this shortcut, with optional platform overrides.
   */
  readonly bindings: PlatformKeyBindings;

  /**
   * Human-readable description of what this shortcut does.
   *
   * Used in help dialogs and tooltips.
   */
  readonly description: string;

  /**
   * Whether this shortcut is currently enabled.
   *
   * Disabled shortcuts are not matched against input.
   * Use this for feature flags or conditional availability.
   */
  readonly enabled: boolean;

  /**
   * Priority for conflict resolution.
   *
   * Higher priority shortcuts are matched first when multiple
   * shortcuts could match the same key combination.
   */
  readonly priority: ShortcutPriority;

  /**
   * Category for organization in help/settings UI.
   */
  readonly category: ShortcutCategory;

  /**
   * Contexts where this shortcut is active.
   *
   * The shortcut only triggers if the current context matches
   * one of the listed contexts (or 'any').
   */
  readonly contexts: readonly ShortcutContext[];

  /**
   * Muscle memory level for Excel compatibility prioritization.
   */
  readonly muscleMemory: MuscleMemoryLevel;

  /**
   * Browser conflict information.
   *
   * If undefined, there is no browser conflict.
   */
  readonly browserConflict?: BrowserConflict;

  /**
   * How to match this shortcut against keyboard input.
   *
   * - 'key': Match against event.key (character output). Use for mnemonic
   *   letter shortcuts (Ctrl+B for Bold). Works across all keyboard layouts.
   * - 'code': Match against event.code (physical position). Use for positional
   *   shortcuts (arrows, F-keys, digits, numpad, punctuation).
   *
   * DEFAULT: 'code' (backward compatible with current behavior)
   */
  readonly matchBy: 'key' | 'code';

  /**
   * The character to match against event.key (lowercase).
   * Required when matchBy is 'key'. Ignored when matchBy is 'code'.
   *
   * @example 'b' for Bold (Ctrl+B)
   * @example 'c' for Copy (Ctrl+C)
   */
  readonly expectedCharacter?: string;

  /**
   * Whether this shortcut should trigger repeatedly when held.
   *
   * - true: Triggers repeatedly (e.g., arrow navigation)
   * - false: Only triggers once per keypress (e.g., Ctrl+S save)
   *
   * Default is false if not specified.
   */
  readonly allowRepeat?: boolean;

  /**
   * When true, this shortcut is registered as an OS-level global hotkey
   * (via Tauri's global-shortcut plugin) in addition to the normal in-app
   * shortcut. Global shortcuts fire even when the app is not focused.
   *
   * Desktop only — ignored on web. If registration fails (e.g., another
   * app owns the key combination), the in-app shortcut still works.
   *
   * @example Use cases: quick capture, show/hide app
   */
  readonly global?: boolean;

  /**
   * Additional notes about this shortcut.
   *
   * Documentation-only, not used at runtime.
   */
  readonly notes?: string;

  /**
   * Follow-on entries for chord shortcuts (Excel `Alt+H,L` style).
   *
   * Each entry is either a bare {@link PhysicalKeyCode} or
   * `{ code, shift: true }` for Shift-modified follow-ons.
   * Ctrl/Alt/Meta on a follow-on cancels the chord. Order matters;
   * matching is left-to-right over the chord buffer.
   *
   * - `undefined` (default): single-keystroke shortcut, matched
   *   exactly like every existing entry.
   * - `[]`: explicitly empty chord; equivalent to `undefined`.
   *   Don't write this — leave the field absent.
   * - `['KeyL']`: two-key chord. The leading keystroke
   *   (`bindings`) fires nothing; the matcher buffers the prefix
   *   and waits for `KeyL` (no modifiers) to complete the chord
   *   and fire `action`.
   * - `['KeyA', 'KeyL']`: three-key chord (`Alt+H, A, L`).
   * - `[{ code: 'Digit4', shift: true }]`: Shift-modified
   *   follow-on (`Alt+H, Shift+4` = `Alt+H,$`).
   *
   * **Invariant.** `sequence` is only meaningful when
   * `bindings.default.modifiers` includes `'alt'` and `contexts`
   * contains `'keyTipMode'` or `'grid'` (the leading keystroke is
   * always Alt+letter). On follow-ons, `shift` is the only
   * modifier permitted; Ctrl/Alt/Meta on a follow-on cancels the
   * chord and the input falls through to plain matching.
   */
  readonly sequence?: readonly ChordFollowOn[];
}

/**
 * Complete keyboard shortcut definition with action-specific payload typing.
 *
 * The default `KeyboardShortcut` is a discriminated union over every
 * `ActionType`, so object literals typed as `KeyboardShortcut[]` still keep
 * `action` and `actionArg` paired. For example, `SET_HORIZONTAL_ALIGN` only
 * accepts `SetHorizontalAlignPayload`, while actions with no payload contract
 * cannot specify `actionArg`.
 */
export type KeyboardShortcut<A extends ActionType = ActionType> = A extends ActionType
  ? KeyboardShortcutBase & {
      /**
       * The action identifier to dispatch when this shortcut is triggered.
       *
       * This should match an action handler in the action system.
       */
      readonly action: A;

      /**
       * Typed argument forwarded as the dispatcher `payload` when this shortcut
       * fires. Only valid for actions that declare an entry in
       * {@link KeyboardActionPayload}; for other actions the field type narrows
       * to `never`.
       *
       * @example
       * ```ts
       * // Switching the ribbon tab from Alt+H is typed end-to-end:
       * { action: 'SWITCH_RIBBON_TAB', actionArg: { tabId: 'home' } }
       * ```
       */
      readonly actionArg?: A extends keyof KeyboardActionPayload ? KeyboardActionPayload[A] : never;
    }
  : never;

// =============================================================================
// Shortcut Match Result
// =============================================================================

/**
 * Result of matching keyboard input against shortcuts.
 */
export interface ShortcutMatchResult {
  /**
   * The matched shortcut, or null if no match.
   */
  readonly shortcut: KeyboardShortcut | null;

  /**
   * Whether the browser default should be prevented.
   *
   * This is true when:
   * - A shortcut matched and has browserConflict.policy === 'override'
   * - A shortcut matched and has no browser conflict
   *
   * It's false when:
   * - No shortcut matched
   * - The matched shortcut has browserConflict.policy === 'defer'
   */
  readonly preventDefault: boolean;
}

// =============================================================================
// Shortcut Handler
// =============================================================================

/**
 * Handler function for a keyboard shortcut.
 *
 * @param shortcut - The matched shortcut
 * @returns true if the shortcut was handled, false to allow fallthrough
 */
export type ShortcutHandler = (shortcut: KeyboardShortcut) => boolean;

// =============================================================================
// Shortcut Registry
// =============================================================================

/**
 * A collection of keyboard shortcuts indexed by ID.
 */
export type ShortcutRegistry = ReadonlyMap<string, KeyboardShortcut>;
