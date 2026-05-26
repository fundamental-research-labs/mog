/**
 * @file Physical Keyboard Key Types
 *
 * Defines physical keyboard key codes, modifier keys, and platform types.
 * Based on KeyboardEvent.code values from the W3C UI Events specification.
 *
 * @see https://www.w3.org/TR/uievents-code/
 */

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

export type NavigationKeyCode =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown';

export type EditingKeyCode =
  | 'Backspace'
  | 'Delete'
  | 'Insert'
  | 'Enter'
  | 'Tab'
  | 'Escape'
  | 'Space';

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

export type SpecialKeyCode =
  | 'ContextMenu'
  | 'NumLock'
  | 'ScrollLock'
  | 'Pause'
  | 'PrintScreen'
  | 'CapsLock';

export type ModifierKeyCode =
  | 'ShiftLeft'
  | 'ShiftRight'
  | 'ControlLeft'
  | 'ControlRight'
  | 'AltLeft'
  | 'AltRight'
  | 'MetaLeft'
  | 'MetaRight';

export type ImeKeyCode =
  | 'Convert'
  | 'NonConvert'
  | 'KanaMode'
  | 'Lang1'
  | 'Lang2'
  | 'Hangul'
  | 'Hanja';

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

/**
 * Raw `KeyboardEvent.code` after normalization.
 *
 * Shortcut definitions should use `PhysicalKeyCode`; browser input must allow
 * unknown future/vendor codes without forcing casts at the DOM boundary.
 */
export type KeyboardEventCode = PhysicalKeyCode | (string & {});

export type ModifierKey = 'ctrl' | 'shift' | 'alt' | 'meta';

