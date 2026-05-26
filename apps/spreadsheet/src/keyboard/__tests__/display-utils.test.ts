import type { PhysicalKeyBinding } from '@mog-sdk/kernel/keyboard';
import type { KeyboardShortcut } from '../types';
import {
  formatMultipleShortcuts,
  getHelpDisplay,
  toDisplayString,
  toDisplayStringForPlatform,
  toLinuxDisplayString,
  toMacDisplayString,
  toShortcutDisplayString,
  toWindowsDisplayString,
} from '../display-utils';

// =============================================================================
// Test Layout Maps
// =============================================================================

/**
 * AZERTY layout map (French keyboard).
 * KeyQ -> 'a', KeyA -> 'q', KeyW -> 'z', KeyZ -> 'w'
 */
function createAzertyMap(): ReadonlyMap<string, string> {
  return new Map<string, string>([
    ['KeyQ', 'a'],
    ['KeyW', 'z'],
    ['KeyE', 'e'],
    ['KeyR', 'r'],
    ['KeyT', 't'],
    ['KeyY', 'y'],
    ['KeyU', 'u'],
    ['KeyI', 'i'],
    ['KeyO', 'o'],
    ['KeyP', 'p'],
    ['KeyA', 'q'],
    ['KeyS', 's'],
    ['KeyD', 'd'],
    ['KeyF', 'f'],
    ['KeyG', 'g'],
    ['KeyH', 'h'],
    ['KeyJ', 'j'],
    ['KeyK', 'k'],
    ['KeyL', 'l'],
    ['KeyZ', 'w'],
    ['KeyX', 'x'],
    ['KeyC', 'c'],
    ['KeyV', 'v'],
    ['KeyB', 'b'],
    ['KeyN', 'n'],
    ['KeyM', ','],
  ]);
}

// =============================================================================
// Helper to create bindings
// =============================================================================

function kb(code: string, ...modifiers: string[]): PhysicalKeyBinding {
  return {
    code: code as PhysicalKeyBinding['code'],
    modifiers: Object.freeze(modifiers as PhysicalKeyBinding['modifiers']),
  };
}

// =============================================================================
// Layout-Aware Display Tests
// =============================================================================

describe('layout-aware display strings', () => {
  const azerty = createAzertyMap();

  describe('toDisplayString with AZERTY layout', () => {
    it('shows layout-correct label for Windows: Ctrl+A instead of Ctrl+Q', () => {
      const binding = kb('KeyQ', 'ctrl');
      expect(toDisplayString(binding, 'windows', azerty)).toBe('Ctrl+A');
    });

    it('shows layout-correct label for Mac: \u2318A instead of \u2318Q', () => {
      const binding = kb('KeyQ', 'meta');
      expect(toDisplayString(binding, 'macos', azerty)).toBe('\u2318A');
    });

    it('shows layout-correct label for Linux: Ctrl+A instead of Ctrl+Q', () => {
      const binding = kb('KeyQ', 'ctrl');
      expect(toDisplayString(binding, 'linux', azerty)).toBe('Ctrl+A');
    });
  });

  describe('toMacDisplayString with AZERTY layout', () => {
    it('uses layout map for letter keys', () => {
      expect(toMacDisplayString(kb('KeyQ', 'meta'), azerty)).toBe('\u2318A');
    });

    it('uses layout map for KeyA (q on AZERTY)', () => {
      expect(toMacDisplayString(kb('KeyA', 'meta'), azerty)).toBe('\u2318Q');
    });

    it('preserves modifiers correctly', () => {
      expect(toMacDisplayString(kb('KeyQ', 'meta', 'shift'), azerty)).toBe('\u21E7\u2318A');
    });
  });

  describe('toWindowsDisplayString with AZERTY layout', () => {
    it('uses layout map for letter keys', () => {
      expect(toWindowsDisplayString(kb('KeyQ', 'ctrl'), azerty)).toBe('Ctrl+A');
    });

    it('uses layout map for KeyZ (w on AZERTY)', () => {
      expect(toWindowsDisplayString(kb('KeyZ', 'ctrl'), azerty)).toBe('Ctrl+W');
    });
  });

  describe('toLinuxDisplayString with AZERTY layout', () => {
    it('uses layout map for letter keys', () => {
      expect(toLinuxDisplayString(kb('KeyQ', 'ctrl'), azerty)).toBe('Ctrl+A');
    });
  });
});

// =============================================================================
// Special Keys Ignore Layout Map
// =============================================================================

describe('special keys ignore layout map', () => {
  const azerty = createAzertyMap();

  it('ArrowUp is unaffected by layout map on Mac', () => {
    expect(toDisplayString(kb('ArrowUp'), 'macos', azerty)).toBe('\u2191');
  });

  it('ArrowUp is unaffected by layout map on Windows', () => {
    expect(toDisplayString(kb('ArrowUp'), 'windows', azerty)).toBe('Up');
  });

  it('Enter is unaffected by layout map', () => {
    expect(toDisplayString(kb('Enter'), 'macos', azerty)).toBe('\u21A9');
    expect(toDisplayString(kb('Enter'), 'windows', azerty)).toBe('Enter');
  });

  it('Escape is unaffected by layout map', () => {
    expect(toDisplayString(kb('Escape'), 'macos', azerty)).toBe('\u238B');
    expect(toDisplayString(kb('Escape'), 'windows', azerty)).toBe('Esc');
  });

  it('F1 is unaffected by layout map', () => {
    expect(toDisplayString(kb('F1'), 'windows', azerty)).toBe('F1');
  });

  it('Tab is unaffected by layout map', () => {
    expect(toDisplayString(kb('Tab'), 'macos', azerty)).toBe('\u21E5');
  });

  it('Backspace is unaffected by layout map', () => {
    expect(toDisplayString(kb('Backspace'), 'macos', azerty)).toBe('\u232B');
  });
});

