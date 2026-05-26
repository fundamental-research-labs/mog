/**
 * Binding Utilities for the Unified Keyboard System
 *
 * Helper functions for creating physical key bindings.
 * These utilities ensure consistent binding creation across all shortcut definitions.
 *
 */

import type { ModifierKey, PhysicalKeyCode, Platform } from './physical-keys';
import type { PhysicalKeyBinding, PlatformKeyBindings } from './shortcuts/types';
import { isPhysicalKeyCode } from './physical-keys';

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
 * @returns PlatformKeyBindings with Mac Cmd automatically mapped
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
 * @returns PlatformKeyBindings with explicit Mac override
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

/**
 * Create a PlatformKeyBindings with explicit bindings for each platform.
 *
 * Use this when you need full control over platform-specific bindings.
 *
 * @param options - Object with platform-specific bindings
 * @returns PlatformKeyBindings with all specified overrides
 *
 * @example
 * platformBindings({
 *   default: binding('KeyA', 'ctrl'),
 *   macos: binding('KeyA', 'meta'),
 *   windows: binding('KeyA', 'ctrl', 'alt'),
 *   linux: binding('KeyA', 'ctrl')
 * });
 */
export function platformBindings(options: {
  default: PhysicalKeyBinding;
  macos?: PhysicalKeyBinding;
  windows?: PhysicalKeyBinding;
  linux?: PhysicalKeyBinding;
}): PlatformKeyBindings {
  return {
    default: options.default,
    ...(options.macos && { macos: options.macos }),
    ...(options.windows && { windows: options.windows }),
    ...(options.linux && { linux: options.linux }),
  };
}

// =============================================================================
// Binding Resolution
// =============================================================================

/**
 * Get the appropriate binding for a platform.
 *
 * @param bindings - The platform key bindings
 * @param platform - The target platform
 * @returns The binding for the specified platform
 *
 * @example
 * const bindings = crossPlatformBinding('KeyS', 'ctrl');
 * const macBinding = resolveBinding(bindings, 'macos');
 * // { code: 'KeyS', modifiers: ['meta'] }
 */
export function resolveBinding(
  bindings: PlatformKeyBindings,
  platform: Platform,
): PhysicalKeyBinding {
  // Check for platform-specific override first
  switch (platform) {
    case 'macos':
      if (bindings.macos) return bindings.macos;
      // Auto-convert Ctrl to Cmd for macOS if no explicit macos binding
      return convertCtrlToMeta(bindings.default);
    case 'windows':
      if (bindings.windows) return bindings.windows;
      return bindings.default;
    case 'linux':
      if (bindings.linux) return bindings.linux;
      return bindings.default;
  }
}

/**
 * Convert Ctrl modifier to Meta (Cmd) in a binding.
 *
 * @param b - The binding to convert
 * @returns A new binding with Ctrl replaced by Meta
 * @internal
 */
function convertCtrlToMeta(b: PhysicalKeyBinding): PhysicalKeyBinding {
  if (!b.modifiers.includes('ctrl')) {
    return b;
  }

  return {
    code: b.code,
    modifiers: Object.freeze(
      b.modifiers.map((m) => (m === 'ctrl' ? 'meta' : m)),
    ) as readonly ModifierKey[],
  };
}

// =============================================================================
// Character-Based Binding Serialization (for matchBy: 'key')
// =============================================================================

/**
 * Serialize a binding using character (event.key) instead of physical code.
 *
 * Used for indexing matchBy: 'key' shortcuts. The format is:
 * "modifier1+modifier2+...+key:character" with modifiers sorted.
 *
 * @param modifiers - Modifier keys required
 * @param character - The expected character (lowercase)
 * @returns A canonical string for character-based lookup
 *
 * @example
 * serializeBindingByKey(['ctrl'], 'b');       // "ctrl+key:b"
 * serializeBindingByKey(['ctrl', 'shift'], 'z'); // "ctrl+shift+key:z"
 */
