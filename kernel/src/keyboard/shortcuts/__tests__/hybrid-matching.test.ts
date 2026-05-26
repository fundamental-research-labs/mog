/**
 * Hybrid Matching Tests for ShortcutMatcher
 *
 * Tests the dual-index matching system that supports both:
 * - matchBy: 'key' (character-based) for mnemonic shortcuts like Ctrl+C, Ctrl+B
 * - matchBy: 'code' (physical-position-based) for positional shortcuts like arrows, F-keys
 *
 * These tests verify that keyboard shortcuts work correctly across different
 * keyboard layouts (QWERTY, AZERTY, QWERTZ, Dvorak, Colemak) by simulating
 * what the browser actually sends for each layout.
 *
 * Key insight: The browser always sends the correct `event.code` (physical position)
 * and the layout-dependent `event.key` (character output). For matchBy: 'key' shortcuts,
 * we match on the character; for matchBy: 'code', we match on the physical position.
 */

import {
  ShortcutMatcher,
  type KeyboardInput,
  type KeyboardShortcut,
  type ModifierState,
  type PhysicalKeyBinding,
  type Platform,
  type ShortcutContext,
} from '../matcher';

// =============================================================================
// Layout Simulation Data
// =============================================================================

/**
 * Maps physical key codes to the character they produce on various layouts.
 *
 * These represent what `event.key` would be for a given `event.code` on each layout.
 * Only letter keys are included since those are the ones that vary across layouts.
 */
const LAYOUT_MAPS: Record<string, Record<string, string>> = {
  qwerty: {
    KeyA: 'a',
    KeyB: 'b',
    KeyC: 'c',
    KeyD: 'd',
    KeyE: 'e',
    KeyF: 'f',
    KeyG: 'g',
    KeyH: 'h',
    KeyI: 'i',
    KeyJ: 'j',
    KeyK: 'k',
    KeyL: 'l',
    KeyM: 'm',
    KeyN: 'n',
    KeyO: 'o',
    KeyP: 'p',
    KeyQ: 'q',
    KeyR: 'r',
    KeyS: 's',
    KeyT: 't',
    KeyU: 'u',
    KeyV: 'v',
    KeyW: 'w',
    KeyX: 'x',
    KeyY: 'y',
    KeyZ: 'z',
  },
  azerty: {
    KeyA: 'q',
    KeyB: 'b',
    KeyC: 'c',
    KeyD: 'd',
    KeyE: 'e',
    KeyF: 'f',
    KeyG: 'g',
    KeyH: 'h',
    KeyI: 'i',
    KeyJ: 'j',
    KeyK: 'k',
    KeyL: 'l',
    KeyM: ',',
    KeyN: 'n',
    KeyO: 'o',
    KeyP: 'p',
    KeyQ: 'a',
    KeyR: 'r',
    KeyS: 's',
    KeyT: 't',
    KeyU: 'u',
    KeyV: 'v',
    KeyW: 'z',
    KeyX: 'x',
    KeyY: 'y',
    KeyZ: 'w',
  },
  qwertz: {
    KeyA: 'a',
    KeyB: 'b',
    KeyC: 'c',
    KeyD: 'd',
    KeyE: 'e',
    KeyF: 'f',
    KeyG: 'g',
    KeyH: 'h',
    KeyI: 'i',
    KeyJ: 'j',
    KeyK: 'k',
    KeyL: 'l',
    KeyM: 'm',
    KeyN: 'n',
    KeyO: 'o',
    KeyP: 'p',
    KeyQ: 'q',
    KeyR: 'r',
    KeyS: 's',
    KeyT: 't',
    KeyU: 'u',
    KeyV: 'v',
    KeyW: 'w',
    KeyX: 'x',
    KeyY: 'z',
    KeyZ: 'y',
  },
  dvorak: {
    KeyA: 'a',
    KeyB: 'x',
    KeyC: 'j',
    KeyD: 'e',
    KeyE: '.',
    KeyF: 'u',
    KeyG: 'i',
    KeyH: 'd',
    KeyI: 'c',
    KeyJ: 'h',
    KeyK: 't',
    KeyL: 'n',
    KeyM: 'm',
    KeyN: 'b',
    KeyO: 'r',
    KeyP: 'l',
    KeyQ: "'",
    KeyR: 'p',
    KeyS: 'o',
    KeyT: 'y',
    KeyU: 'g',
    KeyV: 'k',
    KeyW: ',',
    KeyX: 'q',
    KeyY: 'f',
    KeyZ: ';',
  },
  colemak: {
    KeyA: 'a',
    KeyB: 'b',
    KeyC: 'c',
    KeyD: 's',
    KeyE: 'f',
    KeyF: 't',
    KeyG: 'd',
    KeyH: 'h',
    KeyI: 'u',
    KeyJ: 'n',
    KeyK: 'e',
    KeyL: 'i',
    KeyM: 'm',
    KeyN: 'k',
    KeyO: 'y',
    KeyP: ';',
    KeyQ: 'q',
    KeyR: 'p',
    KeyS: 'r',
    KeyT: 'g',
    KeyU: 'l',
    KeyV: 'v',
    KeyW: 'w',
    KeyX: 'x',
    KeyY: 'j',
    KeyZ: 'z',
  },
  /**
   * Russian JCUKEN layout maps QWERTY physical positions to Cyrillic characters.
   * This represents what event.key would be WITHOUT modifier-based OS remapping.
   */
  jcuken: {
    KeyA: '\u0444',
    KeyB: '\u0438',
    KeyC: '\u0441',
    KeyD: '\u0432',
    KeyE: '\u0443',
    KeyF: '\u0430',
    KeyG: '\u043f',
    KeyH: '\u0440',
    KeyI: '\u0448',
    KeyJ: '\u043e',
    KeyK: '\u043b',
    KeyL: '\u0434',
    KeyM: '\u044c',
    KeyN: '\u0442',
    KeyO: '\u0449',
    KeyP: '\u0437',
    KeyQ: '\u0439',
    KeyR: '\u043a',
    KeyS: '\u044b',
    KeyT: '\u0435',
    KeyU: '\u0433',
    KeyV: '\u043c',
    KeyW: '\u0446',
    KeyX: '\u0447',
    KeyY: '\u043d',
    KeyZ: '\u044f',
  },
};

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Simulate keyboard input from a specific keyboard layout.
 *
 * Given a layout name and a physical key code, this produces a KeyboardInput
 * where `physicalKey` is the code and `character` is what that physical key
 * produces on the specified layout.
 *
 * This mirrors what the browser actually sends: the browser always knows the
 * physical position (event.code) and the character output (event.key).
 */
function createLayoutInput(
  layout: string,
  physicalKey: string,
  modifiers: Partial<ModifierState> = {},
  options: {
    isComposing?: boolean;
    isRepeat?: boolean;
    platform?: Platform;
  } = {},
): KeyboardInput {
  const layoutMap = LAYOUT_MAPS[layout] ?? LAYOUT_MAPS.qwerty;
  // For letter keys, use the layout map. For non-letter keys, use the physicalKey as-is.
  const character = layoutMap[physicalKey] ?? physicalKey;

  const defaultModifiers: ModifierState = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };

  return {
    physicalKey: physicalKey as KeyboardInput['physicalKey'],
    character,
    modifiers: { ...defaultModifiers, ...modifiers },
    isComposing: options.isComposing ?? false,
    isRepeat: options.isRepeat ?? false,
    platform: options.platform ?? 'windows',
    timestamp: Date.now(),
    originalEvent: {} as KeyboardEvent,
  };
}

/**
 * Create a shortcut definition for testing with matchBy support.
 */
/**
 * Map shortcut IDs to contextually appropriate action types.
 * Each test shortcut should dispatch a semantically correct action
 * rather than a universal stub.
 */
