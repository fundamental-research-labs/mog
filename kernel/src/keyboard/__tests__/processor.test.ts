/**
 * KeyboardEventProcessor Tests
 *
 * Comprehensive tests for keyboard event processing and classification.
 *
 */

import { jest } from '@jest/globals';

import { createTestKeyboardInput, KeyboardEventProcessor } from '../processor';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock KeyboardEvent for testing.
 */
function createMockKeyboardEvent(options: {
  key: string;
  code: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  repeat?: boolean;
}): KeyboardEvent {
  const event = {
    key: options.key,
    code: options.code,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
    isComposing: options.isComposing ?? false,
    keyCode: options.keyCode ?? 0,
    repeat: options.repeat ?? false,
    timeStamp: Date.now(),
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  } as unknown as KeyboardEvent;

  return event;
}

// =============================================================================
// KeyboardEventProcessor Tests
// =============================================================================

describe('KeyboardEventProcessor', () => {
  describe('constructor', () => {
    it('should use provided platform', () => {
      const processor = new KeyboardEventProcessor('macos');
      expect(processor.platform).toBe('macos');
    });

    it('should accept each valid platform', () => {
      for (const p of ['macos', 'windows', 'linux'] as const) {
        const processor = new KeyboardEventProcessor(p);
        expect(processor.platform).toBe(p);
      }
    });
  });

  describe('process()', () => {
    const processor = new KeyboardEventProcessor('windows');

    it('should extract physicalKey from event.code', () => {
      const event = createMockKeyboardEvent({ key: 'a', code: 'KeyA' });
      const input = processor.process(event);
      expect(input.physicalKey).toBe('KeyA');
    });

    it('should extract character from event.key', () => {
      const event = createMockKeyboardEvent({ key: 'a', code: 'KeyA' });
      const input = processor.process(event);
      expect(input.character).toBe('a');
    });

    it('should extract uppercase character when shift is held', () => {
      const event = createMockKeyboardEvent({ key: 'A', code: 'KeyA', shiftKey: true });
      const input = processor.process(event);
      expect(input.character).toBe('A');
      expect(input.modifiers.shift).toBe(true);
    });

    it('should extract all modifier states', () => {
      const event = createMockKeyboardEvent({
        key: 'a',
        code: 'KeyA',
        ctrlKey: true,
        shiftKey: true,
        altKey: true,
        metaKey: true,
      });
      const input = processor.process(event);
      expect(input.modifiers).toEqual({
        ctrl: true,
        shift: true,
        alt: true,
        meta: true,
      });
    });

    it('should detect IME composition via isComposing flag', () => {
      const event = createMockKeyboardEvent({
        key: 'Process',
        code: '',
        isComposing: true,
      });
      const input = processor.process(event);
      expect(input.isComposing).toBe(true);
    });

    it('should detect IME composition via keyCode 229', () => {
      const event = createMockKeyboardEvent({
        key: 'Process',
        code: '',
        keyCode: 229,
      });
      const input = processor.process(event);
      expect(input.isComposing).toBe(true);
    });

    it('should detect key repeat', () => {
      const event = createMockKeyboardEvent({
        key: 'a',
        code: 'KeyA',
        repeat: true,
      });
      const input = processor.process(event);
      expect(input.isRepeat).toBe(true);
    });

    it('should include platform from processor', () => {
      const macProcessor = new KeyboardEventProcessor('macos');
      const event = createMockKeyboardEvent({ key: 'a', code: 'KeyA' });
      const input = macProcessor.process(event);
      expect(input.platform).toBe('macos');
    });

    it('should include timestamp from event', () => {
      const event = createMockKeyboardEvent({ key: 'a', code: 'KeyA' });
      const input = processor.process(event);
      expect(input.timestamp).toBe(event.timeStamp);
    });

    it('should include reference to original event', () => {
      const event = createMockKeyboardEvent({ key: 'a', code: 'KeyA' });
      const input = processor.process(event);
      expect(input.originalEvent).toBe(event);
    });

    it('should handle arrow keys correctly', () => {
      const event = createMockKeyboardEvent({ key: 'ArrowUp', code: 'ArrowUp' });
      const input = processor.process(event);
      expect(input.physicalKey).toBe('ArrowUp');
      expect(input.character).toBe('ArrowUp');
    });

    it('should handle function keys correctly', () => {
      const event = createMockKeyboardEvent({ key: 'F1', code: 'F1' });
      const input = processor.process(event);
      expect(input.physicalKey).toBe('F1');
      expect(input.character).toBe('F1');
    });

    it('should handle numpad keys correctly', () => {
      const event = createMockKeyboardEvent({ key: '5', code: 'Numpad5' });
      const input = processor.process(event);
      expect(input.physicalKey).toBe('Numpad5');
      expect(input.character).toBe('5');
    });
  });

  describe('classify()', () => {
    const processor = new KeyboardEventProcessor('windows');

    // -------------------------------------------------------------------------
    // IME Composition
    // -------------------------------------------------------------------------

    describe('composition input', () => {
      it('should classify isComposing=true as composition', () => {
        const input = createTestKeyboardInput({ isComposing: true });
        const classified = processor.classify(input);
        expect(classified.type).toBe('composition');
      });

      it('should prioritize composition over other classifications', () => {
        // Even with ctrl modifier, composition takes priority
        const input = createTestKeyboardInput({
          isComposing: true,
          modifiers: { ctrl: true, shift: false, alt: false, meta: false },
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('composition');
      });
    });

    // -------------------------------------------------------------------------
    // Modifier-Only Keys
    // -------------------------------------------------------------------------

    describe('modifier-only input', () => {
      it('should classify ShiftLeft as modifier-only', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'ShiftLeft',
          character: 'Shift',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('modifier-only');
      });

      it('should classify ControlLeft as modifier-only', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'ControlLeft',
          character: 'Control',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('modifier-only');
      });

      it('should classify AltLeft as modifier-only', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'AltLeft',
          character: 'Alt',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('modifier-only');
      });

      it('should classify MetaLeft as modifier-only', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'MetaLeft',
          character: 'Meta',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('modifier-only');
      });

      it('should classify right-side modifiers as modifier-only', () => {
        const rightModifiers = ['ShiftRight', 'ControlRight', 'AltRight', 'MetaRight'] as const;
        for (const physicalKey of rightModifiers) {
          const input = createTestKeyboardInput({ physicalKey });
          const classified = processor.classify(input);
          expect(classified.type).toBe('modifier-only');
        }
      });

      it('should classify CapsLock as modifier-only', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'CapsLock',
          character: 'CapsLock',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('modifier-only');
      });

      it('should classify NumLock as modifier-only', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'NumLock',
          character: 'NumLock',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('modifier-only');
      });
    });

    // -------------------------------------------------------------------------
    // Shortcut Classification
    // -------------------------------------------------------------------------

    describe('shortcut input', () => {
      it('should classify Ctrl+C as shortcut', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'KeyC',
          character: 'c',
          modifiers: { ctrl: true, shift: false, alt: false, meta: false },
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('shortcut');
      });

      it('should classify Cmd+C (Meta+C) as shortcut', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'KeyC',
          character: 'c',
          modifiers: { ctrl: false, shift: false, alt: false, meta: true },
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('shortcut');
      });

      it('should classify Alt+Tab as shortcut', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Tab',
          character: 'Tab',
          modifiers: { ctrl: false, shift: false, alt: true, meta: false },
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('shortcut');
      });

      it('should classify Ctrl+Shift+Z as shortcut', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'KeyZ',
          character: 'Z',
          modifiers: { ctrl: true, shift: true, alt: false, meta: false },
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('shortcut');
      });

      it('should classify Ctrl+Alt+Delete as shortcut', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Delete',
          character: 'Delete',
          modifiers: { ctrl: true, shift: false, alt: true, meta: false },
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('shortcut');
      });

      it('should NOT classify Shift+A as shortcut (it is a character)', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'KeyA',
          character: 'A',
          modifiers: { ctrl: false, shift: true, alt: false, meta: false },
        });
        const classified = processor.classify(input);
        // Shift+A produces 'A', which is a printable character
        expect(classified.type).toBe('character');
      });

      it('should NOT classify Shift+1 as shortcut (it is a character)', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Digit1',
          character: '!',
          modifiers: { ctrl: false, shift: true, alt: false, meta: false },
        });
        const classified = processor.classify(input);
        // Shift+1 produces '!', which is a printable character
        expect(classified.type).toBe('character');
      });

      it('should classify Ctrl+ArrowUp as shortcut (not navigation)', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'ArrowUp',
          character: 'ArrowUp',
          modifiers: { ctrl: true, shift: false, alt: false, meta: false },
        });
        const classified = processor.classify(input);
        // Ctrl makes it a shortcut, overriding navigation classification
        expect(classified.type).toBe('shortcut');
      });
    });

    // -------------------------------------------------------------------------
    // Navigation Keys
    // -------------------------------------------------------------------------

    describe('navigation input', () => {
      it('should classify ArrowUp as navigation', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'ArrowUp',
          character: 'ArrowUp',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('navigation');
      });

      it('should classify ArrowDown as navigation', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'ArrowDown',
          character: 'ArrowDown',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('navigation');
      });

      it('should classify ArrowLeft as navigation', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'ArrowLeft',
          character: 'ArrowLeft',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('navigation');
      });

      it('should classify ArrowRight as navigation', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'ArrowRight',
          character: 'ArrowRight',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('navigation');
      });

      it('should classify Home as navigation', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Home',
          character: 'Home',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('navigation');
      });

      it('should classify End as navigation', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'End',
          character: 'End',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('navigation');
      });

      it('should classify PageUp as navigation', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'PageUp',
          character: 'PageUp',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('navigation');
      });

      it('should classify PageDown as navigation', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'PageDown',
          character: 'PageDown',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('navigation');
      });

      it('should classify Shift+Arrow as navigation (not shortcut)', () => {
        // Shift+Arrow is for selection, but it's still navigation, not a shortcut
        const input = createTestKeyboardInput({
          physicalKey: 'ArrowUp',
          character: 'ArrowUp',
          modifiers: { ctrl: false, shift: true, alt: false, meta: false },
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('navigation');
      });
    });

    // -------------------------------------------------------------------------
    // Action Keys
    // -------------------------------------------------------------------------

    describe('action input', () => {
      it('should classify Enter as action', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Enter',
          character: 'Enter',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('action');
      });

      it('should classify NumpadEnter as action', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'NumpadEnter',
          character: 'Enter',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('action');
      });

      it('should classify Escape as action', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Escape',
          character: 'Escape',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('action');
      });

      it('should classify Tab as navigation', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Tab',
          character: 'Tab',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('navigation');
      });

      it('should classify Backspace as action', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Backspace',
          character: 'Backspace',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('action');
      });

      it('should classify Delete as action', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Delete',
          character: 'Delete',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('action');
      });

      it('should classify Insert as action', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Insert',
          character: 'Insert',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('action');
      });

      it('should classify F1-F12 as shortcut', () => {
        for (let i = 1; i <= 12; i++) {
          const input = createTestKeyboardInput({
            physicalKey: `F${i}`,
            character: `F${i}`,
          });
          const classified = processor.classify(input);
          expect(classified.type).toBe('shortcut');
        }
      });
    });

    // -------------------------------------------------------------------------
    // Character Input
    // -------------------------------------------------------------------------

    describe('character input', () => {
      it('should classify lowercase letters as character', () => {
        for (const char of 'abcdefghijklmnopqrstuvwxyz') {
          const input = createTestKeyboardInput({
            physicalKey: `Key${char.toUpperCase()}`,
            character: char,
          });
          const classified = processor.classify(input);
          expect(classified.type).toBe('character');
          expect(classified.isPrintable).toBe(true);
        }
      });

      it('should classify uppercase letters as character', () => {
        for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
          const input = createTestKeyboardInput({
            physicalKey: `Key${char}`,
            character: char,
            modifiers: { ctrl: false, shift: true, alt: false, meta: false },
          });
          const classified = processor.classify(input);
          expect(classified.type).toBe('character');
          expect(classified.isPrintable).toBe(true);
        }
      });

      it('should classify digits as character', () => {
        for (const char of '0123456789') {
          const input = createTestKeyboardInput({
            physicalKey: `Digit${char}`,
            character: char,
          });
          const classified = processor.classify(input);
          expect(classified.type).toBe('character');
          expect(classified.isPrintable).toBe(true);
        }
      });

      it('should classify punctuation as character', () => {
        const punctuation = '!@#$%^&*()_+-=[]{}\\|;:\'",.<>/?`~';
        for (const char of punctuation) {
          const input = createTestKeyboardInput({
            physicalKey: 'Unknown',
            character: char,
          });
          const classified = processor.classify(input);
          expect(classified.type).toBe('character');
          expect(classified.isPrintable).toBe(true);
        }
      });

      it('should classify Space as action with isPrintable', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Space',
          character: ' ',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('action');
        expect(classified.isPrintable).toBe(true);
      });

      it('should classify numpad digits as character', () => {
        for (let i = 0; i <= 9; i++) {
          const input = createTestKeyboardInput({
            physicalKey: `Numpad${i}`,
            character: `${i}`,
          });
          const classified = processor.classify(input);
          expect(classified.type).toBe('character');
          expect(classified.isPrintable).toBe(true);
        }
      });

      it('should classify Mac Option+letter as character (Option produces special chars)', () => {
        // On Mac, Option+e produces a dead key accent / special character
        // This is character input, not a shortcut
        const input = createTestKeyboardInput({
          physicalKey: 'KeyE',
          character: '\u00e9', // e with acute accent
          modifiers: { ctrl: false, shift: false, alt: true, meta: false },
          platform: 'macos',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('character');
        expect(classified.isPrintable).toBe(true);
      });
    });

    // -------------------------------------------------------------------------
    // Unknown Input
    // -------------------------------------------------------------------------

    describe('unknown input', () => {
      it('should classify unrecognized multi-character keys as unknown', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Unknown',
          character: 'Unidentified',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('unknown');
      });

      it('should classify empty character as unknown', () => {
        const input = createTestKeyboardInput({
          physicalKey: 'Unknown',
          character: '',
        });
        const classified = processor.classify(input);
        expect(classified.type).toBe('unknown');
      });
    });
  });

  describe('processAndClassify()', () => {
    const processor = new KeyboardEventProcessor('windows');

    it('should combine process and classify in one step', () => {
      const event = createMockKeyboardEvent({
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
      });
      const classified = processor.processAndClassify(event);
      expect(classified.input.physicalKey).toBe('KeyC');
      expect(classified.input.character).toBe('c');
      expect(classified.input.modifiers.ctrl).toBe(true);
      expect(classified.type).toBe('shortcut');
    });
  });
});