export function serializeBindingByKey(
  modifiers: readonly ModifierKey[],
  character: string,
): string {
  const sortedMods = [...modifiers].sort();
  const charPart = `key:${character.toLowerCase()}`;
  if (sortedMods.length === 0) {
    return charPart;
  }
  return [...sortedMods, charPart].join('+');
}

/**
 * Determine the appropriate matchBy strategy for a given key code + modifiers.
 *
 * Classification rule:
 * - Letter keys (KeyA-KeyZ) with command modifier (Ctrl/Cmd/Alt) → 'key' (mnemonic)
 * - Everything else → 'code' (positional)
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

// =============================================================================
// Binding Comparison
// =============================================================================

/**
 * Check if two PhysicalKeyBindings are equal.
 *
 * @param a - First binding
 * @param b - Second binding
 * @returns True if bindings are equivalent
 */
export function bindingsEqual(a: PhysicalKeyBinding, b: PhysicalKeyBinding): boolean {
  if (a.code !== b.code) return false;
  if (a.modifiers.length !== b.modifiers.length) return false;

  // Sort modifiers for comparison (order doesn't matter)
  const aMods = [...a.modifiers].sort();
  const bMods = [...b.modifiers].sort();

  return aMods.every((mod, i) => mod === bMods[i]);
}

/**
 * Check if a binding matches the given modifiers and key code.
 *
 * This is useful for matching keyboard input against bindings.
 *
 * @param b - The binding to check
 * @param code - The physical key code from the input
 * @param modifiers - Object with modifier key states
 * @returns True if the binding matches
 *
 * @example
 * const save = binding('KeyS', 'ctrl');
 * const matches = bindingMatches(save, 'KeyS', {
 *   ctrl: true,
 *   shift: false,
 *   alt: false,
 *   meta: false
 * });
 * // true
 */
export function bindingMatches(
  b: PhysicalKeyBinding,
  code: PhysicalKeyCode,
  modifiers: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean },
): boolean {
  if (b.code !== code) return false;

  // Check that exactly the required modifiers are pressed
  const ctrlRequired = b.modifiers.includes('ctrl');
  const shiftRequired = b.modifiers.includes('shift');
  const altRequired = b.modifiers.includes('alt');
  const metaRequired = b.modifiers.includes('meta');

  return (
    modifiers.ctrl === ctrlRequired &&
    modifiers.shift === shiftRequired &&
    modifiers.alt === altRequired &&
    modifiers.meta === metaRequired
  );
}

// =============================================================================
// Binding Serialization
// =============================================================================

/**
 * Convert a PhysicalKeyBinding to a canonical string representation.
 *
 * This is useful for storing bindings or using them as map keys.
 * The format is: "modifier1+modifier2+...+keyCode" with modifiers sorted.
 *
 * @param b - The binding to serialize
 * @returns A canonical string representation
 *
 * @example
 * const b = binding('KeyS', 'ctrl', 'shift');
 * serializeBinding(b); // "ctrl+shift+KeyS"
 */
export function serializeBinding(b: PhysicalKeyBinding): string {
  const sortedMods = [...b.modifiers].sort();
  if (sortedMods.length === 0) {
    return b.code;
  }
  return [...sortedMods, b.code].join('+');
}

/**
 * Parse a serialized binding string back to a PhysicalKeyBinding.
 *
 * @param serialized - The serialized binding string
 * @returns The parsed binding, or null if invalid
 *
 * @example
 * const binding = parseBinding("ctrl+shift+KeyS");
 * // { code: 'KeyS', modifiers: ['ctrl', 'shift'] }
 */
export function parseBinding(serialized: string): PhysicalKeyBinding | null {
  const parts = serialized.split('+');
  if (parts.length === 0) return null;

  // Validate the key code
  const code = parts[parts.length - 1];
  if (!isPhysicalKeyCode(code)) return null;

  const modifiers = parts.slice(0, -1) as ModifierKey[];

  // Validate modifiers
  const validModifiers: ModifierKey[] = ['ctrl', 'shift', 'alt', 'meta'];
  for (const mod of modifiers) {
    if (!validModifiers.includes(mod)) {
      return null;
    }
  }

  return binding(code, ...modifiers);
}