const ACTION_FOR_ID: Record<string, string> = {
  copy: 'COPY',
  'copy-special': 'COPY',
  'select-all': 'SELECT_ALL',
  undo: 'UNDO',
  redo: 'REDO',
  bold: 'TOGGLE_BOLD',
  paste: 'PASTE',
  'move-up': 'MOVE_UP',
  'move-down': 'MOVE_DOWN',
  'move-left': 'MOVE_LEFT',
  'move-right': 'MOVE_RIGHT',
  'edit-cell': 'EDIT_CELL',
  'repeat-action': 'REPEAT_LAST_ACTION',
  'insert-cells': 'INSERT_ROW_ABOVE',
  'delete-cells': 'DELETE_ROWS',
  'insert-cells-numpad': 'INSERT_ROW_ABOVE',
  'delete-cells-numpad': 'DELETE_ROWS',
  'numpad-enter': 'COMMIT_AND_MOVE_DOWN',
  'ink-pen-tool': 'SET_INK_TOOL',
  'ink-eraser-tool': 'SET_INK_TOOL',
  'ink-highlighter-tool': 'SET_INK_TOOL',
  'ink-pen': 'SET_INK_TOOL',
  'special-action': 'TOGGLE_BOLD',
  'debug-panel': 'ACTIVATE_INK_MODE',
  'ctrl-alt-q': 'SELECT_ALL',
};

function createShortcut(
  id: string,
  code: string,
  modifiers: Array<'ctrl' | 'shift' | 'alt' | 'meta'>,
  contexts: ShortcutContext[],
  options: {
    priority?: 'critical' | 'high' | 'medium' | 'low';
    enabled?: boolean;
    allowRepeat?: boolean;
    macBinding?: PhysicalKeyBinding;
    matchBy?: 'key' | 'code';
    expectedCharacter?: string;
  } = {},
): KeyboardShortcut {
  const action =
    ACTION_FOR_ID[id] ??
    (() => {
      throw new Error(`No action mapped for test shortcut id: '${id}'`);
    })();
  return {
    id,
    bindings: {
      default: {
        code: code as PhysicalKeyBinding['code'],
        modifiers,
      },
      macos: options.macBinding,
    },
    description: `Test shortcut ${id}`,
    action: action as KeyboardShortcut['action'],
    enabled: options.enabled ?? true,
    priority: options.priority ?? 'medium',
    category: 'editing',
    contexts,
    allowRepeat: options.allowRepeat,
    matchBy: options.matchBy,
    expectedCharacter: options.expectedCharacter,
    muscleMemory: 'common',
  } as KeyboardShortcut;
}

/**
 * Create a KeyboardInput with an explicit character override.
 *
 * This is useful for simulating scenarios where the OS modifies the character
 * output (e.g., Ctrl held on a Cyrillic layout causes the OS to send Latin
 * characters), or for simulating special characters produced by AltGr or
 * dead key composition.
 */
function createKeyboardInput(
  physicalKey: string,
  character: string,
  modifiers: Partial<ModifierState> = {},
  options: {
    isComposing?: boolean;
    isRepeat?: boolean;
    platform?: Platform;
  } = {},
): KeyboardInput {
  const defaultModifiers: ModifierState = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };

  return {
    physicalKey: physicalKey as KeyboardInput['physicalKey'],
    character,
    modifiers: { ...defaultModifiers, ...modifiers },
    isComposing: options.isComposing ?? false,
    isRepeat: options.isRepeat ?? false,
    platform: options.platform ?? 'windows',
    timestamp: Date.now(),
    originalEvent: {} as KeyboardEvent,
  };
}

// =============================================================================
// Test Suites
// =============================================================================