// =============================================================================
// createTestKeyboardInput Tests
// =============================================================================

describe('createTestKeyboardInput', () => {
  it('should create input with default values', () => {
    const input = createTestKeyboardInput({});
    expect(input.physicalKey).toBe('KeyA');
    expect(input.character).toBe('a');
    expect(input.modifiers).toEqual({
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    });
    expect(input.isRepeat).toBe(false);
    expect(input.isComposing).toBe(false);
    expect(input.platform).toBe('windows');
    expect(input.originalEvent).toBeDefined();
  });

  it('should merge overrides with defaults', () => {
    const input = createTestKeyboardInput({
      physicalKey: 'KeyB',
      character: 'B',
      modifiers: { shift: true },
    });
    expect(input.physicalKey).toBe('KeyB');
    expect(input.character).toBe('B');
    expect(input.modifiers.shift).toBe(true);
    expect(input.modifiers.ctrl).toBe(false); // From defaults
  });

  it('should deep merge modifier state', () => {
    const input = createTestKeyboardInput({
      modifiers: { ctrl: true },
    });
    // Should have all modifier properties
    expect(input.modifiers).toEqual({
      ctrl: true,
      shift: false,
      alt: false,
      meta: false,
    });
  });
});

// =============================================================================
// Platform Detection Tests
// =============================================================================

