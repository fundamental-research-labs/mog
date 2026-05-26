/**
 * @file Keyboard Display Utilities
 *
 * Functions for formatting keyboard bindings for human-readable display.
 * Handles platform-specific formatting (Mac symbols vs Windows text).
 */

import {
  resolveBinding,
  type ModifierKey,
  type PhysicalKeyBinding,
  type PhysicalKeyCode,
  type Platform,
  type PlatformKeyBindings,
} from '@mog-sdk/kernel/keyboard';
import { resolveKeyLabel } from '@mog/platform/keyboard/layout';
import type { KeyboardShortcut } from './types';

// =============================================================================
// Mac Modifier Symbols
// =============================================================================

/**
 * Mac modifier key symbols in standard order.
 *
 * The order follows Apple's convention: Control, Option, Shift, Command
 */
const MAC_MODIFIER_SYMBOLS: Record<ModifierKey, string> = {
  ctrl: '\u2303', // ⌃ Control
  alt: '\u2325', // ⌥ Option
  shift: '\u21E7', // ⇧ Shift
  meta: '\u2318', // ⌘ Command
} as const;

/**
 * Mac modifier display order (Apple convention).
 */
const MAC_MODIFIER_ORDER: readonly ModifierKey[] = ['ctrl', 'alt', 'shift', 'meta'] as const;

// =============================================================================
// Windows/Linux Modifier Names
// =============================================================================

/**
 * Windows/Linux modifier key names.
 */
const WINDOWS_MODIFIER_NAMES: Record<ModifierKey, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Win',
} as const;

/**
 * Linux modifier key names.
 */
const LINUX_MODIFIER_NAMES: Record<ModifierKey, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Super',
} as const;

/**
 * Windows/Linux modifier display order.
 */
const WINDOWS_MODIFIER_ORDER: readonly ModifierKey[] = ['ctrl', 'shift', 'alt', 'meta'] as const;

// =============================================================================
// Key Display Names
// =============================================================================

/**
 * Human-readable names for physical key codes.
 *
 * Keys not in this map use their code with "Key" prefix stripped.
 */
const KEY_DISPLAY_NAMES: Partial<Record<PhysicalKeyCode, string>> = {
  // Navigation
  ArrowUp: '\u2191', // ↑
  ArrowDown: '\u2193', // ↓
  ArrowLeft: '\u2190', // ←
  ArrowRight: '\u2192', // →
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',

  // Editing
  Backspace: '\u232B', // ⌫
  Delete: '\u2326', // ⌦
  Insert: 'Insert',
  Enter: '\u23CE', // ⏎
  Tab: '\u21E5', // ⇥
  Escape: '\u238B', // ⎋
  Space: 'Space',

  // Punctuation
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',

  // Numpad
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
  NumpadEqual: 'Num =',

  // Special
  ContextMenu: 'Menu',
  NumLock: 'Num Lock',
  ScrollLock: 'Scroll Lock',
  Pause: 'Pause',
  PrintScreen: 'Print Screen',
  CapsLock: 'Caps Lock',
} as const;

/**
 * Mac-specific key display names (some keys have different names/symbols).
 */
const MAC_KEY_DISPLAY_NAMES: Partial<Record<PhysicalKeyCode, string>> = {
  ...KEY_DISPLAY_NAMES,
  Backspace: '\u232B', // ⌫ (Delete on Mac keyboards)
  Delete: '\u2326', // ⌦ (Fn+Delete on Mac)
  Enter: '\u21A9', // ↩ (Return on Mac)
  Escape: '\u238B', // ⎋
} as const;

/**
 * Windows-specific key display names (use text instead of symbols).
 */
const WINDOWS_KEY_DISPLAY_NAMES: Partial<Record<PhysicalKeyCode, string>> = {
  // Navigation
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',

  // Editing
  Backspace: 'Backspace',
  Delete: 'Del',
  Insert: 'Ins',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Esc',
  Space: 'Space',

  // Punctuation (same as default)
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',

  // Numpad
  NumpadAdd: 'Num+',
  NumpadSubtract: 'Num-',
  NumpadMultiply: 'Num*',
  NumpadDivide: 'Num/',
  NumpadDecimal: 'Num.',
  NumpadEnter: 'NumEnter',
  NumpadEqual: 'Num=',

  // Special
  ContextMenu: 'Menu',
  NumLock: 'NumLock',
  ScrollLock: 'ScrLk',
  Pause: 'Pause',
  PrintScreen: 'PrtSc',
  CapsLock: 'CapsLock',
} as const;

// =============================================================================
// Display String Generation
// =============================================================================

/**
 * Get the display name for a physical key code.
 *
 * @param code - The physical key code
 * @param platform - The platform for display formatting
 * @returns Human-readable key name
 * @internal
 */
