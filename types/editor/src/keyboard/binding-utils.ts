/**
 * Binding Utilities for the Unified Keyboard System
 *
 * Pure helper functions for creating physical key bindings.
 * These utilities ensure consistent binding creation across all shortcut definitions.
 *
 * NOTE: Additional runtime utilities (resolveBinding, parseBinding, serializeBinding, etc.)
 * live in @mog-sdk/kernel/keyboard.
 */

import type { ModifierKey, PhysicalKeyCode } from './physical-keys';
import type { PhysicalKeyBinding, PlatformKeyBindings } from './shortcuts/types';

// =============================================================================
// Binding Creation
// =============================================================================

/**
 * Create a physical key binding from a key code and modifiers.
 *
 * @param code - The physical key code
 * @param modifiers - Zero or more modifier keys
 * @returns A PhysicalKeyBinding
 *
 * @example
 * binding('KeyC', 'ctrl')           // Ctrl+C
 * binding('Equal', 'ctrl', 'shift') // Ctrl+Shift+= (produces '+')
 * binding('F2')                     // F2 alone
 */
export function binding(code: PhysicalKeyCode, ...modifiers: ModifierKey[]): PhysicalKeyBinding {
  // Deduplicate and sort modifiers for consistent comparison
  const uniqueModifiers = [...new Set(modifiers)].sort() as ModifierKey[];
  return {
    code,
    modifiers: Object.freeze(uniqueModifiers) as readonly ModifierKey[],
  };
}

/**
 * Create cross-platform bindings with automatic Ctrl -> Cmd translation for Mac.
 *
 * This is the most common pattern: Windows/Linux uses Ctrl, Mac uses Cmd.
 * This function automatically creates both bindings.
 *
 * @param code - The physical key code
 * @param modifiers - Zero or more modifier keys (use 'ctrl' for the command modifier)
 * @returns PlatformKeyBindings with macOS Cmd automatically mapped
 *
 * @example
 * crossPlatformBinding('KeyC', 'ctrl')
 * // Returns: { default: Ctrl+C, macos: Cmd+C }
 *
 * crossPlatformBinding('Equal', 'ctrl', 'shift')
 * // Returns: { default: Ctrl+Shift+=, macos: Cmd+Shift+= }
 */
export function crossPlatformBinding(
  code: PhysicalKeyCode,
  ...modifiers: ModifierKey[]
): PlatformKeyBindings {
  const defaultBinding = binding(code, ...modifiers);

  // Check if we need to create a Mac-specific binding
  // (only if there's a ctrl modifier to convert)
  if (modifiers.includes('ctrl')) {
    const macModifiers = modifiers.map((m) => (m === 'ctrl' ? 'meta' : m)) as ModifierKey[];
    return {
      default: defaultBinding,
      macos: binding(code, ...macModifiers),
    };
  }

  // No ctrl modifier, same binding on all platforms
  return {
    default: defaultBinding,
  };
}

/**
 * Create bindings where Mac uses a completely different key.
 *
 * Use this when Mac requires a different physical key, not just a modifier swap.
 *
 * @param defaultCode - The key code for Windows/Linux
 * @param defaultModifiers - The modifiers for Windows/Linux
 * @param macCode - The key code for Mac
 * @param macModifiers - The modifiers for Mac
 * @returns PlatformKeyBindings with explicit macOS override
 *
 * @example
 * // Windows: Ctrl+Home, Mac: Cmd+Fn+Left
 * macSpecificBinding(
 *   'Home', ['ctrl'],     // Windows binding
 *   'ArrowLeft', ['meta', 'fn']  // Mac binding
 * )
 */
export function macSpecificBinding(
  defaultCode: PhysicalKeyCode,
  defaultModifiers: ModifierKey[],
  macCode: PhysicalKeyCode,
  macModifiers: ModifierKey[],
): PlatformKeyBindings {
  return {
    default: binding(defaultCode, ...defaultModifiers),
    macos: binding(macCode, ...macModifiers),
  };
}

/**
 * Create a simple binding that is the same on all platforms.
 *
 * Use this for keys that don't need any platform-specific handling,
 * like F-keys, arrow keys, or shortcuts without Ctrl/Cmd.
 *
 * @param code - The physical key code
 * @param modifiers - Zero or more modifier keys
 * @returns PlatformKeyBindings
 *
 * @example
 * universalBinding('F2')                // F2 on all platforms
 * universalBinding('ArrowUp', 'shift')  // Shift+Up on all platforms
 */
export function universalBinding(
  code: PhysicalKeyCode,
  ...modifiers: ModifierKey[]
): PlatformKeyBindings {
  return {
    default: binding(code, ...modifiers),
  };
}

/**
 * Create bindings for an Alt-based shortcut.
 *
 * Alt shortcuts are the same on Windows/Linux and Mac (Option key).
 *
 * @param code - The physical key code
 * @param additionalModifiers - Additional modifiers beyond Alt
 * @returns PlatformKeyBindings
 *
 * @example
 * altBinding('Equal')  // Alt+= on all platforms
 */
export function altBinding(
  code: PhysicalKeyCode,
  ...additionalModifiers: ModifierKey[]
): PlatformKeyBindings {
  return {
    default: binding(code, 'alt', ...additionalModifiers),
  };
}

// =============================================================================
// Classification Utilities
// =============================================================================

/**
 * Determine the appropriate matchBy strategy for a given key code + modifiers.
 *
 * Classification rule:
 * - Letter keys (KeyA-KeyZ) with command modifier (Ctrl/Cmd/Alt) -> 'key' (mnemonic)
 * - Everything else -> 'code' (positional)
 *
 * @param code - The physical key code
 * @param modifiers - The modifier keys
 * @returns 'key' for mnemonic letter shortcuts, 'code' for positional
 */
export function inferMatchBy(
  code: PhysicalKeyCode,
  modifiers: readonly ModifierKey[],
): 'key' | 'code' {
  // Check if it's a letter key
  const isLetterKey = /^Key[A-Z]$/.test(code);
  if (!isLetterKey) return 'code';

  // Check if it has a command modifier (ctrl, meta, or alt)
  const hasCommandModifier =
    modifiers.includes('ctrl') || modifiers.includes('meta') || modifiers.includes('alt');

  return hasCommandModifier ? 'key' : 'code';
}

/**
 * Extract the expected character from a physical key code.
 *
 * For letter keys (KeyA-KeyZ), returns the lowercase letter.
 * For non-letter keys, returns undefined.
 *
 * @param code - The physical key code
 * @returns The lowercase character, or undefined for non-letter keys
 */
export function extractCharacterFromCode(code: PhysicalKeyCode): string | undefined {
  const match = /^Key([A-Z])$/.exec(code);
  return match ? match[1].toLowerCase() : undefined;
}
