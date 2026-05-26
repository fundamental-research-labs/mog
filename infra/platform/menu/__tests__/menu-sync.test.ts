/**
 * Tests for MenuShortcutSync and accelerator string generation.
 *
 */

import { jest } from '@jest/globals';

import type { PlatformIdentity } from '@mog-sdk/contracts/platform';
import type {
  KeyboardShortcut,
  PhysicalKeyBinding,
  ShortcutRegistry,
} from '@mog-sdk/contracts/keyboard';
import type { MenuItemInput } from '../menu-sync';
// ModifierKey is from physical-keys but we don't need to import it for tests —
// we just cast string arrays in makeBinding.

// =============================================================================
// Mock Tauri invoke
// =============================================================================

const mockInvoke = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const { bindingToAccelerator, createMenuShortcutSync, MenuShortcutSync, shortcutToAccelerator } =
  await import('../menu-sync');

// =============================================================================
// Test Helpers
// =============================================================================

function makeBinding(code: string, ...modifiers: string[]): PhysicalKeyBinding {
  return {
    code: code as PhysicalKeyBinding['code'],
    modifiers: Object.freeze(modifiers) as PhysicalKeyBinding['modifiers'],
  };
}

function makeShortcut(overrides: Partial<KeyboardShortcut> & { id: string }): KeyboardShortcut {
  return {
    bindings: { default: makeBinding('KeyA') },
    description: 'Test shortcut',
    action: 'TEST',
    enabled: true,
    priority: 'medium',
    category: 'file',
    contexts: ['global'],
    muscleMemory: 'common',
    matchBy: 'code',
    ...overrides,
  };
}

function makeRegistry(shortcuts: KeyboardShortcut[]): ShortcutRegistry {
  const map = new Map<string, KeyboardShortcut>();
  for (const s of shortcuts) {
    map.set(s.id, s);
  }
  return map;
}

// =============================================================================
// bindingToAccelerator
// =============================================================================

describe('bindingToAccelerator', () => {
  describe('basic key conversions', () => {
    it('converts letter keys', () => {
      expect(bindingToAccelerator(makeBinding('KeyS'), 'windows')).toBe('S');
      expect(bindingToAccelerator(makeBinding('KeyZ'), 'macos')).toBe('Z');
    });

    it('converts digit keys', () => {
      expect(bindingToAccelerator(makeBinding('Digit0'), 'windows')).toBe('0');
      expect(bindingToAccelerator(makeBinding('Digit9'), 'macos')).toBe('9');
    });

    it('converts F-keys', () => {
      expect(bindingToAccelerator(makeBinding('F1'), 'windows')).toBe('F1');
      expect(bindingToAccelerator(makeBinding('F11'), 'linux')).toBe('F11');
    });

    it('converts special keys', () => {
      expect(bindingToAccelerator(makeBinding('Enter'), 'windows')).toBe('Enter');
      expect(bindingToAccelerator(makeBinding('Escape'), 'macos')).toBe('Escape');
      expect(bindingToAccelerator(makeBinding('Space'), 'linux')).toBe('Space');
    });

    it('converts punctuation', () => {
      expect(bindingToAccelerator(makeBinding('Semicolon'), 'windows')).toBe(';');
      expect(bindingToAccelerator(makeBinding('Equal'), 'macos')).toBe('=');
      expect(bindingToAccelerator(makeBinding('Minus'), 'linux')).toBe('-');
    });

    it('returns null for unknown key codes', () => {
      expect(bindingToAccelerator(makeBinding('Unknown'), 'windows')).toBeNull();
    });
  });

  describe('modifier handling', () => {
    it('converts Ctrl+S on Windows to CmdOrCtrl+S', () => {
      expect(bindingToAccelerator(makeBinding('KeyS', 'ctrl'), 'windows')).toBe('CmdOrCtrl+S');
    });

    it('converts Ctrl+S on macOS to Ctrl+S (Ctrl is literal Ctrl on Mac)', () => {
      expect(bindingToAccelerator(makeBinding('KeyS', 'ctrl'), 'macos')).toBe('Ctrl+S');
    });

    it('converts Meta+S on macOS to CmdOrCtrl+S (Meta = Cmd on Mac)', () => {
      expect(bindingToAccelerator(makeBinding('KeyS', 'meta'), 'macos')).toBe('CmdOrCtrl+S');
    });

    it('converts Ctrl+Shift+Z on Windows', () => {
      expect(bindingToAccelerator(makeBinding('KeyZ', 'ctrl', 'shift'), 'windows')).toBe(
        'CmdOrCtrl+Shift+Z',
      );
    });

    it('converts Ctrl+Shift+Alt binding', () => {
      expect(bindingToAccelerator(makeBinding('KeyL', 'ctrl', 'shift', 'alt'), 'windows')).toBe(
        'CmdOrCtrl+Shift+Alt+L',
      );
    });

    it('converts Alt on macOS to Option', () => {
      expect(bindingToAccelerator(makeBinding('ArrowDown', 'alt'), 'macos')).toBe('Option+Down');
    });

    it('converts Alt on Windows to Alt', () => {
      expect(bindingToAccelerator(makeBinding('ArrowDown', 'alt'), 'windows')).toBe('Alt+Down');
    });

    it('handles no modifiers', () => {
      expect(bindingToAccelerator(makeBinding('F11'), 'windows')).toBe('F11');
    });
  });
});

