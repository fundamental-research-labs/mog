import { EffectiveStateManagerImpl } from '../state/effective-state-manager';
import { snapToPixelGrid } from '../utils/snap';

// =============================================================================
// snapToPixelGrid
// =============================================================================

describe('snapToPixelGrid', () => {
  // Formula: Math.floor(value * dpr) / dpr + 0.5 / dpr

  describe('snapping at 1x DPR', () => {
    const dpr = 1;

    it('snaps 0 to 0.5', () => {
      // Math.floor(0 * 1) / 1 + 0.5 / 1 = 0 + 0.5 = 0.5
      expect(snapToPixelGrid(0, dpr)).toBe(0.5);
    });

    it('snaps 10 to 10.5', () => {
      // Math.floor(10 * 1) / 1 + 0.5 / 1 = 10 + 0.5 = 10.5
      expect(snapToPixelGrid(10, dpr)).toBe(10.5);
    });

    it('snaps 99.3 to 99.5', () => {
      // Math.floor(99.3 * 1) / 1 + 0.5 / 1 = 99 + 0.5 = 99.5
      expect(snapToPixelGrid(99.3, dpr)).toBe(99.5);
    });

    it('snaps 99.9 to 99.5', () => {
      // Math.floor(99.9 * 1) / 1 + 0.5 / 1 = 99 + 0.5 = 99.5
      expect(snapToPixelGrid(99.9, dpr)).toBe(99.5);
    });
  });

  describe('snapping at 2x DPR', () => {
    const dpr = 2;

    it('snaps 0 to 0.25', () => {
      // Math.floor(0 * 2) / 2 + 0.5 / 2 = 0 + 0.25 = 0.25
      expect(snapToPixelGrid(0, dpr)).toBe(0.25);
    });

    it('snaps 10 to 10.25', () => {
      // Math.floor(10 * 2) / 2 + 0.5 / 2 = 10 + 0.25 = 10.25
      expect(snapToPixelGrid(10, dpr)).toBe(10.25);
    });

    it('snaps 5.3 to 5.25', () => {
      // Math.floor(5.3 * 2) / 2 + 0.5 / 2 = Math.floor(10.6) / 2 + 0.25 = 10/2 + 0.25 = 5.25
      expect(snapToPixelGrid(5.3, dpr)).toBe(5.25);
    });

    it('snaps 5.75 to 5.75', () => {
      // Math.floor(5.75 * 2) / 2 + 0.5 / 2 = Math.floor(11.5) / 2 + 0.25 = 11/2 + 0.25 = 5.5 + 0.25 = 5.75
      expect(snapToPixelGrid(5.75, dpr)).toBe(5.75);
    });
  });

  describe('snapping at 3x DPR', () => {
    const dpr = 3;

    it('snaps 0 to 1/6', () => {
      // Math.floor(0 * 3) / 3 + 0.5 / 3 = 0 + 1/6
      expect(snapToPixelGrid(0, dpr)).toBeCloseTo(1 / 6, 10);
    });

    it('snaps 10 to 10 + 1/6', () => {
      // Math.floor(10 * 3) / 3 + 0.5 / 3 = 30/3 + 1/6 = 10 + 1/6
      expect(snapToPixelGrid(10, dpr)).toBeCloseTo(10 + 1 / 6, 10);
    });

    it('snaps 4.5 to 4 + 1/2', () => {
      // Math.floor(4.5 * 3) / 3 + 0.5 / 3 = Math.floor(13.5) / 3 + 1/6 = 13/3 + 1/6 = 26/6 + 1/6 = 27/6 = 4.5
      expect(snapToPixelGrid(4.5, dpr)).toBeCloseTo(4.5, 10);
    });

    it('snaps 7.1 to the nearest third-pixel boundary', () => {
      // Math.floor(7.1 * 3) / 3 + 0.5 / 3 = Math.floor(21.3) / 3 + 1/6 = 21/3 + 1/6 = 7 + 1/6
      expect(snapToPixelGrid(7.1, dpr)).toBeCloseTo(7 + 1 / 6, 10);
    });
  });

  describe('integer values', () => {
    it('snaps integer value at 1x DPR to half-pixel', () => {
      expect(snapToPixelGrid(5, 1)).toBe(5.5);
    });

    it('snaps integer value at 2x DPR to quarter-pixel', () => {
      expect(snapToPixelGrid(5, 2)).toBe(5.25);
    });

    it('snaps zero at any DPR', () => {
      expect(snapToPixelGrid(0, 1)).toBe(0.5);
      expect(snapToPixelGrid(0, 2)).toBe(0.25);
      expect(snapToPixelGrid(0, 3)).toBeCloseTo(1 / 6, 10);
    });
  });

  describe('snapping at 1.5x DPR', () => {
    const dpr = 1.5;

    it('snaps 0 to 1/3', () => {
      // Math.floor(0 * 1.5) / 1.5 + 0.5 / 1.5 = 0 + 1/3
      expect(snapToPixelGrid(0, dpr)).toBeCloseTo(1 / 3, 10);
    });

    it('snaps 10 to 10 + 1/3', () => {
      // Math.floor(10 * 1.5) / 1.5 + 0.5 / 1.5 = Math.floor(15) / 1.5 + 1/3 = 10 + 1/3
      expect(snapToPixelGrid(10, dpr)).toBeCloseTo(10 + 1 / 3, 10);
    });

    it('snaps 5.3 to 5 + 1/3', () => {
      // Math.floor(5.3 * 1.5) / 1.5 + 1/3 = Math.floor(7.95) / 1.5 + 1/3 = 7/1.5 + 1/3 = 4.666... + 0.333... = 5
      // Actually: 7 / 1.5 = 4.6667, + 0.3333 = 5.0
      expect(snapToPixelGrid(5.3, dpr)).toBeCloseTo(5, 10);
    });

    it('snaps 5.7 to 5 + 1/3', () => {
      // Math.floor(5.7 * 1.5) / 1.5 + 1/3 = Math.floor(8.55) / 1.5 + 1/3 = 8/1.5 + 1/3 = 5.333... + 0.333... = 5.6667
      expect(snapToPixelGrid(5.7, dpr)).toBeCloseTo(5 + 2 / 3, 10);
    });
  });

  describe('fractional values', () => {
    it('snaps 0.1 at 1x DPR', () => {
      // Math.floor(0.1) / 1 + 0.5 = 0 + 0.5 = 0.5
      expect(snapToPixelGrid(0.1, 1)).toBe(0.5);
    });

    it('snaps 0.9 at 1x DPR', () => {
      // Math.floor(0.9) / 1 + 0.5 = 0 + 0.5 = 0.5
      expect(snapToPixelGrid(0.9, 1)).toBe(0.5);
    });

    it('snaps 3.14159 at 2x DPR', () => {
      // Math.floor(3.14159 * 2) / 2 + 0.25 = Math.floor(6.28318) / 2 + 0.25 = 6/2 + 0.25 = 3.25
      expect(snapToPixelGrid(3.14159, 2)).toBe(3.25);
    });

    it('snaps negative fractional value at 1x DPR', () => {
      // Math.floor(-0.3 * 1) / 1 + 0.5 = Math.floor(-0.3) / 1 + 0.5 = -1 + 0.5 = -0.5
      expect(snapToPixelGrid(-0.3, 1)).toBe(-0.5);
    });

    it('snaps negative fractional value at 2x DPR', () => {
      // Math.floor(-0.3 * 2) / 2 + 0.25 = Math.floor(-0.6) / 2 + 0.25 = -1/2 + 0.25 = -0.25
      expect(snapToPixelGrid(-0.3, 2)).toBe(-0.25);
    });
  });

  describe('half-pixel invariant (property-based)', () => {
    // For ANY value and ANY dpr, the result * dpr must have fractional part 0.5.
    // This guarantees crisp 1px strokes on the physical pixel grid.

    const testValues = [0, 1, 10, 100, 0.1, 0.5, 0.9, 3.14159, 99.99, 1000, -5, -0.3];
    const testDprs = [1, 1.5, 2, 3];

    for (const dpr of testDprs) {
      for (const value of testValues) {
        it(`snapToPixelGrid(${value}, ${dpr}) lands on physical half-pixel`, () => {
          const snapped = snapToPixelGrid(value, dpr);
          const physical = snapped * dpr;
          const fractional = physical - Math.floor(physical);
          expect(fractional).toBeCloseTo(0.5, 8);
        });
      }
    }
  });
});