export interface ModifierState {
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

export type Platform = 'macos' | 'windows' | 'linux';

// =============================================================================
// Utility Type Guards
// =============================================================================

/**
 * Set of all valid physical key codes for O(1) lookup.
 * @internal
 */
const PHYSICAL_KEY_CODES = new Set<string>([
  // Letters
  'KeyA',
  'KeyB',
  'KeyC',
  'KeyD',
  'KeyE',
  'KeyF',
  'KeyG',
  'KeyH',
  'KeyI',
  'KeyJ',
  'KeyK',
  'KeyL',
  'KeyM',
  'KeyN',
  'KeyO',
  'KeyP',
  'KeyQ',
  'KeyR',
  'KeyS',
  'KeyT',
  'KeyU',
  'KeyV',
  'KeyW',
  'KeyX',
  'KeyY',
  'KeyZ',
  // Digits
  'Digit0',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  // Numpad
  'Numpad0',
  'Numpad1',
  'Numpad2',
  'Numpad3',
  'Numpad4',
  'Numpad5',
  'Numpad6',
  'Numpad7',
  'Numpad8',
  'Numpad9',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'NumpadDecimal',
  'NumpadEnter',
  'NumpadEqual',
  'NumpadComma',
  'NumpadParenLeft',
  'NumpadParenRight',
  // Function keys
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
  // Navigation
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  // Editing
  'Backspace',
  'Delete',
  'Insert',
  'Enter',
  'Tab',
  'Escape',
  'Space',
  // Punctuation
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
  'Backslash',
  'Backquote',
  'IntlBackslash',
  'IntlRo',
  'IntlYen',
  // Special
  'ContextMenu',
  'NumLock',
  'ScrollLock',
  'Pause',
  'PrintScreen',
  'CapsLock',
  // Modifiers
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  // IME
  'Convert',
  'NonConvert',
  'KanaMode',
  'Lang1',
  'Lang2',
  'Hangul',
  'Hanja',
]);

/**
 * Type guard to check if a string is a valid PhysicalKeyCode.
 *
 * @param code - The string to check
 * @returns True if the string is a valid PhysicalKeyCode
 *
 * @example
 * ```ts
 * const code = event.code;
 * if (isPhysicalKeyCode(code)) {
 *   // code is narrowed to PhysicalKeyCode
 *   handleKey(code);
 * }
 * ```
 */
export function isPhysicalKeyCode(code: string): code is PhysicalKeyCode {
  return PHYSICAL_KEY_CODES.has(code);
}

/**
 * Set of modifier key codes for O(1) lookup.
 * @internal
 */
const MODIFIER_KEY_CODES = new Set<string>([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/**
 * Type guard to check if a PhysicalKeyCode is a modifier key code.
 *
 * @param code - The key code to check
 * @returns True if the key code is a modifier (Shift, Ctrl, Alt, Meta)
 *
 * @example
 * ```ts
 * if (isModifierKeyCode(event.code)) {
 *   // This is a modifier-only keypress
 * }
 * ```
 */
export function isModifierKeyCode(code: string): code is ModifierKeyCode {
  return MODIFIER_KEY_CODES.has(code);
}

/**
 * Physical key codes that are register transitions: their keydown affects
 * subsequent keystrokes via `input.modifiers.*` (or, for CapsLock, implicit
 * caps state) but is never itself a shortcut event. The coordinator filters
 * these before chord routing or normal matching runs.
 *
 * Strict superset of {@link ModifierKeyCode}: adds CapsLock, which has no
 * `ModifierKey` logical name (so it cannot appear in shortcut bindings) but
 * otherwise behaves identically at the coordinator seam.
 *
 * Deliberately excludes NumLock and ScrollLock: ScrollLock has a production
 * binding (`view.toggle-scroll-lock` in `apps/spreadsheet/src/keyboard/
 * definitions/view.ts:289`) that listens for bare-keydown; filtering it
 * here would dead-code that shortcut.
 */
export type RegisterTransitionKeyCode = ModifierKeyCode | 'CapsLock';

// `MODIFIER_KEY_CODES` above is module-private (no `export` keyword) and is
// the W3C-four set. `REGISTER_TRANSITION_KEY_CODES` MUST be defined in the
// SAME file (`physical-keys.ts`) so it can spread the module-private
// constant; defining it elsewhere would require either exporting
// `MODIFIER_KEY_CODES` (widens its surface unnecessarily) or duplicating
// the list (drift hazard). The companion `isModifierKeyCode` helper above
// stays narrow.
const REGISTER_TRANSITION_KEY_CODES = new Set<string>([...MODIFIER_KEY_CODES, 'CapsLock']);

/**
 * Type guard to check if a PhysicalKeyCode is a register-transition key code
 * (W3C modifiers Shift/Ctrl/Alt/Meta plus CapsLock). Used by the coordinator
 * to filter bare register-transition keydowns before they reach chord routing
 * or normal matching — their effect is carried in the next non-modifier
 * keystroke's `input.modifiers.*` (or implicit caps state).
 *
 * @param code - The key code to check
 * @returns True if the key code is a register transition
 */
export function isRegisterTransitionKey(code: string): code is RegisterTransitionKeyCode {
  return REGISTER_TRANSITION_KEY_CODES.has(code);
}

/**
 * Type guard to check if a string is a valid ModifierKey.
 *
 * @param key - The string to check
 * @returns True if the string is a valid ModifierKey
 */
export function isModifierKey(key: string): key is ModifierKey {
  return key === 'ctrl' || key === 'shift' || key === 'alt' || key === 'meta';
}

/**
 * Create a ModifierState with all modifiers set to false.
 *
 * @returns An empty ModifierState (no modifiers pressed)
 */
export function emptyModifierState(): ModifierState {
  return { ctrl: false, shift: false, alt: false, meta: false };
}

/**
 * Create a ModifierState from a list of active modifiers.
 *
 * @param modifiers - Array of modifier keys that are pressed
 * @returns ModifierState with specified modifiers set to true
 *
 * @example
 * ```ts
 * const state = createModifierState(['ctrl', 'shift']);
 * // { ctrl: true, shift: true, alt: false, meta: false }
 * ```
 */
export function createModifierState(modifiers: readonly ModifierKey[]): ModifierState {
  return {
    ctrl: modifiers.includes('ctrl'),
    shift: modifiers.includes('shift'),
    alt: modifiers.includes('alt'),
    meta: modifiers.includes('meta'),
  };
}

/**
 * Check if two ModifierState objects are equal.
 *
 * @param a - First modifier state
 * @param b - Second modifier state
 * @returns True if all modifier values match
 */
export function modifierStatesEqual(a: ModifierState, b: ModifierState): boolean {
  return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.meta === b.meta;
}

/**
 * Get the list of active modifiers from a ModifierState.
 *
 * @param state - The modifier state to check
 * @returns Array of active modifier keys
 *
 * @example
 * ```ts
 * const active = getActiveModifiers({ ctrl: true, shift: true, alt: false, meta: false });
 * // ['ctrl', 'shift']
 * ```
 */
export function getActiveModifiers(state: ModifierState): ModifierKey[] {
  const active: ModifierKey[] = [];
  if (state.ctrl) active.push('ctrl');
  if (state.shift) active.push('shift');
  if (state.alt) active.push('alt');
  if (state.meta) active.push('meta');
  return active;
}