// =============================================================================
// Null Layout Map = Backward Compatible
// =============================================================================

describe('null layoutMap produces identical output to no-layoutMap call', () => {
  const binding = kb('KeyQ', 'ctrl');

  it('Windows: null layout = no layout', () => {
    expect(toDisplayString(binding, 'windows', null)).toBe(toDisplayString(binding, 'windows'));
  });

  it('Mac: null layout = no layout', () => {
    const macBinding = kb('KeyQ', 'meta');
    expect(toDisplayString(macBinding, 'macos', null)).toBe(toDisplayString(macBinding, 'macos'));
  });

  it('Linux: null layout = no layout', () => {
    expect(toDisplayString(binding, 'linux', null)).toBe(toDisplayString(binding, 'linux'));
  });

  it('undefined layout = no layout', () => {
    expect(toDisplayString(binding, 'windows', undefined)).toBe(
      toDisplayString(binding, 'windows'),
    );
  });
});

// =============================================================================
// toShortcutDisplayString with matchBy: 'key' (mnemonic shortcuts)
// =============================================================================

describe('toShortcutDisplayString with matchBy: key', () => {
  const azerty = createAzertyMap();

  function createMnemonicShortcut(
    expectedCharacter: string,
    code: string,
    modifiers: string[],
  ): KeyboardShortcut {
    return {
      id: 'test.mnemonic',
      bindings: {
        default: kb(code, ...modifiers),
      },
      description: 'Test mnemonic shortcut',
      action: 'MOVE_UP',
      enabled: true,
      priority: 'medium',
      category: 'editing',
      contexts: ['global'],
      muscleMemory: 'common',
      matchBy: 'key',
      expectedCharacter,
    };
  }

  it('uses expectedCharacter, not layout map, for matchBy: key shortcuts', () => {
    // Bold: Ctrl+B — should always show 'B' regardless of layout
    const bold = createMnemonicShortcut('b', 'KeyB', ['ctrl']);

    // Without layout map
    expect(toShortcutDisplayString(bold, 'windows')).toBe('Ctrl+B');

    // With AZERTY layout map — should STILL show B, not the AZERTY value
    expect(toShortcutDisplayString(bold, 'windows', azerty)).toBe('Ctrl+B');
  });

  it('uses expectedCharacter on Mac for matchBy: key shortcuts', () => {
    const bold = createMnemonicShortcut('b', 'KeyB', ['meta']);

    expect(toShortcutDisplayString(bold, 'macos', azerty)).toBe('\u2318B');
  });

  it('uses expectedCharacter on Linux for matchBy: key shortcuts', () => {
    const bold = createMnemonicShortcut('b', 'KeyB', ['ctrl']);

    expect(toShortcutDisplayString(bold, 'linux', azerty)).toBe('Ctrl+B');
  });
});

// =============================================================================
// toShortcutDisplayString with matchBy: 'code' (positional shortcuts)
// =============================================================================

describe('toShortcutDisplayString with matchBy: code', () => {
  const azerty = createAzertyMap();

  function createCodeShortcut(code: string, modifiers: string[]): KeyboardShortcut {
    return {
      id: 'test.code',
      bindings: {
        default: kb(code, ...modifiers),
      },
      description: 'Test code shortcut',
      action: 'MOVE_UP',
      enabled: true,
      priority: 'medium',
      category: 'navigation',
      contexts: ['global'],
      muscleMemory: 'common',
      matchBy: 'code',
    };
  }

  it('uses layout map for letter keys with matchBy: code', () => {
    const shortcut = createCodeShortcut('KeyQ', ['ctrl']);
    expect(toShortcutDisplayString(shortcut, 'windows', azerty)).toBe('Ctrl+A');
  });

  it('ignores layout map for special keys with matchBy: code', () => {
    const shortcut = createCodeShortcut('ArrowUp', []);
    expect(toShortcutDisplayString(shortcut, 'windows', azerty)).toBe('Up');
  });
});

// =============================================================================
// Propagation through higher-level functions
// =============================================================================

describe('layout map propagation', () => {
  const azerty = createAzertyMap();

  it('toDisplayStringForPlatform propagates layout map', () => {
    const bindings = { default: kb('KeyQ', 'ctrl') };
    expect(toDisplayStringForPlatform(bindings, 'windows', azerty)).toBe('Ctrl+A');
  });

  it('getHelpDisplay propagates layout map', () => {
    const bindings = { default: kb('KeyQ', 'ctrl') };
    const help = getHelpDisplay(bindings, azerty);
    expect(help.windows).toBe('Ctrl+A');
    expect(help.linux).toBe('Ctrl+A');
    // Mac auto-converts ctrl to meta for default bindings
  });

  it('formatMultipleShortcuts propagates layout map', () => {
    const bindings = [{ default: kb('KeyQ', 'ctrl') }, { default: kb('KeyA', 'ctrl') }];
    const result = formatMultipleShortcuts(bindings, 'windows', ' or ', azerty);
    expect(result).toBe('Ctrl+A or Ctrl+Q');
  });
});
