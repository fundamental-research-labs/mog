/**
 * @file Keyboard Input Types
 *
 * Defines the normalized keyboard input types that all handlers receive.
 * This provides a consistent interface regardless of the original browser event.
 */

import type { KeyboardEventCode, ModifierState, Platform } from './physical-keys';

export type KeyboardInputType =
  | 'shortcut'
  | 'navigation'
  | 'action'
  | 'character'
  | 'composition'
  | 'modifier-only'
  | 'unknown';

export interface KeyboardInput {
  readonly physicalKey: KeyboardEventCode;
  readonly character: string;
  readonly modifiers: ModifierState;
  readonly isComposing: boolean;
  readonly isRepeat: boolean;
  readonly platform: Platform;
  readonly timestamp: number;
  readonly originalEvent: KeyboardEvent;
}

export interface ClassifiedInput {
  readonly input: KeyboardInput;
  readonly type: KeyboardInputType;
  readonly isPrintable?: boolean;
}

// =============================================================================
// Keyboard Input Type Classification
// =============================================================================

/**
 * Classification of keyboard input types.
 *
 * This determines how the input is routed through the keyboard system:
 * - 'shortcut': Key combination with modifiers (Ctrl+C, Cmd+S)
 * - 'navigation': Arrow keys, Tab, Page Up/Down (may have Shift for selection)
 * - 'action': Enter, Escape, Delete, Backspace (context-sensitive actions)
 * - 'character': Printable character input (letters, numbers, symbols)
 * - 'composition': IME composition events (Japanese, Korean, Chinese input)
 * - 'modifier-only': Pressing just a modifier key (Shift, Ctrl, Alt, Meta)
 * - 'unknown': Unrecognized or system-reserved keys
 */
// =============================================================================
// Input Creation Utilities
// =============================================================================

/**
 * Create a KeyboardInput from a KeyboardEvent.
 *
 * This normalizes the browser event into our canonical representation.
 *
 * @param event - The browser KeyboardEvent
 * @param platform - The current platform
 * @returns A normalized KeyboardInput, or null if the key code is not recognized
 *
 * @example
 * ```ts
 * document.addEventListener('keydown', (event) => {
 *   const input = createKeyboardInput(event, detectPlatform());
 *   if (input) {
 *     handleKeyboardInput(input);
 *   }
 * });
 * ```
 */
export function createKeyboardInput(
  event: KeyboardEvent,
  platform: Platform,
): KeyboardInput | null {
  // We accept any string code and let handlers deal with unknown codes
  // This allows us to pass through events even for unusual keys
  const physicalKey = event.code;

  return {
    physicalKey,
    character: event.key,
    modifiers: {
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
    },
    isComposing: event.isComposing,
    isRepeat: event.repeat,
    platform,
    timestamp: event.timeStamp,
    originalEvent: event,
  };
}

// =============================================================================
// Input Classification
// =============================================================================

/**
 * Set of navigation key codes.
 * @internal
 */
const NAVIGATION_KEYS = new Set<string>([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Tab',
]);

/**
 * Set of action key codes.
 * @internal
 */
const ACTION_KEYS = new Set<string>([
  'Enter',
  'NumpadEnter',
  'Escape',
  'Delete',
  'Backspace',
  'Insert',
  'Space',
]);

/**
 * Set of modifier key codes.
 * @internal
 */
const MODIFIER_KEYS = new Set<string>([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'NumLock',
  'ScrollLock',
]);

/**
 * Set of function key codes.
 * @internal
 */
const FUNCTION_KEYS = new Set<string>([
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
]);

/**
 * Classify a keyboard input.
 *
 * This determines how the input should be routed:
 * - Shortcuts (with Ctrl/Meta modifiers) go to the shortcut system
 * - Navigation keys may go to selection/navigation handlers
 * - Character input goes to the editor
 * - etc.
 *
 * @param input - The keyboard input to classify
 * @returns The classified input with type and isPrintable flag
 *
 * @example
 * ```ts
 * const classified = classifyInput(input);
 * switch (classified.type) {
 *   case 'shortcut':
 *     return handleShortcut(classified.input);
 *   case 'navigation':
 *     return handleNavigation(classified.input);
 *   case 'character':
 *     return handleCharacter(classified.input);
 *   // ...
 * }
 * ```
 */