describe('Platform Selection', () => {
  it('should use the provided platform', () => {
    const macProcessor = new KeyboardEventProcessor('macos');
    const linuxProcessor = new KeyboardEventProcessor('linux');
    const windowsProcessor = new KeyboardEventProcessor('windows');

    expect(macProcessor.platform).toBe('macos');
    expect(linuxProcessor.platform).toBe('linux');
    expect(windowsProcessor.platform).toBe('windows');
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  const processor = new KeyboardEventProcessor('windows');

  it('should handle events with empty code', () => {
    // Some mobile keyboards don't provide code
    const event = createMockKeyboardEvent({
      key: 'a',
      code: '',
    });
    const input = processor.process(event);
    expect(input.physicalKey).toBe('');
    expect(input.character).toBe('a');
  });

  it('should handle Dead key events', () => {
    // Dead keys produce 'Dead' as the key value
    const event = createMockKeyboardEvent({
      key: 'Dead',
      code: 'Quote',
    });
    const input = processor.process(event);
    const classified = processor.classify(input);
    // 'Dead' is not printable, not a modifier, not navigation/action
    expect(classified.type).toBe('unknown');
  });

  it('should handle Unidentified key events', () => {
    const event = createMockKeyboardEvent({
      key: 'Unidentified',
      code: 'Unknown',
    });
    const input = processor.process(event);
    const classified = processor.classify(input);
    expect(classified.type).toBe('unknown');
  });

  it('should handle combination of IME and repeat', () => {
    const event = createMockKeyboardEvent({
      key: 'Process',
      code: '',
      isComposing: true,
      repeat: true,
    });
    const input = processor.process(event);
    expect(input.isComposing).toBe(true);
    expect(input.isRepeat).toBe(true);
    // Should still classify as composition
    const classified = processor.classify(input);
    expect(classified.type).toBe('composition');
  });

  it('should handle multiple modifiers with navigation', () => {
    // Ctrl+Shift+ArrowUp is a shortcut (due to Ctrl)
    const event = createMockKeyboardEvent({
      key: 'ArrowUp',
      code: 'ArrowUp',
      ctrlKey: true,
      shiftKey: true,
    });
    const classified = processor.processAndClassify(event);
    expect(classified.type).toBe('shortcut');
  });

  it('should handle emoji input', () => {
    // Emoji character (may come from OS emoji picker)
    const input = createTestKeyboardInput({
      physicalKey: '',
      character: '\uD83D\uDE00', // Grinning face emoji (2 UTF-16 code units)
    });
    const classified = processor.classify(input);
    // Emoji is multi-byte, not a single character, so not printable
    expect(classified.type).toBe('unknown');
  });

  it('should handle control characters', () => {
    // Ctrl+A produces character code 1 (SOH)
    const input = createTestKeyboardInput({
      physicalKey: 'KeyA',
      character: '\x01', // Control character
      modifiers: { ctrl: true, shift: false, alt: false, meta: false },
    });
    const classified = processor.classify(input);
    // Has ctrl modifier, so it's a shortcut
    expect(classified.type).toBe('shortcut');
  });
});
