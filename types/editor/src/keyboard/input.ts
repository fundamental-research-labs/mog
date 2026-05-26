/**
 * @file Keyboard Input Types
 *
 * Defines the normalized keyboard input types that all handlers receive.
 * This provides a consistent interface regardless of the original browser event.
 */

import type { ModifierState, PhysicalKeyCode, Platform } from './physical-keys';

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
export type KeyboardInputType =
  | 'shortcut'
  | 'navigation'
  | 'action'
  | 'character'
  | 'composition'
  | 'modifier-only'
  | 'unknown';

// =============================================================================
// Keyboard Input
// =============================================================================

/**
 * Normalized keyboard input.
 *
 * This is the canonical representation of a keyboard event that all handlers
 * receive. It normalizes browser differences and provides all information
 * needed to handle the input correctly.
 *
 * @remarks
 * The KeyboardInput is immutable - once created from a KeyboardEvent, it
 * cannot be modified. This ensures consistent behavior across all handlers.
 *
 * @example
 * ```ts
 * function handleInput(input: KeyboardInput) {
 *   if (input.modifiers.ctrl && input.physicalKey === 'KeyC') {
 *     // Handle Ctrl+C
 *   }
 *   if (input.character && !input.modifiers.ctrl && !input.modifiers.meta) {
 *     // Handle character input
 *   }
 * }
 * ```
 */
export interface KeyboardInput {
  /**
   * The physical key code (from KeyboardEvent.code).
   *
   * This represents the physical location of the key on the keyboard,
   * independent of the current keyboard layout.
   */
  readonly physicalKey: PhysicalKeyCode;

  /**
   * The character produced by this key (from KeyboardEvent.key).
   *
   * For printable keys, this is the character that would be typed.
   * For non-printable keys, this may be a named value like 'Enter', 'Escape', etc.
   * For modifier-only keypresses, this will be the modifier name.
   */
  readonly character: string;

  /**
   * The state of all modifier keys when this input occurred.
   */
  readonly modifiers: ModifierState;

  /**
   * Whether the input is part of an IME composition.
   *
   * When true, the input should generally be passed through to allow
   * the IME to complete its composition. Only the final composed
   * character should be processed.
   */
  readonly isComposing: boolean;

  /**
   * Whether this is a repeated keypress (key held down).
   *
   * Some shortcuts should only trigger once even when held (like Ctrl+S),
   * while others should repeat (like arrow navigation).
   */
  readonly isRepeat: boolean;

  /**
   * The current platform.
   *
   * Used for platform-specific behavior (e.g., Cmd vs Ctrl on Mac).
   */
  readonly platform: Platform;

  /**
   * High-resolution timestamp when the input occurred.
   *
   * From KeyboardEvent.timeStamp (milliseconds since page load).
   */
  readonly timestamp: number;

  /**
   * The original browser KeyboardEvent.
   *
   * Preserved for cases where low-level access is needed, such as
   * calling preventDefault() or accessing event.target.
   */
  readonly originalEvent: KeyboardEvent;
}

// =============================================================================
// Classified Input
// =============================================================================

/**
 * A keyboard input with its type classification.
 *
 * This combines the normalized input with its classification, which
 * determines how it should be routed through the keyboard system.
 */
export interface ClassifiedInput {
  /**
   * The normalized keyboard input.
   */
  readonly input: KeyboardInput;

  /**
   * The classification of this input type.
   */
  readonly type: KeyboardInputType;

  /**
   * Whether the input produces a printable character.
   *
   * True for letters, numbers, symbols that would appear in a text field.
   * False for function keys, navigation keys, modifier-only presses, etc.
   *
   * This is only defined when relevant (character and some action types).
   */
  readonly isPrintable?: boolean;
}