// =============================================================================
// shortcutToAccelerator
// =============================================================================

describe('shortcutToAccelerator', () => {
  it('uses default binding when no platform override', () => {
    const shortcut = makeShortcut({
      id: 'test',
      bindings: { default: makeBinding('KeyS', 'ctrl') },
    });
    expect(shortcutToAccelerator(shortcut, 'windows')).toBe('CmdOrCtrl+S');
    expect(shortcutToAccelerator(shortcut, 'linux')).toBe('CmdOrCtrl+S');
  });

  it('uses macOS override when available on macOS', () => {
    const shortcut = makeShortcut({
      id: 'test',
      bindings: {
        default: makeBinding('KeyY', 'ctrl'),
        macos: makeBinding('KeyZ', 'meta', 'shift'),
      },
    });
    expect(shortcutToAccelerator(shortcut, 'macos')).toBe('CmdOrCtrl+Shift+Z');
    expect(shortcutToAccelerator(shortcut, 'windows')).toBe('CmdOrCtrl+Y');
  });

  it('uses windows override when available on Windows', () => {
    const shortcut = makeShortcut({
      id: 'test',
      bindings: {
        default: makeBinding('KeyA', 'ctrl'),
        windows: makeBinding('KeyB', 'ctrl'),
      },
    });
    expect(shortcutToAccelerator(shortcut, 'windows')).toBe('CmdOrCtrl+B');
    expect(shortcutToAccelerator(shortcut, 'macos')).toBe('Ctrl+A');
  });

  it('returns null for unknown key code in binding', () => {
    const shortcut = makeShortcut({
      id: 'test',
      bindings: { default: makeBinding('SomethingWeird', 'ctrl') },
    });
    expect(shortcutToAccelerator(shortcut, 'windows')).toBeNull();
  });
});

// =============================================================================
// MenuShortcutSync
// =============================================================================

