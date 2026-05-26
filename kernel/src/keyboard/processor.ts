/**
 * KeyboardEventProcessor - the SINGLE entry point for all keyboard events.
 *
 * This is the ONLY place that touches raw KeyboardEvent properties.
 * All other code works with KeyboardInput.
 *
 * The processor performs two key functions:
 * 1. Normalization: Convert raw DOM KeyboardEvent into platform-agnostic KeyboardInput
 * 2. Classification: Determine what type of input this is (shortcut, navigation, etc.)
 *
 * @example
 * ```typescript
 * const processor = new KeyboardEventProcessor('macos');
 *
 * document.addEventListener('keydown', (e) => {
 *   const input = processor.process(e);
 *   const classified = processor.classify(input);
 *
 *   switch (classified.type) {
 *     case 'shortcut':
 *       // Match against shortcut registry
 *       break;
 *     case 'character':
 *       // Forward to text input
 *       break;
 *     // ...
 *   }
 * });
 * ```
 *
 */

import type { ClassifiedInput, KeyboardInput, ModifierState, Platform } from './primitives/index';
import { classifyInput } from './primitives/index';

/**
 * The IME composition keyCode.
 * When a KeyboardEvent has keyCode 229, it indicates that the event
 * is part of an IME (Input Method Editor) composition sequence.
 */
const IME_COMPOSITION_KEYCODE = 229;

/**
 * KeyboardEventProcessor - normalizes and classifies keyboard events.
 *
 * This class is the single point of contact with raw DOM KeyboardEvent.
 * All downstream consumers work with the normalized KeyboardInput type.
 */
export class KeyboardEventProcessor {
  private readonly _platform: Platform;

  /**
   * Create a new KeyboardEventProcessor.
   *
   * @param platform - The platform to use for input classification.
   */
  constructor(platform: Platform) {
    this._platform = platform;
  }

  /**
   * Get the detected or configured platform.
   */
  get platform(): Platform {
    return this._platform;
  }

  /**
   * Process a raw DOM KeyboardEvent into a normalized KeyboardInput.
   *
   * This extracts all relevant information from the event and normalizes it
   * into a platform-agnostic representation.
   *
   * @param event - The raw DOM KeyboardEvent
   * @returns Normalized KeyboardInput
   */
  process(event: KeyboardEvent): KeyboardInput {
    const physicalKey = event.code;
    const character = event.key;

    const modifiers: ModifierState = {
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
    };

    // IME detection: either the explicit isComposing flag or the legacy keyCode 229
    const isComposing = event.isComposing || event.keyCode === IME_COMPOSITION_KEYCODE;

    return {
      physicalKey,
      character,
      modifiers,
      isRepeat: event.repeat,
      isComposing,
      platform: this._platform,
      timestamp: event.timeStamp,
      originalEvent: event,
    };
  }

  /**
   * Classify what type of input this is.
   *
   * Delegates to classifyInput() which implements the correct classification:
   * - 'composition': IME input - pass through to text system
   * - 'modifier-only': Just a modifier key - often ignored
   * - 'shortcut': Ctrl/Meta modifier, Alt on non-Mac, F-keys, or Alt+non-letter on Mac
   * - 'navigation': Arrow keys, Tab, Home/End, PageUp/Down
   * - 'action': Enter, Escape, Delete, Backspace, Insert, Space
   * - 'character': Printable character - for text entry (including Mac Option+letter)
   * - 'unknown': Fallback
   *
   * @param input - The normalized KeyboardInput
   * @returns ClassifiedInput with type and optional isPrintable flag
   */
  classify(input: KeyboardInput): ClassifiedInput {
    return classifyInput(input);
  }

  /**
   * Process and classify a keyboard event in one step.
   *
   * Convenience method that combines process() and classify().
   *
   * @param event - The raw DOM KeyboardEvent
   * @returns ClassifiedInput
   */
  processAndClassify(event: KeyboardEvent): ClassifiedInput {
    return this.classify(this.process(event));
  }
}

/**
 * Partial KeyboardInput for building mock inputs in tests.
 * More ergonomic than Partial<KeyboardInput> because it allows partial modifiers.
 */
export type PartialTestKeyboardInput = Omit<Partial<KeyboardInput>, 'modifiers'> & {
  modifiers?: Partial<ModifierState>;
};

/**
 * Test helper: create a KeyboardInput with sensible defaults.
 *
 * NOT for production use — use the production `createKeyboardInput` from
 * `primitives/input.ts` which converts real DOM KeyboardEvents.
 *
 * @param overrides - Partial fields to merge with defaults
 * @returns Complete KeyboardInput
 */
export function createTestKeyboardInput(overrides: PartialTestKeyboardInput): KeyboardInput {
  // For testing, we create a minimal mock event if none provided
  const defaults: KeyboardInput = {
    physicalKey: 'KeyA',
    character: 'a',
    modifiers: {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    },
    isRepeat: false,
    isComposing: false,
    platform: 'windows',
    timestamp: Date.now(),
    // For test purposes, use a minimal mock - actual code always has a real event
    originalEvent: {} as KeyboardEvent,
  };

  return {
    ...defaults,
    ...overrides,
    modifiers: {
      ...defaults.modifiers,
      ...overrides.modifiers,
    },
  };
}
