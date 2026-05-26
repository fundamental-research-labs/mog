/**
 * @file Physical Keyboard Key Types
 *
 * Defines physical keyboard key codes, modifier keys, and platform types.
 * Based on KeyboardEvent.code values from the W3C UI Events specification.
 *
 * @see https://www.w3.org/TR/uievents-code/
 */

// =============================================================================
// Letter Keys (KeyA-KeyZ)
// =============================================================================

/** Physical letter key codes (KeyA through KeyZ) */
export type LetterKeyCode =
  | 'KeyA'
  | 'KeyB'
  | 'KeyC'
  | 'KeyD'
  | 'KeyE'
  | 'KeyF'
  | 'KeyG'
  | 'KeyH'
  | 'KeyI'
  | 'KeyJ'
  | 'KeyK'
  | 'KeyL'
  | 'KeyM'
  | 'KeyN'
  | 'KeyO'
  | 'KeyP'
  | 'KeyQ'
  | 'KeyR'
  | 'KeyS'
  | 'KeyT'
  | 'KeyU'
  | 'KeyV'
  | 'KeyW'
  | 'KeyX'
  | 'KeyY'
  | 'KeyZ';

// =============================================================================
// Digit Keys (Digit0-Digit9)
// =============================================================================

/** Physical digit key codes (Digit0 through Digit9) */
export type DigitKeyCode =
  | 'Digit0'
  | 'Digit1'
  | 'Digit2'
  | 'Digit3'
  | 'Digit4'
  | 'Digit5'
  | 'Digit6'
  | 'Digit7'
  | 'Digit8'
  | 'Digit9';

// =============================================================================
// Numpad Keys
// =============================================================================

/** Physical numpad key codes */
export type NumpadKeyCode =
  | 'Numpad0'
  | 'Numpad1'
  | 'Numpad2'
  | 'Numpad3'
  | 'Numpad4'
  | 'Numpad5'
  | 'Numpad6'
  | 'Numpad7'
  | 'Numpad8'
  | 'Numpad9'
  | 'NumpadAdd'
  | 'NumpadSubtract'
  | 'NumpadMultiply'
  | 'NumpadDivide'
  | 'NumpadDecimal'
  | 'NumpadEnter'
  | 'NumpadEqual'
  | 'NumpadComma'
  | 'NumpadParenLeft'
  | 'NumpadParenRight';

// =============================================================================
// Function Keys (F1-F12)
// =============================================================================

/** Physical function key codes (F1 through F12) */
export type FunctionKeyCode =
  | 'F1'
  | 'F2'
  | 'F3'
  | 'F4'
  | 'F5'
  | 'F6'
  | 'F7'
  | 'F8'
  | 'F9'
  | 'F10'
  | 'F11'
  | 'F12';

// =============================================================================
// Navigation Keys
// =============================================================================

/** Physical navigation key codes */
export type NavigationKeyCode =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown';

// =============================================================================
// Editing Keys
// =============================================================================

/** Physical editing key codes */
export type EditingKeyCode =
  | 'Backspace'
  | 'Delete'
  | 'Insert'
  | 'Enter'
  | 'Tab'
  | 'Escape'
  | 'Space';

// =============================================================================
// Punctuation Keys
// =============================================================================

/** Physical punctuation key codes */
export type PunctuationKeyCode =
  | 'Minus'
  | 'Equal'
  | 'BracketLeft'
  | 'BracketRight'
  | 'Semicolon'
  | 'Quote'
  | 'Comma'
  | 'Period'
  | 'Slash'
  | 'Backslash'
  | 'Backquote'
  | 'IntlBackslash'
  | 'IntlRo'
  | 'IntlYen';

// =============================================================================
// Special Keys
// =============================================================================

/** Physical special key codes */
export type SpecialKeyCode =
  | 'ContextMenu'
  | 'NumLock'
  | 'ScrollLock'
  | 'Pause'
  | 'PrintScreen'
  | 'CapsLock';

// =============================================================================
// Modifier Key Codes
// =============================================================================

/** Physical modifier key codes (left/right variants) */
export type ModifierKeyCode =
  | 'ShiftLeft'
  | 'ShiftRight'
  | 'ControlLeft'
  | 'ControlRight'
  | 'AltLeft'
  | 'AltRight'
  | 'MetaLeft'
  | 'MetaRight';

// =============================================================================
// International/IME Keys
// =============================================================================

/** Physical keys for Japanese/Korean IME input */
export type ImeKeyCode =
  | 'Convert'
  | 'NonConvert'
  | 'KanaMode'
  | 'Lang1'
  | 'Lang2'
  | 'Hangul'
  | 'Hanja';

// =============================================================================
// Combined Physical Key Code
// =============================================================================

/**
 * Union of all physical key codes supported by the keyboard system.
 *
 * These correspond to KeyboardEvent.code values and represent the physical
 * location of a key on the keyboard, independent of the current keyboard layout.
 *
 * @example
 * ```ts
 * const handleKey = (code: PhysicalKeyCode) => {
 *   if (code === 'KeyA') {
 *     // Always the left-most letter key, regardless of layout (QWERTY, AZERTY, etc.)
 *   }
 * };
 * ```
 */
export type PhysicalKeyCode =
  | LetterKeyCode
  | DigitKeyCode
  | NumpadKeyCode
  | FunctionKeyCode
  | NavigationKeyCode
  | EditingKeyCode
  | PunctuationKeyCode
  | SpecialKeyCode
  | ModifierKeyCode
  | ImeKeyCode;

// =============================================================================
// Modifier Key Types
// =============================================================================

/**
 * Logical modifier key names.
 *
 * These represent the logical modifier keys (not physical key codes) used
 * in shortcut definitions. The mapping from physical to logical is:
 * - 'ctrl' maps to ControlLeft/ControlRight
 * - 'shift' maps to ShiftLeft/ShiftRight
 * - 'alt' maps to AltLeft/AltRight
 * - 'meta' maps to MetaLeft/MetaRight (Cmd on Mac, Win key on Windows)
 */
export type ModifierKey = 'ctrl' | 'shift' | 'alt' | 'meta';

/**
 * Complete modifier key state.
 *
 * Represents the state of all modifier keys at a point in time.
 * Used for matching keyboard shortcuts and tracking modifier state.
 */
export interface ModifierState {
  /** Control key state (Ctrl on Windows/Linux, Control on Mac) */
  readonly ctrl: boolean;
  /** Shift key state */
  readonly shift: boolean;
  /** Alt key state (Alt on Windows/Linux, Option on Mac) */
  readonly alt: boolean;
  /** Meta key state (Win on Windows, Cmd on Mac) */
  readonly meta: boolean;
}

// =============================================================================
// Platform Type
// =============================================================================

/**
 * Supported operating system platforms.
 *
 * Re-exported from contracts/platform where the canonical definition lives.
 * Keyboard code imports Platform for shortcut binding resolution.
 */
export type { Platform } from '@mog-sdk/types-document/platform';
