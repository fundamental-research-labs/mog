/**
 * Tests for GlobalShortcutService and related utilities.
 *
 * @see infra/platform/shortcuts/global-shortcuts.ts
 */

import { jest } from '@jest/globals';

import type { PhysicalKeyBinding } from '@mog-sdk/contracts/keyboard';
import type { GlobalShortcutService as GlobalShortcutServiceType } from '../global-shortcuts';

// =============================================================================
// Mock Setup
// =============================================================================

const mockRegister = jest.fn<Promise<void>, [string, () => void]>();
const mockUnregister = jest.fn<Promise<void>, [string]>();
const mockUnregisterAll = jest.fn<Promise<void>, []>();

// Mock isTauri detection
let mockIsTauri = true;
jest.unstable_mockModule('../../tauri/detection', () => ({
  isTauri: () => mockIsTauri,
  isWeb: () => !mockIsTauri,
}));

// Mock the dynamic import of the Tauri plugin.
// GlobalShortcutService uses `import('@tauri-apps/plugin-global-shortcut')` at runtime.
// We intercept the package before importing the module under test.
jest.unstable_mockModule('@tauri-apps/plugin-global-shortcut', () => ({
  register: mockRegister,
  unregister: mockUnregister,
  unregisterAll: mockUnregisterAll,
}));

const { GlobalShortcutService, createGlobalShortcutService, toAcceleratorString } =
  await import('../global-shortcuts');

// =============================================================================
// Helpers
// =============================================================================

function binding(code: string, ...modifiers: string[]): PhysicalKeyBinding {
  return {
    code: code as PhysicalKeyBinding['code'],
    modifiers: modifiers as unknown as PhysicalKeyBinding['modifiers'],
  };
}

// =============================================================================
// toAcceleratorString
// =============================================================================

describe('toAcceleratorString', () => {
  it('converts Ctrl+letter to CmdOrCtrl+Letter', () => {
    expect(toAcceleratorString(binding('KeyS', 'ctrl'))).toBe('CmdOrCtrl+S');
  });

  it('converts Ctrl+Shift+letter', () => {
    expect(toAcceleratorString(binding('KeyZ', 'ctrl', 'shift'))).toBe('CmdOrCtrl+Shift+Z');
  });

  it('converts digit key', () => {
    expect(toAcceleratorString(binding('Digit1', 'ctrl'))).toBe('CmdOrCtrl+1');
  });

  it('converts F-key', () => {
    expect(toAcceleratorString(binding('F2'))).toBe('F2');
  });

  it('converts F12', () => {
    expect(toAcceleratorString(binding('F12', 'ctrl'))).toBe('CmdOrCtrl+F12');
  });

  it('converts arrow key', () => {
    expect(toAcceleratorString(binding('ArrowUp', 'alt'))).toBe('Alt+Up');
  });

  it('converts special keys', () => {
    expect(toAcceleratorString(binding('Space', 'ctrl', 'shift'))).toBe('CmdOrCtrl+Shift+Space');
    expect(toAcceleratorString(binding('Enter', 'ctrl'))).toBe('CmdOrCtrl+Return');
    expect(toAcceleratorString(binding('Escape'))).toBe('Escape');
    expect(toAcceleratorString(binding('Tab', 'ctrl'))).toBe('CmdOrCtrl+Tab');
  });

  it('converts meta modifier to Super', () => {
    expect(toAcceleratorString(binding('KeyN', 'meta'))).toBe('Super+N');
  });

  it('handles all four modifiers in consistent order', () => {
    expect(toAcceleratorString(binding('KeyA', 'shift', 'meta', 'ctrl', 'alt'))).toBe(
      'CmdOrCtrl+Alt+Shift+Super+A',
    );
  });

  it('converts punctuation keys', () => {
    expect(toAcceleratorString(binding('Semicolon', 'ctrl'))).toBe('CmdOrCtrl+;');
    expect(toAcceleratorString(binding('Equal', 'ctrl'))).toBe('CmdOrCtrl+=');
    expect(toAcceleratorString(binding('Minus', 'ctrl'))).toBe('CmdOrCtrl+-');
    expect(toAcceleratorString(binding('Backquote', 'ctrl'))).toBe('CmdOrCtrl+`');
  });
});