export function classifyInput(input: KeyboardInput): ClassifiedInput {
  const { physicalKey, modifiers, isComposing, character } = input;

  // IME composition always takes precedence
  if (isComposing) {
    return { input, type: 'composition', isPrintable: false };
  }

  // Modifier-only keypresses
  if (MODIFIER_KEYS.has(physicalKey)) {
    return { input, type: 'modifier-only', isPrintable: false };
  }

  // Check for shortcut pattern (Ctrl or Meta modifier with a non-navigation key)
  // Note: Shift alone doesn't make it a shortcut (Shift+A = 'A')
  // Note: Alt+key can be either shortcut (Alt+F4) or character input (Alt+e = e on some layouts)
  const hasCommandModifier = modifiers.ctrl || modifiers.meta;

  if (hasCommandModifier) {
    // Ctrl/Cmd + something is a shortcut
    return { input, type: 'shortcut', isPrintable: false };
  }

  // Alt key combinations
  if (modifiers.alt) {
    // On Windows/Linux, Alt+F opens menus, Alt+F4 closes windows
    // On Mac, Option+key often produces special characters
    if (input.platform === 'macos') {
      // Mac Option key might produce special characters
      // Check if it's a letter/digit that might produce a special char
      if (physicalKey.startsWith('Key') || physicalKey.startsWith('Digit')) {
        return { input, type: 'character', isPrintable: true };
      }
    }
    // Otherwise treat as shortcut (menu accelerators, etc.)
    return { input, type: 'shortcut', isPrintable: false };
  }

  // Function keys are shortcuts
  if (FUNCTION_KEYS.has(physicalKey)) {
    return { input, type: 'shortcut', isPrintable: false };
  }

  // Navigation keys
  if (NAVIGATION_KEYS.has(physicalKey)) {
    return { input, type: 'navigation', isPrintable: false };
  }

  // Action keys (Enter, Escape, Delete, etc.)
  if (ACTION_KEYS.has(physicalKey)) {
    // Space is special - in most contexts it's a printable character
    // but in some contexts (button activation, checkbox toggle) it's an action
    const isPrintable = physicalKey === 'Space';
    return { input, type: 'action', isPrintable };
  }

  // Character input - letters, digits, punctuation, numpad
  // Check if it produces a single printable character
  if (character.length === 1 && character !== '\n' && character !== '\t') {
    const charCode = character.charCodeAt(0);
    // Printable ASCII and beyond (excluding control characters)
    if (charCode >= 0x20) {
      return { input, type: 'character', isPrintable: true };
    }
  }

  // Unknown/unhandled key
  return { input, type: 'unknown', isPrintable: false };
}

// =============================================================================
// Input Utility Functions
// =============================================================================

/**
 * Check if the input has any command modifier (Ctrl or Meta).
 *
 * @param input - The keyboard input
 * @returns True if Ctrl or Meta is pressed
 */
export function hasCommandModifier(input: KeyboardInput): boolean {
  return input.modifiers.ctrl || input.modifiers.meta;
}

/**
 * Check if the input has the platform-appropriate command modifier.
 *
 * On Mac, this is Meta (Cmd). On Windows/Linux, this is Ctrl.
 *
 * @param input - The keyboard input
 * @returns True if the platform command modifier is pressed
 */
export function hasPlatformCommandModifier(input: KeyboardInput): boolean {
  return input.platform === 'macos' ? input.modifiers.meta : input.modifiers.ctrl;
}

/**
 * Check if the input has only the specified modifiers and no others.
 *
 * @param input - The keyboard input
 * @param modifiers - Object specifying which modifiers should be pressed
 * @returns True if exactly the specified modifiers are pressed
 *
 * @example
 * ```ts
 * // Check for exactly Ctrl+Shift (no Alt or Meta)
 * if (hasExactModifiers(input, { ctrl: true, shift: true })) {
 *   // ...
 * }
 * ```
 */
export function hasExactModifiers(
  input: KeyboardInput,
  modifiers: Partial<Record<'ctrl' | 'shift' | 'alt' | 'meta', boolean>>,
): boolean {
  const { ctrl = false, shift = false, alt = false, meta = false } = modifiers;
  return (
    input.modifiers.ctrl === ctrl &&
    input.modifiers.shift === shift &&
    input.modifiers.alt === alt &&
    input.modifiers.meta === meta
  );
}

/**
 * Check if no modifiers are pressed.
 *
 * @param input - The keyboard input
 * @returns True if no modifier keys are pressed
 */
export function hasNoModifiers(input: KeyboardInput): boolean {
  return (
    !input.modifiers.ctrl && !input.modifiers.shift && !input.modifiers.alt && !input.modifiers.meta
  );
}
