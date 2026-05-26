import { jest } from '@jest/globals';

import { getLayoutMap, onLayoutChange, resolveKeyLabel } from '../layout';

// =============================================================================
// Test Layout Maps
// =============================================================================

/**
 * AZERTY layout: French keyboard.
 * Notable differences from QWERTY:
 * - KeyQ -> 'a', KeyW -> 'z', KeyA -> 'q', KeyZ -> 'w'
 * - Top row digits produce symbols without shift
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
    ['Digit1', '&'],
    ['Digit2', 'é'],
    ['Digit3', '"'],
  ]);
}

/**
 * Dvorak layout: optimized for typing efficiency.
 * Notable differences from QWERTY:
 * - KeyQ -> '\'', KeyW -> ',', KeyE -> '.', KeyR -> 'p', KeyT -> 'y'
 * - Home row: KeyA -> 'a', KeyS -> 'o', KeyD -> 'e', KeyF -> 'u', KeyG -> 'i'
 */
function createDvorakMap(): ReadonlyMap<string, string> {
  return new Map<string, string>([
    ['KeyQ', "'"],
    ['KeyW', ','],
    ['KeyE', '.'],
    ['KeyR', 'p'],
    ['KeyT', 'y'],
    ['KeyY', 'f'],
    ['KeyU', 'g'],
    ['KeyI', 'c'],
    ['KeyO', 'r'],
    ['KeyP', 'l'],
    ['KeyA', 'a'],
    ['KeyS', 'o'],
    ['KeyD', 'e'],
    ['KeyF', 'u'],
    ['KeyG', 'i'],
    ['KeyH', 'd'],
    ['KeyJ', 'h'],
    ['KeyK', 't'],
    ['KeyL', 'n'],
    ['KeyZ', ';'],
    ['KeyX', 'q'],
    ['KeyC', 'j'],
    ['KeyV', 'k'],
    ['KeyB', 'x'],
    ['KeyN', 'b'],
    ['KeyM', 'm'],
  ]);
}

/**
 * Colemak layout: many keys match QWERTY, some don't.
 */
function createColemakMap(): ReadonlyMap<string, string> {
  return new Map<string, string>([
    ['KeyQ', 'q'], // same as QWERTY
    ['KeyW', 'w'], // same
    ['KeyE', 'f'], // different
    ['KeyR', 'p'], // different
    ['KeyT', 'g'], // different
    ['KeyY', 'j'], // different
    ['KeyU', 'l'], // different
    ['KeyI', 'u'], // different
    ['KeyO', 'y'], // different
    ['KeyP', ';'], // different
    ['KeyA', 'a'], // same
    ['KeyS', 'r'], // different
    ['KeyD', 's'], // different
    ['KeyF', 't'], // different
    ['KeyG', 'd'], // different
    ['KeyH', 'h'], // same
    ['KeyJ', 'n'], // different
    ['KeyK', 'e'], // different
    ['KeyL', 'i'], // different
    ['KeyZ', 'z'], // same
    ['KeyX', 'x'], // same
    ['KeyC', 'c'], // same
    ['KeyV', 'v'], // same
    ['KeyB', 'b'], // same
    ['KeyN', 'k'], // different
    ['KeyM', 'm'], // same
  ]);
}

// =============================================================================
// resolveKeyLabel
// =============================================================================

describe('resolveKeyLabel', () => {
  it('returns layout-correct label for AZERTY KeyQ', () => {
    expect(resolveKeyLabel('KeyQ', createAzertyMap())).toBe('A');
  });

  it('returns layout-correct label for AZERTY KeyA', () => {
    expect(resolveKeyLabel('KeyA', createAzertyMap())).toBe('Q');
  });

  it('returns layout-correct label for AZERTY KeyZ', () => {
    expect(resolveKeyLabel('KeyZ', createAzertyMap())).toBe('W');
  });

  it('returns QWERTY fallback when layoutMap is null', () => {
    expect(resolveKeyLabel('KeyQ', null)).toBe('Q');
  });

  it('returns QWERTY fallback for digit keys when layoutMap is null', () => {
    expect(resolveKeyLabel('Digit1', null)).toBe('1');
  });

  it('returns layout value for Dvorak', () => {
    expect(resolveKeyLabel('KeyS', createDvorakMap())).toBe('O');
    expect(resolveKeyLabel('KeyD', createDvorakMap())).toBe('E');
  });

  describe('Colemak partial overlap', () => {
    const colemak = createColemakMap();

    it('returns same label for keys that match QWERTY', () => {
      expect(resolveKeyLabel('KeyQ', colemak)).toBe('Q');
      expect(resolveKeyLabel('KeyW', colemak)).toBe('W');
      expect(resolveKeyLabel('KeyA', colemak)).toBe('A');
      expect(resolveKeyLabel('KeyZ', colemak)).toBe('Z');
    });

    it('returns different label for keys that differ from QWERTY', () => {
      expect(resolveKeyLabel('KeyE', colemak)).toBe('F');
      expect(resolveKeyLabel('KeyR', colemak)).toBe('P');
      expect(resolveKeyLabel('KeyS', colemak)).toBe('R');
      expect(resolveKeyLabel('KeyJ', colemak)).toBe('N');
    });
  });

  it('returns code as-is for non-letter/digit keys when not in layout map', () => {
    // ArrowUp is not a Key* or Digit* code, so fallback just returns it
    expect(resolveKeyLabel('ArrowUp', createAzertyMap())).toBe('ArrowUp');
  });

  it('uppercases layout map values', () => {
    const map = new Map([['KeyA', 'q']]);
    expect(resolveKeyLabel('KeyA', map)).toBe('Q');
  });

  it('falls back to QWERTY when key is not in layout map', () => {
    const sparseMap = new Map([['KeyA', 'q']]);
    // KeyB is not in sparseMap, should fall back to QWERTY
    expect(resolveKeyLabel('KeyB', sparseMap)).toBe('B');
  });
});