// =============================================================================
// GlobalShortcutService
// =============================================================================

describe('GlobalShortcutService', () => {
  let service: GlobalShortcutServiceType;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRegister.mockResolvedValue(undefined);
    mockUnregister.mockResolvedValue(undefined);
    mockUnregisterAll.mockResolvedValue(undefined);
    mockIsTauri = true;
    service = new GlobalShortcutService();
  });

  afterEach(() => {
    service.dispose();
  });

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  describe('register', () => {
    it('registers a shortcut via the Tauri plugin', async () => {
      const cb = jest.fn();
      await service.register(binding('KeyS', 'ctrl'), cb);

      expect(mockRegister).toHaveBeenCalledWith('CmdOrCtrl+S', cb);
    });

    it('returns an unsubscribe function that calls unregister', async () => {
      const cb = jest.fn();
      const unsub = await service.register(binding('KeyS', 'ctrl'), cb);

      unsub();

      expect(mockUnregister).toHaveBeenCalledWith('CmdOrCtrl+S');
    });

    it('registers multiple shortcuts independently', async () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      await service.register(binding('KeyS', 'ctrl'), cb1);
      await service.register(binding('KeyN', 'ctrl'), cb2);

      expect(mockRegister).toHaveBeenCalledTimes(2);
      expect(mockRegister).toHaveBeenCalledWith('CmdOrCtrl+S', cb1);
      expect(mockRegister).toHaveBeenCalledWith('CmdOrCtrl+N', cb2);
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    it('logs warning and returns no-op when registration fails', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockRegister.mockRejectedValue(new Error('Shortcut already taken'));

      const cb = jest.fn();
      const unsub = await service.register(binding('KeyS', 'ctrl'), cb);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to register'),
        expect.any(Error),
      );

      // The returned unsubscribe should be a no-op (does not throw)
      unsub();
      expect(mockUnregister).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('does not throw when registration fails', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockRegister.mockRejectedValue(new Error('Shortcut already taken'));

      const cb = jest.fn();
      await expect(service.register(binding('KeyS', 'ctrl'), cb)).resolves.toBeDefined();

      jest.restoreAllMocks();
    });
  });

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  describe('dispose', () => {
    it('calls unregisterAll', async () => {
      await service.register(binding('KeyS', 'ctrl'), jest.fn());

      service.dispose();

      expect(mockUnregisterAll).toHaveBeenCalledTimes(1);
    });

    it('is idempotent', async () => {
      await service.register(binding('KeyS', 'ctrl'), jest.fn());

      service.dispose();
      service.dispose();

      expect(mockUnregisterAll).toHaveBeenCalledTimes(1);
    });

    it('prevents further registrations after dispose', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      service.dispose();

      const unsub = await service.register(binding('KeyN', 'ctrl'), jest.fn());
      expect(mockRegister).not.toHaveBeenCalled();

      // Returned unsub should be a no-op
      unsub();
      expect(mockUnregister).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('supports Symbol.dispose', async () => {
      await service.register(binding('KeyS', 'ctrl'), jest.fn());

      service[Symbol.dispose]();

      expect(mockUnregisterAll).toHaveBeenCalledTimes(1);
    });
  });
});

// =============================================================================
// createGlobalShortcutService (Factory)
// =============================================================================

describe('createGlobalShortcutService', () => {
  it('returns GlobalShortcutService on desktop (Tauri)', () => {
    mockIsTauri = true;
    const svc = createGlobalShortcutService();
    expect(svc).toBeInstanceOf(GlobalShortcutService);
    svc?.dispose();
  });

  it('returns null on web', () => {
    mockIsTauri = false;
    const svc = createGlobalShortcutService();
    expect(svc).toBeNull();
  });
});
