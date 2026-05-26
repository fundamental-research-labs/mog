/**
 * Tests for Brush Selection Utilities
 */

import {
  brushSelect,
  brushSelectMarks,
  constrainBrushSelection,
  createBrushSelection,
  expandBrushSelection,
  getBrushArea,
  getBrushCenter,
  getBrushDimensions,
  intersectBrushSelections,
  isPointInBrush,
  isValidBrushSelection,
  unionBrushSelections,
  type BrushSelection,
  type DataRow,
} from '../../src/interaction/brush';
import type { AnyMark } from '../../src/primitives/types';

describe('brush utilities', () => {
  // ==========================================================================
  // Selection Creation Tests
  // ==========================================================================

  describe('createBrushSelection', () => {
    it('creates normalized selection from top-left to bottom-right', () => {
      const selection = createBrushSelection({ x: 0, y: 0 }, { x: 100, y: 100 });
      expect(selection.x).toEqual([0, 100]);
      expect(selection.y).toEqual([0, 100]);
    });

    it('normalizes when end is before start', () => {
      const selection = createBrushSelection({ x: 100, y: 100 }, { x: 0, y: 0 });
      expect(selection.x).toEqual([0, 100]);
      expect(selection.y).toEqual([0, 100]);
    });

    it('handles mixed directions', () => {
      const selection = createBrushSelection({ x: 100, y: 0 }, { x: 0, y: 100 });
      expect(selection.x).toEqual([0, 100]);
      expect(selection.y).toEqual([0, 100]);
    });

    it('handles zero-size selection', () => {
      const selection = createBrushSelection({ x: 50, y: 50 }, { x: 50, y: 50 });
      expect(selection.x).toEqual([50, 50]);
      expect(selection.y).toEqual([50, 50]);
    });
  });

  // ==========================================================================
  // Brush Selection Tests
  // ==========================================================================

  describe('brushSelect', () => {
    const marks: AnyMark[] = [
      { type: 'rect', x: 0, y: 0, width: 20, height: 20, style: {}, datum: { id: 1 } },
      { type: 'rect', x: 50, y: 50, width: 20, height: 20, style: {}, datum: { id: 2 } },
      { type: 'rect', x: 100, y: 100, width: 20, height: 20, style: {}, datum: { id: 3 } },
    ];

    const data: DataRow[] = [{ id: 1 }, { id: 2 }, { id: 3 }];

    const selection: BrushSelection = {
      x: [40, 80],
      y: [40, 80],
    };

    it('selects marks by center (default mode)', () => {
      const result = brushSelect(marks, data, selection);
      expect(result.indices).toEqual([1]); // Only second mark's center is in selection
      expect(result.data[0].id).toBe(2);
    });

    it('selects marks by intersection', () => {
      const largerSelection: BrushSelection = {
        x: [15, 55],
        y: [15, 55],
      };
      const result = brushSelect(marks, data, largerSelection, { mode: 'intersect' });
      expect(result.indices).toEqual([0, 1]); // Both first and second intersect
    });

    it('selects marks by containment', () => {
      const largeSelection: BrushSelection = {
        x: [-10, 130],
        y: [-10, 130],
      };
      const result = brushSelect(marks, data, largeSelection, { mode: 'contain' });
      expect(result.indices.length).toBe(3); // All marks are contained
    });

    it('returns empty when no marks selected', () => {
      const emptySelection: BrushSelection = {
        x: [200, 300],
        y: [200, 300],
      };
      const result = brushSelect(marks, data, emptySelection);
      expect(result.indices.length).toBe(0);
      expect(result.data.length).toBe(0);
    });

    it('preserves selection bounds in result', () => {
      const result = brushSelect(marks, data, selection);
      expect(result.bounds).toEqual(selection);
    });

    it('skips non-interactive marks', () => {
      const marksWithNonInteractive: AnyMark[] = [
        {
          type: 'rect',
          x: 50,
          y: 50,
          width: 20,
          height: 20,
          style: {},
          datum: { id: 1 },
          interactive: false,
        },
        { type: 'rect', x: 50, y: 50, width: 20, height: 20, style: {}, datum: { id: 2 } },
      ];
      const dataWithNonInteractive: DataRow[] = [{ id: 1 }, { id: 2 }];
      const result = brushSelect(marksWithNonInteractive, dataWithNonInteractive, selection);
      expect(result.indices).toEqual([1]);
    });
  });

  describe('brushSelectMarks', () => {
    const marks: AnyMark[] = [
      { type: 'symbol', x: 10, y: 10, size: 100, shape: 'circle', style: {}, datum: { id: 1 } },
      { type: 'symbol', x: 60, y: 60, size: 100, shape: 'circle', style: {}, datum: { id: 2 } },
      { type: 'symbol', x: 110, y: 110, size: 100, shape: 'circle', style: {}, datum: { id: 3 } },
    ];

    const selection: BrushSelection = {
      x: [50, 120],
      y: [50, 120],
    };

    it('returns marks within selection', () => {
      const result = brushSelectMarks(marks, selection);
      expect(result.length).toBe(2);
    });

    it('returns mark objects (not just indices)', () => {
      const result = brushSelectMarks(marks, selection);
      expect(result[0].type).toBe('symbol');
    });
  });

  // ==========================================================================
  // Selection Utility Tests
  // ==========================================================================

  describe('expandBrushSelection', () => {
    const selection: BrushSelection = {
      x: [50, 100],
      y: [50, 100],
    };

    it('expands selection by positive amount', () => {
      const expanded = expandBrushSelection(selection, 10);
      expect(expanded.x).toEqual([40, 110]);
      expect(expanded.y).toEqual([40, 110]);
    });

    it('contracts selection by negative amount', () => {
      const contracted = expandBrushSelection(selection, -10);
      expect(contracted.x).toEqual([60, 90]);
      expect(contracted.y).toEqual([60, 90]);
    });
  });

  describe('getBrushArea', () => {
    it('calculates area correctly', () => {
      const selection: BrushSelection = {
        x: [0, 100],
        y: [0, 50],
      };
      expect(getBrushArea(selection)).toBe(5000);
    });

    it('returns zero for zero-size selection', () => {
      const selection: BrushSelection = {
        x: [50, 50],
        y: [50, 50],
      };
      expect(getBrushArea(selection)).toBe(0);
    });
  });

  describe('isValidBrushSelection', () => {
    it('returns true for valid selection', () => {
      const selection: BrushSelection = {
        x: [0, 100],
        y: [0, 100],
      };
      expect(isValidBrushSelection(selection)).toBe(true);
    });

    it('returns false for zero-width selection', () => {
      const selection: BrushSelection = {
        x: [50, 50],
        y: [0, 100],
      };
      expect(isValidBrushSelection(selection)).toBe(false);
    });

    it('returns false for zero-height selection', () => {
      const selection: BrushSelection = {
        x: [0, 100],
        y: [50, 50],
      };
      expect(isValidBrushSelection(selection)).toBe(false);
    });

    it('respects minSize parameter', () => {
      const selection: BrushSelection = {
        x: [0, 5],
        y: [0, 5],
      };
      expect(isValidBrushSelection(selection, 10)).toBe(false);
      expect(isValidBrushSelection(selection, 5)).toBe(true);
    });
  });

  describe('constrainBrushSelection', () => {
    const selection: BrushSelection = {
      x: [-50, 200],
      y: [-50, 200],
    };

    const bounds = {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    };

    it('constrains selection to bounds', () => {
      const constrained = constrainBrushSelection(selection, bounds);
      expect(constrained.x).toEqual([0, 100]);
      expect(constrained.y).toEqual([0, 100]);
    });

    it('returns unchanged when already within bounds', () => {
      const withinBounds: BrushSelection = {
        x: [25, 75],
        y: [25, 75],
      };
      const constrained = constrainBrushSelection(withinBounds, bounds);
      expect(constrained).toEqual(withinBounds);
    });
  });

  describe('intersectBrushSelections', () => {
    it('returns intersection of overlapping selections', () => {
      const a: BrushSelection = { x: [0, 100], y: [0, 100] };
      const b: BrushSelection = { x: [50, 150], y: [50, 150] };

      const result = intersectBrushSelections(a, b);
      expect(result).not.toBeNull();
      expect(result!.x).toEqual([50, 100]);
      expect(result!.y).toEqual([50, 100]);
    });

    it('returns null for non-overlapping selections', () => {
      const a: BrushSelection = { x: [0, 50], y: [0, 50] };
      const b: BrushSelection = { x: [100, 150], y: [100, 150] };

      const result = intersectBrushSelections(a, b);
      expect(result).toBeNull();
    });

    it('returns null for touching selections (no area)', () => {
      const a: BrushSelection = { x: [0, 50], y: [0, 50] };
      const b: BrushSelection = { x: [50, 100], y: [50, 100] };

      const result = intersectBrushSelections(a, b);
      expect(result).toBeNull();
    });
  });

  describe('unionBrushSelections', () => {
    it('returns union (bounding box) of selections', () => {
      const a: BrushSelection = { x: [0, 50], y: [0, 50] };
      const b: BrushSelection = { x: [100, 150], y: [100, 150] };

      const result = unionBrushSelections(a, b);
      expect(result.x).toEqual([0, 150]);
      expect(result.y).toEqual([0, 150]);
    });

    it('returns unchanged when one contains the other', () => {
      const outer: BrushSelection = { x: [0, 100], y: [0, 100] };
      const inner: BrushSelection = { x: [25, 75], y: [25, 75] };

      const result = unionBrushSelections(outer, inner);
      expect(result).toEqual(outer);
    });
  });

  describe('isPointInBrush', () => {
    const selection: BrushSelection = {
      x: [0, 100],
      y: [0, 100],
    };

    it('returns true for point inside', () => {
      expect(isPointInBrush(50, 50, selection)).toBe(true);
    });

    it('returns true for point on edge', () => {
      expect(isPointInBrush(0, 50, selection)).toBe(true);
      expect(isPointInBrush(100, 50, selection)).toBe(true);
    });

    it('returns false for point outside', () => {
      expect(isPointInBrush(-10, 50, selection)).toBe(false);
      expect(isPointInBrush(110, 50, selection)).toBe(false);
    });
  });

  describe('getBrushCenter', () => {
    it('returns center point', () => {
      const selection: BrushSelection = {
        x: [0, 100],
        y: [0, 50],
      };
      const center = getBrushCenter(selection);
      expect(center.x).toBe(50);
      expect(center.y).toBe(25);
    });
  });

  describe('getBrushDimensions', () => {
    it('returns width and height', () => {
      const selection: BrushSelection = {
        x: [10, 110],
        y: [20, 70],
      };
      const dims = getBrushDimensions(selection);
      expect(dims.width).toBe(100);
      expect(dims.height).toBe(50);
    });
  });
});