// =============================================================================
// getLayoutMap
// =============================================================================

describe('getLayoutMap', () => {
  const originalKeyboard = Object.getOwnPropertyDescriptor(navigator, 'keyboard');

  afterEach(() => {
    if (originalKeyboard) {
      Object.defineProperty(navigator, 'keyboard', originalKeyboard);
    } else {
      // @ts-expect-error — restoring absent state
      delete navigator.keyboard;
    }
  });

  it('returns null when navigator.keyboard is undefined', async () => {
    Object.defineProperty(navigator, 'keyboard', {
      value: undefined,
      configurable: true,
    });

    const result = await getLayoutMap();
    expect(result).toBeNull();
  });

  it('returns null when getLayoutMap is not a function', async () => {
    Object.defineProperty(navigator, 'keyboard', {
      value: {},
      configurable: true,
    });

    const result = await getLayoutMap();
    expect(result).toBeNull();
  });

  it('returns layout map when API is available', async () => {
    const mockMap = new Map([['KeyA', 'q']]);
    Object.defineProperty(navigator, 'keyboard', {
      value: {
        getLayoutMap: () => Promise.resolve(mockMap),
      },
      configurable: true,
    });

    const result = await getLayoutMap();
    expect(result).toBe(mockMap);
  });

  it('returns null when getLayoutMap() rejects (Permissions-Policy denial)', async () => {
    Object.defineProperty(navigator, 'keyboard', {
      value: {
        getLayoutMap: () => Promise.reject(new DOMException('Blocked')),
      },
      configurable: true,
    });

    const result = await getLayoutMap();
    expect(result).toBeNull();
  });
});

// =============================================================================
// onLayoutChange
// =============================================================================

describe('onLayoutChange', () => {
  const originalKeyboard = Object.getOwnPropertyDescriptor(navigator, 'keyboard');

  afterEach(() => {
    if (originalKeyboard) {
      Object.defineProperty(navigator, 'keyboard', originalKeyboard);
    } else {
      // @ts-expect-error — restoring absent state
      delete navigator.keyboard;
    }
  });

  it('subscribes to layoutchange events', () => {
    const listeners: (() => void)[] = [];
    Object.defineProperty(navigator, 'keyboard', {
      value: {
        addEventListener: (_type: string, cb: () => void) => listeners.push(cb),
        removeEventListener: jest.fn(),
      },
      configurable: true,
    });

    const callback = jest.fn();
    onLayoutChange(callback);

    expect(listeners).toHaveLength(1);

    // Simulate layout change
    listeners[0]();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('returns unsubscribe function that removes listener', () => {
    const removeMock = jest.fn();
    Object.defineProperty(navigator, 'keyboard', {
      value: {
        addEventListener: jest.fn(),
        removeEventListener: removeMock,
      },
      configurable: true,
    });

    const callback = jest.fn();
    const unsubscribe = onLayoutChange(callback);

    unsubscribe();
    expect(removeMock).toHaveBeenCalledWith('layoutchange', callback);
  });

  it('returns no-op unsubscribe when API unavailable', () => {
    Object.defineProperty(navigator, 'keyboard', {
      value: undefined,
      configurable: true,
    });

    const callback = jest.fn();
    const unsubscribe = onLayoutChange(callback);

    // Should not throw
    expect(() => unsubscribe()).not.toThrow();
  });

  it('returns no-op unsubscribe when addEventListener is missing', () => {
    Object.defineProperty(navigator, 'keyboard', {
      value: {},
      configurable: true,
    });

    const callback = jest.fn();
    const unsubscribe = onLayoutChange(callback);

    expect(() => unsubscribe()).not.toThrow();
  });
});