describe('Hybrid Matching System', () => {
  // ---------------------------------------------------------------------------
  // Suite 1: Character-based matching (matchBy: 'key')
  // ---------------------------------------------------------------------------
  describe('Character-based matching (matchBy: "key")', () => {
    /**
     * These shortcuts match against the character output (event.key), not the
     * physical key position. This means:
     * - On AZERTY, Ctrl+C triggers when user presses Ctrl + the key labeled "C"
     *   which is at physical position KeyC and produces character 'c'
     * - On AZERTY, Ctrl+A (select all) triggers when user presses Ctrl + the key
     *   that produces 'a', which is at physical position KeyQ on AZERTY
     */

    const characterShortcuts: KeyboardShortcut[] = [
      createShortcut('copy', 'KeyC', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'c',
        priority: 'critical',
      }),
      createShortcut('select-all', 'KeyA', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'a',
        priority: 'high',
      }),
      createShortcut('undo', 'KeyZ', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'z',
        priority: 'critical',
      }),
      createShortcut('bold', 'KeyB', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'b',
        priority: 'high',
      }),
      createShortcut('paste', 'KeyV', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'v',
        priority: 'critical',
      }),
      createShortcut('redo', 'KeyY', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'y',
        priority: 'high',
      }),
    ];

    describe('Ctrl+C (Copy) across layouts', () => {
      const layouts = ['qwerty', 'azerty', 'qwertz', 'dvorak', 'colemak'];

      it.each(layouts)('should match on %s layout', (layout) => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        // On every layout, the 'c' character is produced by KeyC
        // (C is in the same position on QWERTY, AZERTY, QWERTZ, and Colemak)
        // On Dvorak, KeyC produces 'j', and KeyI produces 'c'
        const layoutMap = LAYOUT_MAPS[layout];
        const physicalKeyForC = Object.entries(layoutMap).find(([, char]) => char === 'c')?.[0];

        expect(physicalKeyForC).toBeDefined();
        const input = createLayoutInput(layout, physicalKeyForC!, { ctrl: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('copy');
      });
    });

    describe('Ctrl+A (Select All) across layouts', () => {
      it('should match on QWERTY (KeyA produces "a")', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        const input = createLayoutInput('qwerty', 'KeyA', { ctrl: true });
        expect(input.character).toBe('a');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('select-all');
      });

      it('should match on AZERTY (KeyQ produces "a")', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        // On AZERTY, the key labeled 'A' is at physical position KeyQ
        const input = createLayoutInput('azerty', 'KeyQ', { ctrl: true });
        expect(input.character).toBe('a');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('select-all');
      });

      it('should match on Dvorak (KeyA produces "a")', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        // On Dvorak, KeyA still produces 'a'
        const input = createLayoutInput('dvorak', 'KeyA', { ctrl: true });
        expect(input.character).toBe('a');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('select-all');
      });
    });

    describe('Ctrl+Z (Undo) across layouts', () => {
      it('should match on QWERTY (KeyZ produces "z")', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        const input = createLayoutInput('qwerty', 'KeyZ', { ctrl: true });
        expect(input.character).toBe('z');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('undo');
      });

      it('should match on QWERTZ (KeyY produces "z")', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        // On QWERTZ, Z and Y are swapped. The key labeled 'Z' is at physical
        // position KeyY, and it produces character 'z'
        const input = createLayoutInput('qwertz', 'KeyY', { ctrl: true });
        expect(input.character).toBe('z');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('undo');
      });

      it('should match on AZERTY (KeyW produces "z")', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        // On AZERTY, the 'Z' key is at physical position KeyW
        const input = createLayoutInput('azerty', 'KeyW', { ctrl: true });
        expect(input.character).toBe('z');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('undo');
      });
    });

    describe('Ctrl+B (Bold) across layouts', () => {
      it.each(['qwerty', 'azerty', 'qwertz', 'colemak'])('should match on %s layout', (layout) => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        const layoutMap = LAYOUT_MAPS[layout];
        const physicalKeyForB = Object.entries(layoutMap).find(([, char]) => char === 'b')?.[0];

        expect(physicalKeyForB).toBeDefined();
        const input = createLayoutInput(layout, physicalKeyForB!, { ctrl: true });
        expect(input.character).toBe('b');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('bold');
      });
    });

    describe('Ctrl+V (Paste) across layouts', () => {
      it.each(['qwerty', 'azerty', 'qwertz', 'colemak'])('should match on %s layout', (layout) => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        const layoutMap = LAYOUT_MAPS[layout];
        const physicalKeyForV = Object.entries(layoutMap).find(([, char]) => char === 'v')?.[0];

        expect(physicalKeyForV).toBeDefined();
        const input = createLayoutInput(layout, physicalKeyForV!, { ctrl: true });
        expect(input.character).toBe('v');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('paste');
      });
    });

    describe('Ctrl+Y (Redo) on QWERTZ', () => {
      it('should match Ctrl+Y via character on QWERTZ (KeyZ produces "y")', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        // On QWERTZ, the key labeled 'Y' is at physical position KeyZ,
        // and it produces character 'y'
        const input = createLayoutInput('qwertz', 'KeyZ', { ctrl: true });
        expect(input.character).toBe('y');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('redo');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 2: Code-based matching (matchBy: 'code')
  // ---------------------------------------------------------------------------
  describe('Code-based matching (matchBy: "code")', () => {
    /**
     * These shortcuts match against the physical key position (event.code).
     * This means they work by muscle memory / physical position, regardless
     * of what character the key produces.
     */

    describe('Arrow keys work identically on ALL layouts', () => {
      const arrowShortcuts: KeyboardShortcut[] = [
        createShortcut('move-up', 'ArrowUp', [], ['grid'], {
          matchBy: 'code',
          priority: 'critical',
          allowRepeat: true,
        }),
        createShortcut('move-down', 'ArrowDown', [], ['grid'], {
          matchBy: 'code',
          priority: 'critical',
          allowRepeat: true,
        }),
        createShortcut('move-left', 'ArrowLeft', [], ['grid'], {
          matchBy: 'code',
          priority: 'critical',
          allowRepeat: true,
        }),
        createShortcut('move-right', 'ArrowRight', [], ['grid'], {
          matchBy: 'code',
          priority: 'critical',
          allowRepeat: true,
        }),
      ];

      const layouts = ['qwerty', 'azerty', 'qwertz', 'dvorak', 'colemak'];

      it.each(layouts)('should match ArrowUp on %s layout', (layout) => {
        const matcher = new ShortcutMatcher(arrowShortcuts, 'windows');
        const input = createLayoutInput(layout, 'ArrowUp');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('move-up');
      });

      it.each(layouts)('should match ArrowDown on %s layout', (layout) => {
        const matcher = new ShortcutMatcher(arrowShortcuts, 'windows');
        const input = createLayoutInput(layout, 'ArrowDown');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('move-down');
      });
    });

    describe('F-keys work identically on ALL layouts', () => {
      const fKeyShortcuts: KeyboardShortcut[] = [
        createShortcut('edit-cell', 'F2', [], ['grid'], {
          matchBy: 'code',
          priority: 'critical',
        }),
        createShortcut('repeat-action', 'F4', [], ['grid'], {
          matchBy: 'code',
          priority: 'high',
        }),
      ];

      const layouts = ['qwerty', 'azerty', 'qwertz', 'dvorak', 'colemak'];

      it.each(layouts)('should match F2 on %s layout', (layout) => {
        const matcher = new ShortcutMatcher(fKeyShortcuts, 'windows');
        const input = createLayoutInput(layout, 'F2');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('edit-cell');
      });

      it.each(layouts)('should match F4 on %s layout', (layout) => {
        const matcher = new ShortcutMatcher(fKeyShortcuts, 'windows');
        const input = createLayoutInput(layout, 'F4');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('repeat-action');
      });
    });

    describe('Ctrl+Shift+= (Insert cells) by physical position', () => {
      const insertDeleteShortcuts: KeyboardShortcut[] = [
        createShortcut('insert-cells', 'Equal', ['ctrl', 'shift'], ['grid'], {
          matchBy: 'code',
          priority: 'high',
        }),
        createShortcut('delete-cells', 'Minus', ['ctrl'], ['grid'], {
          matchBy: 'code',
          priority: 'high',
        }),
        createShortcut('insert-cells-numpad', 'NumpadAdd', ['ctrl'], ['grid'], {
          matchBy: 'code',
          priority: 'high',
        }),
        createShortcut('delete-cells-numpad', 'NumpadSubtract', ['ctrl'], ['grid'], {
          matchBy: 'code',
          priority: 'high',
        }),
      ];

      const layouts = ['qwerty', 'azerty', 'qwertz', 'dvorak', 'colemak'];

      it.each(layouts)(
        'should match Ctrl+Shift+Equal on %s layout by physical position',
        (layout) => {
          const matcher = new ShortcutMatcher(insertDeleteShortcuts, 'windows');
          // The Equal key is at the same physical position on all layouts
          const input = createLayoutInput(layout, 'Equal', {
            ctrl: true,
            shift: true,
          });
          const result = matcher.match(input, 'grid');
          expect(result).not.toBeNull();
          expect(result?.id).toBe('insert-cells');
        },
      );

      it.each(layouts)('should match Ctrl+Minus on %s layout by physical position', (layout) => {
        const matcher = new ShortcutMatcher(insertDeleteShortcuts, 'windows');
        const input = createLayoutInput(layout, 'Minus', { ctrl: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('delete-cells');
      });

      it('should match Ctrl+NumpadAdd on any layout', () => {
        const matcher = new ShortcutMatcher(insertDeleteShortcuts, 'windows');
        const input = createLayoutInput('qwerty', 'NumpadAdd', { ctrl: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('insert-cells-numpad');
      });

      it('should match Ctrl+NumpadSubtract on any layout', () => {
        const matcher = new ShortcutMatcher(insertDeleteShortcuts, 'windows');
        const input = createLayoutInput('qwerty', 'NumpadSubtract', {
          ctrl: true,
        });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('delete-cells-numpad');
      });
    });

    describe('Numpad shortcuts work by physical position', () => {
      const numpadShortcuts: KeyboardShortcut[] = [
        createShortcut('numpad-enter', 'NumpadEnter', [], ['editing'], {
          matchBy: 'code',
          priority: 'high',
        }),
      ];

      it.each(['qwerty', 'azerty', 'qwertz', 'dvorak'])(
        'should match NumpadEnter on %s layout',
        (layout) => {
          const matcher = new ShortcutMatcher(numpadShortcuts, 'windows');
          const input = createLayoutInput(layout, 'NumpadEnter');
          const result = matcher.match(input, 'enterMode');
          expect(result).not.toBeNull();
          expect(result?.id).toBe('numpad-enter');
        },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Edge Cases
  // ---------------------------------------------------------------------------
  describe('Edge cases', () => {
    describe('IME composition blocks ALL shortcuts on all layouts', () => {
      const shortcuts: KeyboardShortcut[] = [
        createShortcut('copy', 'KeyC', ['ctrl'], ['any'], {
          matchBy: 'key',
          expectedCharacter: 'c',
          priority: 'critical',
        }),
        createShortcut('move-up', 'ArrowUp', [], ['grid'], {
          matchBy: 'code',
          priority: 'critical',
        }),
        createShortcut('edit-cell', 'F2', [], ['grid'], {
          matchBy: 'code',
          priority: 'critical',
        }),
      ];

      const layouts = ['qwerty', 'azerty', 'qwertz', 'dvorak', 'colemak'];

      it.each(layouts)('should block character-based shortcuts during IME on %s', (layout) => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        const layoutMap = LAYOUT_MAPS[layout];
        const physicalKeyForC = Object.entries(layoutMap).find(([, char]) => char === 'c')?.[0];
        const input = createLayoutInput(
          layout,
          physicalKeyForC!,
          { ctrl: true },
          { isComposing: true },
        );
        expect(matcher.match(input, 'grid')).toBeNull();
      });

      it.each(layouts)('should block code-based shortcuts during IME on %s', (layout) => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        const arrowInput = createLayoutInput(layout, 'ArrowUp', {}, { isComposing: true });
        expect(matcher.match(arrowInput, 'grid')).toBeNull();

        const f2Input = createLayoutInput(layout, 'F2', {}, { isComposing: true });
        expect(matcher.match(f2Input, 'grid')).toBeNull();
      });
    });

    describe('Bare letter keys in drawing context match by code (positional)', () => {
      const drawingShortcuts: KeyboardShortcut[] = [
        createShortcut('ink-pen-tool', 'KeyP', [], ['drawing'], {
          matchBy: 'code',
          priority: 'high',
        }),
        createShortcut('ink-eraser-tool', 'KeyE', [], ['drawing'], {
          matchBy: 'code',
          priority: 'high',
        }),
        createShortcut('ink-highlighter-tool', 'KeyH', [], ['drawing'], {
          matchBy: 'code',
          priority: 'high',
        }),
      ];

      it('should match pen tool by physical position KeyP on QWERTY', () => {
        const matcher = new ShortcutMatcher(drawingShortcuts, 'windows');
        const input = createLayoutInput('qwerty', 'KeyP');
        expect(input.character).toBe('p');
        const result = matcher.match(input, 'drawing');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('ink-pen-tool');
      });

      it('should match pen tool by physical position KeyP on AZERTY (produces "p")', () => {
        const matcher = new ShortcutMatcher(drawingShortcuts, 'windows');
        // On AZERTY, KeyP still produces 'p' (it's in the same position)
        const input = createLayoutInput('azerty', 'KeyP');
        const result = matcher.match(input, 'drawing');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('ink-pen-tool');
      });

      it('should match pen tool by physical position KeyP on Dvorak (produces "l")', () => {
        const matcher = new ShortcutMatcher(drawingShortcuts, 'windows');
        // On Dvorak, KeyP produces 'l', but the shortcut matches by code
        const input = createLayoutInput('dvorak', 'KeyP');
        expect(input.character).toBe('l');
        const result = matcher.match(input, 'drawing');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('ink-pen-tool');
      });

      it('should match eraser by physical position KeyE on Colemak (produces "f")', () => {
        const matcher = new ShortcutMatcher(drawingShortcuts, 'windows');
        const input = createLayoutInput('colemak', 'KeyE');
        expect(input.character).toBe('f');
        const result = matcher.match(input, 'drawing');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('ink-eraser-tool');
      });
    });

    describe('Shift+letter does NOT trigger command shortcuts', () => {
      const shortcuts: KeyboardShortcut[] = [
        createShortcut('bold', 'KeyB', ['ctrl'], ['any'], {
          matchBy: 'key',
          expectedCharacter: 'b',
          priority: 'high',
        }),
        createShortcut('copy', 'KeyC', ['ctrl'], ['any'], {
          matchBy: 'key',
          expectedCharacter: 'c',
          priority: 'critical',
        }),
      ];

      it('should NOT match Shift+B (no ctrl modifier)', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        const input = createLayoutInput('qwerty', 'KeyB', { shift: true });
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('should NOT match Shift+C (no ctrl modifier)', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        const input = createLayoutInput('qwerty', 'KeyC', { shift: true });
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('should match Ctrl+Shift+C if there is a Ctrl+Shift+C shortcut', () => {
        const shortcutsWithShift: KeyboardShortcut[] = [
          createShortcut('copy-special', 'KeyC', ['ctrl', 'shift'], ['grid'], {
            matchBy: 'key',
            expectedCharacter: 'c',
            priority: 'high',
          }),
        ];
        const matcher = new ShortcutMatcher(shortcutsWithShift, 'windows');
        const input = createLayoutInput('qwerty', 'KeyC', {
          ctrl: true,
          shift: true,
        });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('copy-special');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 4: No false positives on non-QWERTY layouts
  // ---------------------------------------------------------------------------
  describe('No false positives on non-QWERTY layouts', () => {
    const shortcuts: KeyboardShortcut[] = [
      createShortcut('undo', 'KeyZ', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'z',
        priority: 'critical',
      }),
      createShortcut('redo', 'KeyY', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'y',
        priority: 'high',
      }),
    ];

    describe('QWERTZ layout: Z and Y are swapped', () => {
      it('pressing physical KeyZ (labeled "Y") with Ctrl should match Redo, not Undo', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // On QWERTZ: physical KeyZ produces character 'y'
        const input = createLayoutInput('qwertz', 'KeyZ', { ctrl: true });
        expect(input.character).toBe('y');
        const result = matcher.match(input, 'grid');
        // Should match Redo (expectedCharacter: 'y'), NOT Undo
        expect(result).not.toBeNull();
        expect(result?.id).toBe('redo');
      });

      it('pressing physical KeyY (labeled "Z") with Ctrl should match Undo, not Redo', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // On QWERTZ: physical KeyY produces character 'z'
        const input = createLayoutInput('qwertz', 'KeyY', { ctrl: true });
        expect(input.character).toBe('z');
        const result = matcher.match(input, 'grid');
        // Should match Undo (expectedCharacter: 'z'), NOT Redo
        expect(result).not.toBeNull();
        expect(result?.id).toBe('undo');
      });
    });

    describe('AZERTY layout: key positions differ significantly', () => {
      it('pressing physical KeyQ (labeled "A") with Ctrl should match Select All', () => {
        const shortcutsWithSelectAll: KeyboardShortcut[] = [
          ...shortcuts,
          createShortcut('select-all', 'KeyA', ['ctrl'], ['any'], {
            matchBy: 'key',
            expectedCharacter: 'a',
            priority: 'high',
          }),
        ];
        const matcher = new ShortcutMatcher(shortcutsWithSelectAll, 'windows');
        // On AZERTY: physical KeyQ produces character 'a'
        const input = createLayoutInput('azerty', 'KeyQ', { ctrl: true });
        expect(input.character).toBe('a');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('select-all');
      });

      it('pressing physical KeyA (labeled "Q") with Ctrl should NOT match Select All', () => {
        const shortcutsWithSelectAll: KeyboardShortcut[] = [
          ...shortcuts,
          createShortcut('select-all', 'KeyA', ['ctrl'], ['any'], {
            matchBy: 'key',
            expectedCharacter: 'a',
            priority: 'high',
          }),
        ];
        const matcher = new ShortcutMatcher(shortcutsWithSelectAll, 'windows');
        // On AZERTY: physical KeyA produces character 'q', not 'a'
        const input = createLayoutInput('azerty', 'KeyA', { ctrl: true });
        expect(input.character).toBe('q');
        const result = matcher.match(input, 'grid');
        // Should NOT match Select All because character is 'q', not 'a'
        // (unless there happens to be a Ctrl+Q shortcut)
        if (result) {
          expect(result.id).not.toBe('select-all');
        }
      });

      it('pressing physical KeyW (labeled "Z") with Ctrl should match Undo', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // On AZERTY: physical KeyW produces character 'z'
        const input = createLayoutInput('azerty', 'KeyW', { ctrl: true });
        expect(input.character).toBe('z');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('undo');
      });
    });

    describe('Dvorak layout: extensive key rearrangement', () => {
      it('pressing physical KeyZ (produces ";") with Ctrl should NOT match Undo', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // On Dvorak: physical KeyZ produces character ';'
        const input = createLayoutInput('dvorak', 'KeyZ', { ctrl: true });
        expect(input.character).toBe(';');
        const result = matcher.match(input, 'grid');
        // ';' does not match any shortcut's expectedCharacter
        expect(result).toBeNull();
      });

      it('Ctrl+Z intent on Dvorak: user must find the key that produces "z"', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // On Dvorak, the Slash key produces 'z'... actually let's check the map
        // Dvorak KeyZ produces ';', but where is 'z'?
        // Looking at full Dvorak layout, the semicolon key (Semicolon code) may produce 'z'
        // but our simplified map only covers KeyA-KeyZ
        // In a real Dvorak layout, there may not be a Key[A-Z] that produces 'z'
        // because 'z' might be on a punctuation key position
        // For this test, let's just verify that the wrong physical key does NOT match
        const input = createLayoutInput('dvorak', 'KeyZ', { ctrl: true });
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 5: Mixed matchBy shortcuts coexist correctly
  // ---------------------------------------------------------------------------
  describe('Mixed matchBy shortcuts coexist', () => {
    const mixedShortcuts: KeyboardShortcut[] = [
      // Character-based
      createShortcut('copy', 'KeyC', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'c',
        priority: 'critical',
      }),
      createShortcut('bold', 'KeyB', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'b',
        priority: 'high',
      }),
      // Code-based
      createShortcut('move-up', 'ArrowUp', [], ['grid'], {
        matchBy: 'code',
        priority: 'critical',
        allowRepeat: true,
      }),
      createShortcut('edit-cell', 'F2', [], ['grid'], {
        matchBy: 'code',
        priority: 'critical',
      }),
      createShortcut('insert-cells', 'Equal', ['ctrl', 'shift'], ['grid'], {
        matchBy: 'code',
        priority: 'high',
      }),
      // Drawing tool (bare letter, code-based)
      createShortcut('ink-pen', 'KeyP', [], ['drawing'], {
        matchBy: 'code',
        priority: 'high',
      }),
    ];

    it('should match character-based shortcuts in grid context', () => {
      const matcher = new ShortcutMatcher(mixedShortcuts, 'windows');
      const input = createLayoutInput('qwerty', 'KeyC', { ctrl: true });
      const result = matcher.match(input, 'grid');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('copy');
    });

    it('should match code-based shortcuts in grid context', () => {
      const matcher = new ShortcutMatcher(mixedShortcuts, 'windows');
      const input = createLayoutInput('qwerty', 'ArrowUp');
      const result = matcher.match(input, 'grid');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('move-up');
    });

    it('should match code-based shortcuts in drawing context', () => {
      const matcher = new ShortcutMatcher(mixedShortcuts, 'windows');
      const input = createLayoutInput('qwerty', 'KeyP');
      const result = matcher.match(input, 'drawing');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('ink-pen');
    });

    it('should NOT match drawing shortcuts in grid context', () => {
      const matcher = new ShortcutMatcher(mixedShortcuts, 'windows');
      const input = createLayoutInput('qwerty', 'KeyP');
      const result = matcher.match(input, 'grid');
      // Bare 'P' without modifiers in grid context should not match anything
      expect(result).toBeNull();
    });

    it('character-based and code-based shortcuts do not interfere on AZERTY', () => {
      const matcher = new ShortcutMatcher(mixedShortcuts, 'windows');

      // Ctrl+C (character-based) still works on AZERTY
      const copyInput = createLayoutInput('azerty', 'KeyC', { ctrl: true });
      expect(copyInput.character).toBe('c');
      expect(matcher.match(copyInput, 'grid')?.id).toBe('copy');

      // ArrowUp (code-based) still works on AZERTY
      const arrowInput = createLayoutInput('azerty', 'ArrowUp');
      expect(matcher.match(arrowInput, 'grid')?.id).toBe('move-up');

      // Ctrl+Shift+= (code-based) still works on AZERTY
      const insertInput = createLayoutInput('azerty', 'Equal', {
        ctrl: true,
        shift: true,
      });
      expect(matcher.match(insertInput, 'grid')?.id).toBe('insert-cells');
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 6: Platform-specific with hybrid matching
  // ---------------------------------------------------------------------------
  describe('Platform-specific with hybrid matching', () => {
    it('should match Cmd+C on Mac for character-based copy shortcut', () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: 'copy',
          bindings: {
            default: { code: 'KeyC', modifiers: ['ctrl'] },
            macos: { code: 'KeyC', modifiers: ['meta'] },
          },
          description: 'Copy',
          action: 'COPY',
          enabled: true,
          priority: 'critical',
          category: 'clipboard',
          contexts: ['any'],
          matchBy: 'key',
          expectedCharacter: 'c',
          muscleMemory: 'common',
        } as KeyboardShortcut,
      ];

      const matcher = new ShortcutMatcher(shortcuts, 'macos');
      const input = createLayoutInput('qwerty', 'KeyC', { meta: true }, { platform: 'macos' });
      const result = matcher.match(input, 'grid');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('copy');
    });

    it('should NOT match Ctrl+C on Mac when Mac uses Cmd', () => {
      const shortcuts: KeyboardShortcut[] = [
        {
          id: 'copy',
          bindings: {
            default: { code: 'KeyC', modifiers: ['ctrl'] },
            macos: { code: 'KeyC', modifiers: ['meta'] },
          },
          description: 'Copy',
          action: 'COPY',
          enabled: true,
          priority: 'critical',
          category: 'clipboard',
          contexts: ['any'],
          matchBy: 'key',
          expectedCharacter: 'c',
          muscleMemory: 'common',
        } as KeyboardShortcut,
      ];

      const matcher = new ShortcutMatcher(shortcuts, 'macos');
      const input = createLayoutInput('qwerty', 'KeyC', { ctrl: true }, { platform: 'macos' });
      const result = matcher.match(input, 'grid');
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 7: JCUKEN (Russian Cyrillic) Layout
  // ---------------------------------------------------------------------------
  describe('JCUKEN (Russian Cyrillic) layout', () => {
    /**
     * The Russian JCUKEN layout maps physical QWERTY key positions to Cyrillic
     * characters. For example:
     * - KeyA -> 'ф', KeyC -> 'с', KeyV -> 'м', KeyZ -> 'я'
     *
     * Key behavior: On most OSes (Windows, macOS, Linux), when Ctrl (or Cmd)
     * is held, the OS remaps the character back to the Latin equivalent. So
     * Ctrl+KeyC sends event.key = 'c' even on JCUKEN. However, some OS
     * configurations or IME setups may NOT remap, sending the Cyrillic character.
     *
     * We test both scenarios to ensure robustness.
     */

    const characterShortcuts: KeyboardShortcut[] = [
      createShortcut('copy', 'KeyC', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'c',
        priority: 'critical',
      }),
      createShortcut('paste', 'KeyV', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'v',
        priority: 'critical',
      }),
      createShortcut('select-all', 'KeyA', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'a',
        priority: 'high',
      }),
      createShortcut('undo', 'KeyZ', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'z',
        priority: 'critical',
      }),
      createShortcut('bold', 'KeyB', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'b',
        priority: 'high',
      }),
    ];

    const codeShortcuts: KeyboardShortcut[] = [
      createShortcut('move-up', 'ArrowUp', [], ['grid'], {
        matchBy: 'code',
        priority: 'critical',
        allowRepeat: true,
      }),
      createShortcut('edit-cell', 'F2', [], ['grid'], {
        matchBy: 'code',
        priority: 'critical',
      }),
      createShortcut('insert-cells', 'Equal', ['ctrl', 'shift'], ['grid'], {
        matchBy: 'code',
        priority: 'high',
      }),
    ];

    describe('OS remaps Cyrillic to Latin when Ctrl is held (common behavior)', () => {
      /**
       * On most OSes, when the user presses Ctrl+KeyC on a JCUKEN layout,
       * the OS sends event.key = 'c' (Latin), not 'с' (Cyrillic).
       * The physical key code is still 'KeyC'.
       */

      it('Ctrl+C: OS sends key="c" even on JCUKEN, should match Copy', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        // OS remaps: physicalKey=KeyC, character='c' (Latin, not Cyrillic 'с')
        const input = createKeyboardInput('KeyC', 'c', { ctrl: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('copy');
      });

      it('Ctrl+V: OS sends key="v" even on JCUKEN, should match Paste', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        const input = createKeyboardInput('KeyV', 'v', { ctrl: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('paste');
      });

      it('Ctrl+A: OS sends key="a" even on JCUKEN, should match Select All', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        const input = createKeyboardInput('KeyA', 'a', { ctrl: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('select-all');
      });

      it('Ctrl+Z: OS sends key="z" even on JCUKEN, should match Undo', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        const input = createKeyboardInput('KeyZ', 'z', { ctrl: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('undo');
      });

      it('Ctrl+B: OS sends key="b" even on JCUKEN, should match Bold', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        const input = createKeyboardInput('KeyB', 'b', { ctrl: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('bold');
      });
    });

    describe('OS does NOT remap (sends Cyrillic characters with Ctrl)', () => {
      /**
       * NOTE: This is a KNOWN LIMITATION, not ideal behavior.
       *
       * On Linux systems (and some other OS configurations) where the OS does
       * not remap Cyrillic to Latin when Ctrl is held, the browser sends
       * event.key as the Cyrillic character (e.g., 'с' instead of 'c').
       * Character-based shortcuts (matchBy: 'key') will NOT match because
       * 'с' (U+0441) !== 'c' (U+0063).
       *
       * This means ALL Ctrl+letter shortcuts (copy, paste, undo, bold, etc.)
       * will not match via character-based lookup on these systems. The
       * code-based fallback also won't help because these shortcuts have
       * matchBy:'key'.
       *
       * A full solution would require a reverse lookup from physical key code
       * to the QWERTY character (as VS Code and Chrome DevTools implement).
       * This is tracked as a future enhancement.
       *
       * For now, these tests document the current behavior: shortcuts don't
       * match when the OS sends Cyrillic characters with Ctrl.
       */

      it('Ctrl+KeyC with Cyrillic "с" should NOT match Copy (matchBy: "key")', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        // OS does NOT remap: physicalKey=KeyC, character='с' (Cyrillic)
        const input = createLayoutInput('jcuken', 'KeyC', { ctrl: true });
        expect(input.character).toBe('\u0441'); // Cyrillic 'с'
        const result = matcher.match(input, 'grid');
        // NOTE: This is a KNOWN LIMITATION. The shortcut doesn't match because
        // Cyrillic 'с' (U+0441) !== Latin 'c' (U+0063). On systems that don't
        // remap, users lose access to all Ctrl+letter shortcuts while on the
        // Cyrillic layout. A code-to-character reverse lookup would fix this.
        expect(result).toBeNull();
      });

      it('Ctrl+KeyV with Cyrillic "м" should NOT match Paste (matchBy: "key")', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        const input = createLayoutInput('jcuken', 'KeyV', { ctrl: true });
        expect(input.character).toBe('\u043c'); // Cyrillic 'м'
        const result = matcher.match(input, 'grid');
        // NOTE: Known limitation — same issue as Ctrl+C above.
        // Cyrillic 'м' (U+043C) !== Latin 'v' (U+0076).
        expect(result).toBeNull();
      });

      it('Ctrl+KeyA with Cyrillic "ф" should NOT match Select All (matchBy: "key")', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        const input = createLayoutInput('jcuken', 'KeyA', { ctrl: true });
        expect(input.character).toBe('\u0444'); // Cyrillic 'ф'
        const result = matcher.match(input, 'grid');
        // NOTE: Known limitation — same issue as Ctrl+C above.
        // Cyrillic 'ф' (U+0444) !== Latin 'a' (U+0061).
        expect(result).toBeNull();
      });

      it('Ctrl+KeyZ with Cyrillic "я" should NOT match Undo (matchBy: "key")', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        const input = createLayoutInput('jcuken', 'KeyZ', { ctrl: true });
        expect(input.character).toBe('\u044f'); // Cyrillic 'я'
        const result = matcher.match(input, 'grid');
        // NOTE: Known limitation — same issue as Ctrl+C above.
        // Cyrillic 'я' (U+044F) !== Latin 'z' (U+007A).
        expect(result).toBeNull();
      });
    });

    describe('Code-based shortcuts work regardless of JCUKEN layout', () => {
      /**
       * matchBy: 'code' shortcuts match on physical key position,
       * so they work identically regardless of whether the layout is
       * JCUKEN, QWERTY, or anything else.
       */

      it('ArrowUp works on JCUKEN layout', () => {
        const matcher = new ShortcutMatcher(codeShortcuts, 'windows');
        const input = createLayoutInput('jcuken', 'ArrowUp');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('move-up');
      });

      it('F2 works on JCUKEN layout', () => {
        const matcher = new ShortcutMatcher(codeShortcuts, 'windows');
        const input = createLayoutInput('jcuken', 'F2');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('edit-cell');
      });

      it('Ctrl+Shift+Equal works on JCUKEN layout', () => {
        const matcher = new ShortcutMatcher(codeShortcuts, 'windows');
        const input = createLayoutInput('jcuken', 'Equal', {
          ctrl: true,
          shift: true,
        });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('insert-cells');
      });
    });

    describe('Mixed character and code shortcuts with JCUKEN', () => {
      const mixedShortcuts: KeyboardShortcut[] = [...characterShortcuts, ...codeShortcuts];

      it('code-based shortcuts work even when character-based ones fail (no OS remap)', () => {
        const matcher = new ShortcutMatcher(mixedShortcuts, 'windows');

        // Character-based Ctrl+C fails because Cyrillic 'с' !== Latin 'c'
        const ctrlC = createLayoutInput('jcuken', 'KeyC', { ctrl: true });
        expect(matcher.match(ctrlC, 'grid')).toBeNull();

        // Code-based ArrowUp still works fine
        const arrowUp = createLayoutInput('jcuken', 'ArrowUp');
        expect(matcher.match(arrowUp, 'grid')?.id).toBe('move-up');

        // Code-based F2 still works fine
        const f2 = createLayoutInput('jcuken', 'F2');
        expect(matcher.match(f2, 'grid')?.id).toBe('edit-cell');
      });

      it('both types work when OS remaps Cyrillic to Latin with Ctrl', () => {
        const matcher = new ShortcutMatcher(mixedShortcuts, 'windows');

        // Character-based Ctrl+C works because OS sends Latin 'c'
        const ctrlC = createKeyboardInput('KeyC', 'c', { ctrl: true });
        expect(matcher.match(ctrlC, 'grid')?.id).toBe('copy');

        // Code-based ArrowUp still works
        const arrowUp = createLayoutInput('jcuken', 'ArrowUp');
        expect(matcher.match(arrowUp, 'grid')?.id).toBe('move-up');
      });
    });

    describe('IME composition blocks shortcuts on JCUKEN layout', () => {
      it('should block character-based shortcuts during IME on JCUKEN', () => {
        const matcher = new ShortcutMatcher(characterShortcuts, 'windows');
        const input = createKeyboardInput('KeyC', 'c', { ctrl: true }, { isComposing: true });
        expect(matcher.match(input, 'grid')).toBeNull();
      });

      it('should block code-based shortcuts during IME on JCUKEN', () => {
        const matcher = new ShortcutMatcher(codeShortcuts, 'windows');
        const input = createLayoutInput('jcuken', 'ArrowUp', {}, { isComposing: true });
        expect(matcher.match(input, 'grid')).toBeNull();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 8: AltGr (Right Alt) Key Handling
  // ---------------------------------------------------------------------------
  describe('AltGr (Right Alt) key handling', () => {
    /**
     * AltGr (Right Alt) on European keyboards produces special characters.
     * In browser keyboard events, AltGr is represented as Ctrl+Alt both being
     * pressed simultaneously (ctrlKey=true, altKey=true).
     *
     * This creates a potential conflict: AltGr keypresses look like Ctrl+Alt
     * to the browser. We must ensure:
     * 1. AltGr character input does NOT accidentally trigger Ctrl+Alt shortcuts
     * 2. Legitimate Ctrl+Alt shortcuts still work when intentionally pressed
     *
     * Examples:
     * - German: AltGr+Q -> '@', AltGr+7 -> '{', AltGr+0 -> '}'
     * - French: AltGr+0 -> '@', AltGr+3 -> '#'
     */

    const ctrlAltShortcuts: KeyboardShortcut[] = [
      // A legitimate Ctrl+Alt+D shortcut (matchBy: 'key')
      createShortcut('special-action', 'KeyD', ['ctrl', 'alt'], ['grid'], {
        matchBy: 'key',
        expectedCharacter: 'd',
        priority: 'high',
      }),
      // A legitimate Ctrl+Alt+F2 shortcut (matchBy: 'code')
      createShortcut('debug-panel', 'F2', ['ctrl', 'alt'], ['grid'], {
        matchBy: 'code',
        priority: 'high',
      }),
      // Regular Ctrl+C copy shortcut
      createShortcut('copy', 'KeyC', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'c',
        priority: 'critical',
      }),
    ];

    describe('AltGr character input should NOT trigger Ctrl+Alt shortcuts', () => {
      it('German AltGr+Q producing "@" should NOT match Ctrl+Alt+Q shortcut', () => {
        const shortcuts: KeyboardShortcut[] = [
          createShortcut('ctrl-alt-q', 'KeyQ', ['ctrl', 'alt'], ['grid'], {
            matchBy: 'key',
            expectedCharacter: 'q',
            priority: 'high',
          }),
        ];
        const matcher = new ShortcutMatcher(shortcuts, 'windows');

        // AltGr+Q on German keyboard: physicalKey=KeyQ, character='@'
        // Browser sends ctrlKey=true, altKey=true (AltGr representation)
        const input = createKeyboardInput('KeyQ', '@', { ctrl: true, alt: true });
        const result = matcher.match(input, 'grid');
        // Should NOT match because character '@' !== 'q'
        expect(result).toBeNull();
      });

      it('German AltGr+7 producing "{" should NOT match any Ctrl+Alt shortcut', () => {
        const matcher = new ShortcutMatcher(ctrlAltShortcuts, 'windows');

        // AltGr+7 on German keyboard: physicalKey=Digit7, character='{'
        const input = createKeyboardInput('Digit7', '{', { ctrl: true, alt: true });
        const result = matcher.match(input, 'grid');
        // No shortcut matches Ctrl+Alt+Digit7 producing '{'
        expect(result).toBeNull();
      });

      it('German AltGr+0 producing "}" should NOT match any Ctrl+Alt shortcut', () => {
        const matcher = new ShortcutMatcher(ctrlAltShortcuts, 'windows');

        // AltGr+0 on German keyboard: physicalKey=Digit0, character='}'
        const input = createKeyboardInput('Digit0', '}', { ctrl: true, alt: true });
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('French AltGr+0 producing "@" should NOT match any Ctrl+Alt shortcut', () => {
        const matcher = new ShortcutMatcher(ctrlAltShortcuts, 'windows');

        // AltGr+0 on French keyboard: physicalKey=Digit0, character='@'
        const input = createKeyboardInput('Digit0', '@', { ctrl: true, alt: true });
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('French AltGr+3 producing "#" should NOT match any Ctrl+Alt shortcut', () => {
        const matcher = new ShortcutMatcher(ctrlAltShortcuts, 'windows');

        // AltGr+3 on French keyboard: physicalKey=Digit3, character='#'
        const input = createKeyboardInput('Digit3', '#', { ctrl: true, alt: true });
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('AltGr+E producing "€" should NOT match any Ctrl+Alt shortcut', () => {
        const matcher = new ShortcutMatcher(ctrlAltShortcuts, 'windows');

        // AltGr+E on many European layouts: physicalKey=KeyE, character='€'
        const input = createKeyboardInput('KeyE', '\u20ac', { ctrl: true, alt: true });
        const result = matcher.match(input, 'grid');
        // Should NOT match because character '€' !== any expectedCharacter
        expect(result).toBeNull();
      });
    });

    describe('Legitimate Ctrl+Alt shortcuts should still work', () => {
      it('Ctrl+Alt+D with character "d" should match special-action', () => {
        const matcher = new ShortcutMatcher(ctrlAltShortcuts, 'windows');

        // User intentionally presses Ctrl+Alt+D (left Ctrl + left Alt + D)
        // OS sends character 'd'
        const input = createKeyboardInput('KeyD', 'd', { ctrl: true, alt: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('special-action');
      });

      it('Ctrl+Alt+F2 should match debug-panel (code-based)', () => {
        const matcher = new ShortcutMatcher(ctrlAltShortcuts, 'windows');

        // Ctrl+Alt+F2 is code-based, works regardless of character
        const input = createKeyboardInput('F2', 'F2', { ctrl: true, alt: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('debug-panel');
      });
    });

    describe('Regular shortcuts are not affected by AltGr presence', () => {
      it('Regular Ctrl+C (without Alt) still matches Copy', () => {
        const matcher = new ShortcutMatcher(ctrlAltShortcuts, 'windows');

        // Regular Ctrl+C, no AltGr involved
        const input = createKeyboardInput('KeyC', 'c', { ctrl: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('copy');
      });

      it('Ctrl+Alt+C does NOT match Ctrl+C (extra modifier prevents match)', () => {
        const matcher = new ShortcutMatcher(ctrlAltShortcuts, 'windows');

        // Ctrl+Alt+C has extra Alt modifier, should NOT match Ctrl+C
        const input = createKeyboardInput('KeyC', 'c', { ctrl: true, alt: true });
        const result = matcher.match(input, 'grid');
        // Exact modifier matching: Ctrl+Alt !== Ctrl
        expect(result).toBeNull();
      });
    });

    describe('Code-based Ctrl+Alt shortcuts and AltGr false positives', () => {
      /**
       * Code-based shortcuts that use Ctrl+Alt modifiers are vulnerable to
       * AltGr false positives because browsers represent AltGr as Ctrl+Alt.
       * For code-based matching, the character is ignored — only the physical
       * key and modifiers matter. This means a code-based Ctrl+Alt+KeyQ
       * shortcut WILL match when the user presses AltGr+Q (producing '@'
       * on German keyboards), because the browser sends the same modifier
       * flags and the same physical key code.
       *
       * This is a known limitation that cannot be fully resolved in the
       * browser: there is no reliable way to distinguish "left Ctrl + left Alt"
       * from "AltGr" in keyboard events. The mitigation is to AVOID registering
       * code-based Ctrl+Alt shortcuts on letter/digit keys that are AltGr
       * targets on common European layouts (e.g., Q, E, 2, 3, 7, 8, 9, 0
       * on German QWERTZ; 0, 2, 3, 4, 5 on French AZERTY).
       */

      it('Code-based Ctrl+Alt+KeyQ shortcut should match when user intentionally presses Ctrl+Alt+Q', () => {
        const shortcuts: KeyboardShortcut[] = [
          createShortcut('special-action', 'KeyQ', ['ctrl', 'alt'], ['grid'], {
            matchBy: 'code',
            priority: 'high',
          }),
        ];
        const matcher = new ShortcutMatcher(shortcuts, 'windows');

        // User intentionally presses Ctrl+Alt+Q: physicalKey=KeyQ, character='q'
        const input = createKeyboardInput('KeyQ', 'q', { ctrl: true, alt: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('special-action');
      });

      it('AltGr+Q (producing @) has same modifiers as Ctrl+Alt+Q — KNOWN LIMITATION', () => {
        // KNOWN LIMITATION: Browsers cannot distinguish AltGr from Ctrl+Alt
        // for code-based matching. AltGr+Q on a German keyboard sends:
        //   event.code = 'KeyQ', event.key = '@', ctrlKey = true, altKey = true
        // A code-based Ctrl+Alt+KeyQ shortcut matches on code + modifiers only,
        // so it will fire even though the user intended to type '@'.
        //
        // The mitigation is to avoid registering code-based Ctrl+Alt shortcuts
        // on letter/digit keys that are AltGr targets on common European layouts.
        const shortcuts: KeyboardShortcut[] = [
          createShortcut('special-action', 'KeyQ', ['ctrl', 'alt'], ['grid'], {
            matchBy: 'code',
            priority: 'high',
          }),
        ];
        const matcher = new ShortcutMatcher(shortcuts, 'windows');

        // AltGr+Q on German keyboard: physicalKey=KeyQ, character='@',
        // but browser reports ctrl=true, alt=true (same as Ctrl+Alt)
        const input = createKeyboardInput('KeyQ', '@', { ctrl: true, alt: true });
        const result = matcher.match(input, 'grid');
        // Unfortunately, this MATCHES — it's a false positive for code-based shortcuts.
        // The character '@' is irrelevant because code-based matching ignores characters.
        expect(result).not.toBeNull();
        expect(result?.id).toBe('special-action');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 9: Dead Key Handling
  // ---------------------------------------------------------------------------
  describe('Dead key handling', () => {
    /**
     * Dead keys produce no immediate character output. Instead, they modify the
     * next keypress to produce an accented character. For example:
     * - French AZERTY: pressing ^ (dead key) then 'e' -> 'ê'
     * - German: pressing ¨ (dead key, Shift+Tilde position) then 'u' -> 'ü'
     * - Spanish: pressing ´ (dead key) then 'a' -> 'á'
     *
     * Dead key events have event.key = 'Dead' and should never match any shortcut.
     * The subsequent combined character should also not accidentally trigger shortcuts
     * (since accented characters like 'ê', 'ü', 'á' don't match any Latin letters).
     */

    const shortcuts: KeyboardShortcut[] = [
      createShortcut('copy', 'KeyC', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'c',
        priority: 'critical',
      }),
      createShortcut('select-all', 'KeyA', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'a',
        priority: 'high',
      }),
      createShortcut('undo', 'KeyZ', ['ctrl'], ['any'], {
        matchBy: 'key',
        expectedCharacter: 'z',
        priority: 'critical',
      }),
      createShortcut('edit-cell', 'F2', [], ['grid'], {
        matchBy: 'code',
        priority: 'critical',
      }),
      createShortcut('move-up', 'ArrowUp', [], ['grid'], {
        matchBy: 'code',
        priority: 'critical',
        allowRepeat: true,
      }),
    ];

    describe('Dead key events (event.key = "Dead") should not match shortcuts', () => {
      it('dead key ^ on French AZERTY should not match any shortcut', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // Dead key press: event.key = 'Dead', physical key varies by layout
        // On French AZERTY, ^ is at BracketLeft position
        const input = createKeyboardInput('BracketLeft', 'Dead');
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('dead key ¨ (diaeresis) on German layout should not match any shortcut', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // On German layout, ¨ is produced by pressing the key at BracketRight
        const input = createKeyboardInput('BracketRight', 'Dead');
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('dead key ´ (acute accent) on Spanish layout should not match any shortcut', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // On Spanish layout, ´ is at Quote position
        const input = createKeyboardInput('Quote', 'Dead');
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('dead key ~ (tilde) should not match any shortcut', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        const input = createKeyboardInput('Backquote', 'Dead');
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('Ctrl + dead key should not match any shortcut', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // Even with Ctrl held, a dead key sends 'Dead' as the character
        const input = createKeyboardInput('BracketLeft', 'Dead', { ctrl: true });
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('Shift + dead key should not match any shortcut', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        const input = createKeyboardInput('BracketLeft', 'Dead', { shift: true });
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });
    });

    describe('Combined characters after dead keys should not trigger shortcuts', () => {
      /**
       * After a dead key is pressed and released, the next keypress produces the
       * combined accented character. For example:
       * - ^ + e -> event.key = 'ê' (from KeyE)
       * - ¨ + u -> event.key = 'ü' (from KeyU)
       * - ´ + a -> event.key = 'á' (from KeyA)
       *
       * These accented characters should NOT match any shortcut because:
       * - For matchBy:'key': 'ê' !== 'e', 'ü' !== 'u', 'á' !== 'a'
       * - For matchBy:'code': no modifier is pressed, so modifier check fails
       */

      it('^+e producing "ê" on KeyE should NOT match any shortcut', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // After dead key ^, pressing e produces 'ê'
        const input = createKeyboardInput('KeyE', '\u00ea'); // ê
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('¨+u producing "ü" on KeyU should NOT match any shortcut', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        const input = createKeyboardInput('KeyU', '\u00fc'); // ü
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('´+a producing "á" on KeyA should NOT match any shortcut', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // After dead key ´, pressing a produces 'á'
        // This is on KeyA, but the character is 'á', not 'a'
        const input = createKeyboardInput('KeyA', '\u00e1'); // á
        const result = matcher.match(input, 'grid');
        // No match: 'á' !== 'a' for character-based, and no modifier for code-based
        expect(result).toBeNull();
      });

      it('~+n producing "ñ" on KeyN should NOT match any shortcut', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        const input = createKeyboardInput('KeyN', '\u00f1'); // ñ
        const result = matcher.match(input, 'grid');
        expect(result).toBeNull();
      });

      it('Ctrl+accented character should NOT match Ctrl+base-letter shortcut', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // Edge case: user presses Ctrl after dead key composition
        // This produces Ctrl + accented character
        const input = createKeyboardInput('KeyA', '\u00e1', { ctrl: true }); // Ctrl+á
        const result = matcher.match(input, 'grid');
        // Should NOT match Ctrl+A (Select All) because 'á' !== 'a'
        expect(result).toBeNull();
      });
    });

    describe('Code-based shortcuts still work after dead key is cancelled', () => {
      /**
       * If a dead key is pressed but then the user presses a non-combinable key
       * (like an arrow key or F-key), the dead key is cancelled and the key
       * works normally. Code-based shortcuts should still function.
       */

      it('ArrowUp after a cancelled dead key should still match move-up', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // Dead key was pressed but then cancelled by pressing ArrowUp
        // ArrowUp sends event.key = 'ArrowUp', event.code = 'ArrowUp'
        const input = createKeyboardInput('ArrowUp', 'ArrowUp');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('move-up');
      });

      it('F2 after a cancelled dead key should still match edit-cell', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        const input = createKeyboardInput('F2', 'F2');
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('edit-cell');
      });

      it('Ctrl+C after a cancelled dead key should still match Copy', () => {
        const matcher = new ShortcutMatcher(shortcuts, 'windows');
        // Dead key cancelled, next Ctrl+C sends normal 'c'
        const input = createKeyboardInput('KeyC', 'c', { ctrl: true });
        const result = matcher.match(input, 'grid');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('copy');
      });
    });
  });
});
