/**
 * Type declarations for the Keyboard API (navigator.keyboard).
 *
 * The Keyboard API is available in Chromium-based browsers (Chrome, Edge, Tauri webview).
 * It is NOT available in Safari or Firefox. TypeScript's default lib does not include
 * these types, so we declare them here.
 *
 * @see https://wicg.github.io/keyboard-map/
 */

/**
 * A read-only map of physical key codes to the characters they produce
 * in the user's current keyboard layout.
 *
 * Keys are KeyboardEvent.code values (e.g., 'KeyQ', 'Digit1').
 * Values are the characters produced (e.g., 'a' on QWERTY, 'q' on AZERTY for 'KeyA').
 */
interface KeyboardLayoutMap extends ReadonlyMap<string, string> {}

/**
 * The Keyboard interface provides access to keyboard layout information.
 */
interface Keyboard extends EventTarget {
  /**
   * Returns a promise that resolves with a KeyboardLayoutMap describing
   * the mapping from physical key codes to characters for the user's
   * current keyboard layout.
   */
  getLayoutMap(): Promise<KeyboardLayoutMap>;

  addEventListener(type: 'layoutchange', listener: () => void): void;
  removeEventListener(type: 'layoutchange', listener: () => void): void;
}

interface Navigator {
  /**
   * The Keyboard API. Available in Chromium-based browsers only.
   * Undefined in Safari, Firefox, and non-browser environments.
   */
  readonly keyboard?: Keyboard;
}