function getKeyDisplayName(
  code: PhysicalKeyCode,
  platform: Platform,
  layoutMap?: ReadonlyMap<string, string> | null,
): string {
  // Check platform-specific names first
  if (platform === 'macos' && code in MAC_KEY_DISPLAY_NAMES) {
    return MAC_KEY_DISPLAY_NAMES[code]!;
  }
  if ((platform === 'windows' || platform === 'linux') && code in WINDOWS_KEY_DISPLAY_NAMES) {
    return WINDOWS_KEY_DISPLAY_NAMES[code]!;
  }

  // Use default display name if available
  if (code in KEY_DISPLAY_NAMES) {
    return KEY_DISPLAY_NAMES[code]!;
  }

  // For letter/digit keys: use layout-aware label resolution
  if (code.startsWith('Key') || code.startsWith('Digit')) {
    return resolveKeyLabel(code, layoutMap ?? null);
  }

  if (code.startsWith('Numpad')) {
    const suffix = code.slice(6);
    // Numpad0-9 -> Num0-9
    if (/^\d$/.test(suffix)) {
      return `Num${suffix}`;
    }
    return suffix;
  }

  // Function keys and others use code as-is
  return code;
}

/**
 * Convert a binding to Mac-style display string with symbols.
 *
 * Uses Unicode symbols for modifiers and special keys.
 * Format: ⌃⌥⇧⌘A (no separators, symbols concatenated)
 *
 * @param binding - The key binding to format
 * @returns Mac-style display string
 *
 * @example
 * ```ts
 * toMacDisplayString({ code: 'KeyC', modifiers: ['meta'] });
 * // "⌘C"
 *
 * toMacDisplayString({ code: 'KeyZ', modifiers: ['meta', 'shift'] });
 * // "⇧⌘Z"
 * ```
 */
export function toMacDisplayString(
  binding: PhysicalKeyBinding,
  layoutMap?: ReadonlyMap<string, string> | null,
): string {
  // Build modifier string in Mac order
  const modifierStr = MAC_MODIFIER_ORDER.filter((mod) => binding.modifiers.includes(mod))
    .map((mod) => MAC_MODIFIER_SYMBOLS[mod])
    .join('');

  const keyStr = getKeyDisplayName(binding.code, 'macos', layoutMap);

  return modifierStr + keyStr;
}

/**
 * Convert a binding to Windows-style display string.
 *
 * Uses text names for modifiers separated by plus signs.
 * Format: Ctrl+Shift+A
 *
 * @param binding - The key binding to format
 * @returns Windows-style display string
 *
 * @example
 * ```ts
 * toWindowsDisplayString({ code: 'KeyC', modifiers: ['ctrl'] });
 * // "Ctrl+C"
 *
 * toWindowsDisplayString({ code: 'KeyZ', modifiers: ['ctrl', 'shift'] });
 * // "Ctrl+Shift+Z"
 * ```
 */
export function toWindowsDisplayString(
  binding: PhysicalKeyBinding,
  layoutMap?: ReadonlyMap<string, string> | null,
): string {
  const parts: string[] = [];

  // Add modifiers in Windows order
  for (const mod of WINDOWS_MODIFIER_ORDER) {
    if (binding.modifiers.includes(mod)) {
      parts.push(WINDOWS_MODIFIER_NAMES[mod]);
    }
  }

  // Add key
  parts.push(getKeyDisplayName(binding.code, 'windows', layoutMap));

  return parts.join('+');
}

/**
 * Convert a binding to Linux-style display string.
 *
 * Similar to Windows but with Linux-specific names (Super instead of Win).
 * Format: Ctrl+Shift+A
 *
 * @param binding - The key binding to format
 * @returns Linux-style display string
 */
export function toLinuxDisplayString(
  binding: PhysicalKeyBinding,
  layoutMap?: ReadonlyMap<string, string> | null,
): string {
  const parts: string[] = [];

  // Add modifiers in standard order
  for (const mod of WINDOWS_MODIFIER_ORDER) {
    if (binding.modifiers.includes(mod)) {
      parts.push(LINUX_MODIFIER_NAMES[mod]);
    }
  }

  // Add key
  parts.push(getKeyDisplayName(binding.code, 'linux', layoutMap));

  return parts.join('+');
}

/**
 * Convert a binding to a platform-appropriate display string.
 *
 * @param binding - The key binding to format
 * @param platform - The target platform
 * @returns Platform-appropriate display string
 *
 * @example
 * ```ts
 * const binding = { code: 'KeyS', modifiers: ['ctrl'] };
 *
 * toDisplayString(binding, 'macos'); // "⌘S" (if binding is Cmd on Mac)
 * toDisplayString(binding, 'windows'); // "Ctrl+S"
 * ```
 */
export function toDisplayString(
  binding: PhysicalKeyBinding,
  platform: Platform,
  layoutMap?: ReadonlyMap<string, string> | null,
): string {
  switch (platform) {
    case 'macos':
      return toMacDisplayString(binding, layoutMap);
    case 'windows':
      return toWindowsDisplayString(binding, layoutMap);
    case 'linux':
      return toLinuxDisplayString(binding, layoutMap);
  }
}