// =============================================================================
// EffectiveStateManagerImpl
// =============================================================================

describe('EffectiveStateManagerImpl', () => {
  // Use a simple interface for state in tests
  interface TestState {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  let manager: EffectiveStateManagerImpl<TestState>;

  beforeEach(() => {
    manager = new EffectiveStateManagerImpl<TestState>();
  });

  describe('set/get lifecycle', () => {
    it('stores and retrieves state by id', () => {
      const state: TestState = { x: 10, y: 20, width: 100, height: 50 };
      manager.setEffective('obj-1', state);

      expect(manager.getEffective('obj-1')).toEqual(state);
    });

    it('returns the exact same reference that was set', () => {
      const state: TestState = { x: 0, y: 0, width: 200, height: 200 };
      manager.setEffective('obj-1', state);

      expect(manager.getEffective('obj-1')).toBe(state);
    });
  });

  describe('returns null for unknown IDs', () => {
    it('returns null when no state has been set', () => {
      expect(manager.getEffective('nonexistent')).toBeNull();
    });

    it('returns null for an ID that was never registered', () => {
      manager.setEffective('obj-1', { x: 0, y: 0, width: 10, height: 10 });
      expect(manager.getEffective('obj-2')).toBeNull();
    });
  });

  describe('clearEffective', () => {
    it('removes a single effective state', () => {
      manager.setEffective('obj-1', { x: 1, y: 2, width: 3, height: 4 });
      manager.setEffective('obj-2', { x: 5, y: 6, width: 7, height: 8 });

      manager.clearEffective('obj-1');

      expect(manager.getEffective('obj-1')).toBeNull();
      expect(manager.getEffective('obj-2')).toEqual({ x: 5, y: 6, width: 7, height: 8 });
    });

    it('is a no-op for unknown IDs', () => {
      manager.setEffective('obj-1', { x: 0, y: 0, width: 10, height: 10 });

      // Should not throw
      manager.clearEffective('nonexistent');

      expect(manager.getEffective('obj-1')).toEqual({ x: 0, y: 0, width: 10, height: 10 });
      expect(manager.size).toBe(1);
    });
  });

  describe('clearAll', () => {
    it('removes all effective states', () => {
      manager.setEffective('obj-1', { x: 1, y: 2, width: 3, height: 4 });
      manager.setEffective('obj-2', { x: 5, y: 6, width: 7, height: 8 });
      manager.setEffective('obj-3', { x: 9, y: 10, width: 11, height: 12 });

      manager.clearAll();

      expect(manager.getEffective('obj-1')).toBeNull();
      expect(manager.getEffective('obj-2')).toBeNull();
      expect(manager.getEffective('obj-3')).toBeNull();
      expect(manager.size).toBe(0);
    });

    it('is a no-op when already empty', () => {
      manager.clearAll();
      expect(manager.size).toBe(0);
    });
  });

  describe('multiple concurrent effective states', () => {
    it('manages independent states for different IDs', () => {
      const state1: TestState = { x: 0, y: 0, width: 100, height: 100 };
      const state2: TestState = { x: 50, y: 50, width: 200, height: 200 };
      const state3: TestState = { x: 99, y: 99, width: 300, height: 300 };

      manager.setEffective('drag-target', state1);
      manager.setEffective('resize-target', state2);
      manager.setEffective('rotate-target', state3);

      expect(manager.getEffective('drag-target')).toBe(state1);
      expect(manager.getEffective('resize-target')).toBe(state2);
      expect(manager.getEffective('rotate-target')).toBe(state3);
    });

    it('clearing one does not affect others', () => {
      manager.setEffective('a', { x: 1, y: 1, width: 1, height: 1 });
      manager.setEffective('b', { x: 2, y: 2, width: 2, height: 2 });
      manager.setEffective('c', { x: 3, y: 3, width: 3, height: 3 });

      manager.clearEffective('b');

      expect(manager.has('a')).toBe(true);
      expect(manager.has('b')).toBe(false);
      expect(manager.has('c')).toBe(true);
      expect(manager.size).toBe(2);
    });
  });

  describe('size property', () => {
    it('returns 0 for a new manager', () => {
      expect(manager.size).toBe(0);
    });

    it('increments when states are added', () => {
      manager.setEffective('obj-1', { x: 0, y: 0, width: 10, height: 10 });
      expect(manager.size).toBe(1);

      manager.setEffective('obj-2', { x: 0, y: 0, width: 20, height: 20 });
      expect(manager.size).toBe(2);
    });

    it('decrements when states are cleared', () => {
      manager.setEffective('obj-1', { x: 0, y: 0, width: 10, height: 10 });
      manager.setEffective('obj-2', { x: 0, y: 0, width: 20, height: 20 });
      expect(manager.size).toBe(2);

      manager.clearEffective('obj-1');
      expect(manager.size).toBe(1);
    });

    it('does not increment when overwriting an existing key', () => {
      manager.setEffective('obj-1', { x: 0, y: 0, width: 10, height: 10 });
      manager.setEffective('obj-1', { x: 5, y: 5, width: 50, height: 50 });
      expect(manager.size).toBe(1);
    });
  });

  describe('has method', () => {
    it('returns false for unknown IDs', () => {
      expect(manager.has('nonexistent')).toBe(false);
    });

    it('returns true for set IDs', () => {
      manager.setEffective('obj-1', { x: 0, y: 0, width: 10, height: 10 });
      expect(manager.has('obj-1')).toBe(true);
    });

    it('returns false after clearing', () => {
      manager.setEffective('obj-1', { x: 0, y: 0, width: 10, height: 10 });
      manager.clearEffective('obj-1');
      expect(manager.has('obj-1')).toBe(false);
    });

    it('returns false for all IDs after clearAll', () => {
      manager.setEffective('obj-1', { x: 0, y: 0, width: 10, height: 10 });
      manager.setEffective('obj-2', { x: 0, y: 0, width: 20, height: 20 });
      manager.clearAll();

      expect(manager.has('obj-1')).toBe(false);
      expect(manager.has('obj-2')).toBe(false);
    });
  });

  describe('overwrite existing state', () => {
    it('replaces the state for an existing ID', () => {
      const original: TestState = { x: 0, y: 0, width: 100, height: 100 };
      const updated: TestState = { x: 10, y: 20, width: 150, height: 80 };

      manager.setEffective('obj-1', original);
      expect(manager.getEffective('obj-1')).toBe(original);

      manager.setEffective('obj-1', updated);
      expect(manager.getEffective('obj-1')).toBe(updated);
      expect(manager.getEffective('obj-1')).not.toBe(original);
    });

    it('does not change size when overwriting', () => {
      manager.setEffective('obj-1', { x: 0, y: 0, width: 100, height: 100 });
      manager.setEffective('obj-1', { x: 50, y: 50, width: 200, height: 200 });
      manager.setEffective('obj-1', { x: 99, y: 99, width: 300, height: 300 });

      expect(manager.size).toBe(1);
    });

    it('get returns the latest state after multiple overwrites', () => {
      manager.setEffective('obj-1', { x: 1, y: 1, width: 1, height: 1 });
      manager.setEffective('obj-1', { x: 2, y: 2, width: 2, height: 2 });
      manager.setEffective('obj-1', { x: 3, y: 3, width: 3, height: 3 });

      expect(manager.getEffective('obj-1')).toEqual({ x: 3, y: 3, width: 3, height: 3 });
    });
  });
});