describe('MenuShortcutSync', () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it('calls set_menu_items IPC with converted accelerators', async () => {
    const registry = makeRegistry([
      makeShortcut({
        id: 'save',
        bindings: { default: makeBinding('KeyS', 'ctrl') },
      }),
    ]);

    const sync = new MenuShortcutSync(() => registry, 'windows');
    await sync.sync();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('set_menu_items', {
      items: expect.arrayContaining([
        expect.objectContaining({
          id: 'save',
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          enabled: true,
          submenu: 'file',
        }),
      ]),
    });
  });

  it('sends null accelerator when shortcut not in registry', async () => {
    const registry = makeRegistry([]); // empty — no shortcuts

    const sync = new MenuShortcutSync(() => registry, 'windows');
    await sync.sync();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const items = mockInvoke.mock.calls[0][1].items as MenuItemInput[];
    // All items should still be sent (for menu structure) but with null accelerator
    const saveItem = items.find((i) => i.id === 'save');
    expect(saveItem).toBeDefined();
    expect(saveItem!.accelerator).toBeNull();
  });

  it('reflects disabled shortcuts in menu items', async () => {
    const registry = makeRegistry([
      makeShortcut({
        id: 'find',
        bindings: { default: makeBinding('KeyF', 'ctrl') },
        enabled: false,
      }),
    ]);

    const sync = new MenuShortcutSync(() => registry, 'windows');
    await sync.sync();

    const items = mockInvoke.mock.calls[0][1].items as MenuItemInput[];
    const findItem = items.find((i) => i.id === 'find');
    expect(findItem).toBeDefined();
    expect(findItem!.enabled).toBe(false);
  });

  it('rebuilds on subsequent sync calls', async () => {
    let currentRegistry = makeRegistry([
      makeShortcut({
        id: 'save',
        bindings: { default: makeBinding('KeyS', 'ctrl') },
      }),
    ]);

    const sync = new MenuShortcutSync(() => currentRegistry, 'windows');

    // First sync
    await sync.sync();
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Update registry with different binding
    currentRegistry = makeRegistry([
      makeShortcut({
        id: 'save',
        bindings: { default: makeBinding('KeyS', 'ctrl', 'shift') },
      }),
    ]);

    // Second sync
    await sync.sync();
    expect(mockInvoke).toHaveBeenCalledTimes(2);

    const secondItems = mockInvoke.mock.calls[1][1].items as MenuItemInput[];
    const saveItem = secondItems.find((i) => i.id === 'save');
    expect(saveItem!.accelerator).toBe('CmdOrCtrl+Shift+S');
  });

  it('does not throw on IPC failure', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('IPC error'));
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();

    const sync = new MenuShortcutSync(() => makeRegistry([]), 'windows');
    await expect(sync.sync()).resolves.not.toThrow();

    expect(consoleWarn).toHaveBeenCalledWith(
      '[MenuShortcutSync] Failed to sync menu:',
      expect.any(Error),
    );
    consoleWarn.mockRestore();
  });

  it('throws after dispose', async () => {
    const sync = new MenuShortcutSync(() => makeRegistry([]), 'windows');
    sync.dispose();
    await expect(sync.sync()).rejects.toThrow('Handle is disposed');
  });

  it('is idempotent on dispose', () => {
    const sync = new MenuShortcutSync(() => makeRegistry([]), 'windows');
    sync.dispose();
    sync.dispose(); // should not throw
  });
});

// =============================================================================
// createMenuShortcutSync factory
// =============================================================================

describe('createMenuShortcutSync', () => {
  it('returns MenuShortcutSync on desktop', () => {
    const identity: PlatformIdentity = { os: 'macos', runtime: 'desktop' };
    const result = createMenuShortcutSync(identity, () => new Map());
    expect(result).toBeInstanceOf(MenuShortcutSync);
    result!.dispose();
  });

  it('returns null on web', () => {
    const identity: PlatformIdentity = { os: 'windows', runtime: 'web' };
    const result = createMenuShortcutSync(identity, () => new Map());
    expect(result).toBeNull();
  });
});

// =============================================================================
// OS-standard items persist through rebuilds
// =============================================================================

describe('OS-standard items', () => {
  it('never sends OS-standard item IDs (About, Quit, Settings) in menu items', async () => {
    const registry = makeRegistry([
      makeShortcut({ id: 'save', bindings: { default: makeBinding('KeyS', 'ctrl') } }),
    ]);

    const sync = new MenuShortcutSync(() => registry, 'macos');
    await sync.sync();

    const items = mockInvoke.mock.calls[0][1].items as MenuItemInput[];
    const ids = items.map((i) => i.id);

    // These are handled as PredefinedMenuItem in Rust — JS should NOT send them
    expect(ids).not.toContain('about');
    expect(ids).not.toContain('quit');
    expect(ids).not.toContain('settings');
    // Clipboard items are PredefinedMenuItem too
    expect(ids).not.toContain('undo');
    expect(ids).not.toContain('redo');
    expect(ids).not.toContain('cut');
    expect(ids).not.toContain('copy');
    expect(ids).not.toContain('paste');
  });
});

// =============================================================================
// No double-dispatch (documentation test)
// =============================================================================

describe('no double-dispatch invariant', () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it('menu sync sends items via IPC, not keyboard events', async () => {
    // The MenuShortcutSync only calls invoke('set_menu_items', ...).
    // It does NOT listen for or dispatch keyboard events.
    // Menu accelerators are handled at the OS level by Tauri — when a menu
    // accelerator fires, the OS consumes the key event before it reaches the
    // webview. The keyboard system (useKeyboard hook) never sees that keypress.
    //
    // This test verifies that sync() only calls the IPC command and nothing else.
    const registry = makeRegistry([
      makeShortcut({ id: 'save', bindings: { default: makeBinding('KeyS', 'ctrl') } }),
    ]);

    const sync = new MenuShortcutSync(() => registry, 'macos');
    await sync.sync();

    // Only one call: the IPC command
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0]).toBe('set_menu_items');

    sync.dispose();
  });
});