/**
 * Convert platform key bindings to a display string for the current platform.
 *
 * This resolves the appropriate binding for the platform and formats it.
 *
 * @param bindings - The platform key bindings
 * @param platform - The target platform
 * @returns Platform-appropriate display string
 *
 * @example
 * ```ts
 * const bindings = crossPlatformBinding('KeyS', 'ctrl');
 *
 * toDisplayStringForPlatform(bindings, 'macos'); // "⌘S"
 * toDisplayStringForPlatform(bindings, 'windows'); // "Ctrl+S"
 * ```
 */
export function toDisplayStringForPlatform(
  bindings: PlatformKeyBindings,
  platform: Platform,
  layoutMap?: ReadonlyMap<string, string> | null,
): string {
  const binding = resolveBinding(bindings, platform);
  return toDisplayString(binding, platform, layoutMap);
}

// =============================================================================
// Shortcut Help Display
// =============================================================================

/**
 * Format a shortcut for display in a help dialog or tooltip.
 *
 * Returns both Mac and Windows formats for cross-platform help.
 *
 * @param bindings - The platform key bindings
 * @returns Object with macos and windows display strings
 *
 * @example
 * ```ts
 * const bindings = crossPlatformBinding('KeyS', 'ctrl');
 * const help = getHelpDisplay(bindings);
 * // { macos: "⌘S", windows: "Ctrl+S", linux: "Ctrl+S" }
 * ```
 */
export function getHelpDisplay(
  bindings: PlatformKeyBindings,
  layoutMap?: ReadonlyMap<string, string> | null,
): {
  macos: string;
  windows: string;
  linux: string;
} {
  return {
    macos: toDisplayStringForPlatform(bindings, 'macos', layoutMap),
    windows: toDisplayStringForPlatform(bindings, 'windows', layoutMap),
    linux: toDisplayStringForPlatform(bindings, 'linux', layoutMap),
  };
}

/**
 * Format multiple shortcuts for display with separator.
 *
 * Useful when a shortcut has alternatives (e.g., "Ctrl+C or Ctrl+Ins").
 *
 * @param bindings - Array of platform key bindings
 * @param platform - The target platform
 * @param separator - Separator between shortcuts (default: " or ")
 * @returns Combined display string
 */
export function formatMultipleShortcuts(
  bindings: readonly PlatformKeyBindings[],
  platform: Platform,
  separator: string = ' or ',
  layoutMap?: ReadonlyMap<string, string> | null,
): string {
  return bindings.map((b) => toDisplayStringForPlatform(b, platform, layoutMap)).join(separator);
}

// =============================================================================
// Shortcut-Aware Display (uses matchBy + expectedCharacter)
// =============================================================================

/**
 * Convert a KeyboardShortcut to a platform-appropriate display string.
 *
 * For matchBy: 'key' shortcuts, uses the expectedCharacter for the key display
 * instead of the physical key code. This ensures "Ctrl+B" is shown instead of
 * "Ctrl+KeyB" for mnemonic shortcuts.
 *
 * For matchBy: 'code' shortcuts, uses the standard physical key display.
 *
 * @param shortcut - The keyboard shortcut
 * @param platform - The target platform
 * @returns Platform-appropriate display string
 *
 * @example
 * ```ts
 * // matchBy: 'key', expectedCharacter: 'b'
 * toShortcutDisplayString(boldShortcut, 'windows'); // "Ctrl+B"
 * toShortcutDisplayString(boldShortcut, 'macos'); // "⌘B"
 *
 * // matchBy: 'code' (arrow keys)
 * toShortcutDisplayString(moveUpShortcut, 'windows'); // "Up"
 * ```
 */
export function toShortcutDisplayString(
  shortcut: KeyboardShortcut,
  platform: Platform,
  layoutMap?: ReadonlyMap<string, string> | null,
): string {
  const binding = resolveBinding(shortcut.bindings, platform);

  // For character-based shortcuts, override the key display with the expected character.
  // The layout map intentionally does NOT override expectedCharacter — these are
  // mnemonic shortcuts (e.g., Ctrl+B for Bold) where the character is meaningful.
  if (shortcut.matchBy === 'key' && shortcut.expectedCharacter) {
    const char = shortcut.expectedCharacter.toUpperCase();

    if (platform === 'macos') {
      const modifierStr = MAC_MODIFIER_ORDER.filter((mod) => binding.modifiers.includes(mod))
        .map((mod) => MAC_MODIFIER_SYMBOLS[mod])
        .join('');
      return modifierStr + char;
    } else {
      const modNames = platform === 'linux' ? LINUX_MODIFIER_NAMES : WINDOWS_MODIFIER_NAMES;
      const parts: string[] = [];
      for (const mod of WINDOWS_MODIFIER_ORDER) {
        if (binding.modifiers.includes(mod)) {
          parts.push(modNames[mod]);
        }
      }
      parts.push(char);
      return parts.join('+');
    }
  }

  // Fall back to standard display for code-based shortcuts, with layout awareness
  return toDisplayString(binding, platform, layoutMap);
}
