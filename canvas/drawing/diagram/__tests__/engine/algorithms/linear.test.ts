/**
 * Tests for the Linear Layout Algorithm.
 *
 * The linear algorithm arranges children in a straight line with configurable
 * direction, alignment, and spacing. Tests verify:
 *
 * - Flow directions (fromL, fromR, fromT, fromB)
 * - Cross-axis alignment (l, r, t, b, ctr)
 * - Horizontal/vertical alignment overrides
 * - Node-level alignment (nodeHorzAlign, nodeVertAlign)
 * - stElem (starting element index)
 * - Spacing from constraints (sp, sibSp)
 * - Equal size distribution
 * - Custom child sizes from constraints
 * - Empty children
 * - Single child
 * - Used bounds calculation
 */

import type {
  AlgorithmContext,
  LayoutNodeInstance,
} from '../../../src/engine/algorithms/algorithm-types';
import { LinearAlgorithm, createLinearAlgorithm } from '../../../src/engine/algorithms/linear';
import type { ResolvedConstraints } from '../../../src/engine/constraints/constraint-evaluator';

// =============================================================================
// Helpers
// =============================================================================

function makeNode(overrides: Partial<LayoutNodeInstance> = {}): LayoutNodeInstance {
  return {
    name: '',
    constraints: [],
    rules: [],
    children: [],
    ...overrides,
  };
}

function makeChild(name: string, overrides: Partial<LayoutNodeInstance> = {}): LayoutNodeInstance {
  return makeNode({
    name,
    shape: { type: 'rect' },
    ...overrides,
  });
}

function makeContext(overrides: Partial<AlgorithmContext> = {}): AlgorithmContext {
  const defaultConstraints: ResolvedConstraints = {
    values: new Map(),
  };

  return {
    node: makeNode({ name: 'linear1' }),
    constraints: defaultConstraints,
    children: [],
    params: new Map(),
    variables: {
      orgChart: false,
      chMax: -1,
      chPref: -1,
      bulletEnabled: false,
      dir: 'norm',
      hierBranch: 'std',
      animOne: 'none',
      animLvl: 'none',
      resizeHandles: 'rel',
    },
    bounds: { width: 1000, height: 800 },
    ...overrides,
  };
}

function threeChildren(): LayoutNodeInstance[] {
  return [makeChild('a'), makeChild('b'), makeChild('c')];
}

// =============================================================================
// Tests
// =============================================================================

describe('LinearAlgorithm', () => {
  let algo: LinearAlgorithm;

  beforeEach(() => {
    algo = new LinearAlgorithm();
  });

  // ==========================================================================
  // Type
  // ==========================================================================

  describe('type', () => {
    it('should have type "lin"', () => {
      expect(algo.type).toBe('lin');
    });
  });

  // ==========================================================================
  // Empty children
  // ==========================================================================

  describe('no children', () => {
    it('should return empty shapes when no children', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      expect(result.shapes).toEqual([]);
    });

    it('should return empty connectors when no children', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      expect(result.connectors).toEqual([]);
    });

    it('should return zero usedBounds when no children', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      expect(result.usedBounds).toEqual({ width: 0, height: 0 });
    });
  });

  // ==========================================================================
  // Default direction (fromL)
  // ==========================================================================

  describe('default direction (fromL)', () => {
    it('should arrange children left-to-right by default', () => {
      const ctx = makeContext({ children: threeChildren() });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(3);

      // Children should be arranged left to right
      expect(result.shapes[0].x).toBeLessThan(result.shapes[1].x);
      expect(result.shapes[1].x).toBeLessThan(result.shapes[2].x);
    });

    it('should equally distribute children across available width', () => {
      const ctx = makeContext({
        children: threeChildren(),
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);

      // Each child should get 300px wide (900 / 3)
      expect(result.shapes[0].width).toBe(300);
      expect(result.shapes[1].width).toBe(300);
      expect(result.shapes[2].width).toBe(300);
    });

    it('should position first child at x=0', () => {
      const ctx = makeContext({ children: threeChildren() });
      const result = algo.compute(ctx);
      expect(result.shapes[0].x).toBe(0);
    });

    it('should give children the full cross-axis size', () => {
      const ctx = makeContext({
        children: threeChildren(),
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      // Each child should be full height (300)
      for (const shape of result.shapes) {
        expect(shape.height).toBe(300);
      }
    });
  });

  // ==========================================================================
  // fromR (right to left)
  // ==========================================================================

  describe('fromR direction', () => {
    it('should arrange children right-to-left', () => {
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['linDir', 'fromR']]),
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(3);

      // First child should be rightmost
      expect(result.shapes[0].x).toBeGreaterThan(result.shapes[1].x);
      expect(result.shapes[1].x).toBeGreaterThan(result.shapes[2].x);
    });

    it('should place first child at the right edge', () => {
      const ctx = makeContext({
        children: [makeChild('a')],
        params: new Map([['linDir', 'fromR']]),
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      // Single child takes full width, placed at right edge minus width
      expect(result.shapes[0].x).toBe(0); // 900 - 900 = 0
      expect(result.shapes[0].width).toBe(900);
    });
  });

  // ==========================================================================
  // fromT (top to bottom)
  // ==========================================================================

  describe('fromT direction', () => {
    it('should arrange children top-to-bottom', () => {
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['linDir', 'fromT']]),
        bounds: { width: 300, height: 900 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(3);

      // Children should be arranged top to bottom
      expect(result.shapes[0].y).toBeLessThan(result.shapes[1].y);
      expect(result.shapes[1].y).toBeLessThan(result.shapes[2].y);
    });

    it('should equally distribute children across available height', () => {
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['linDir', 'fromT']]),
        bounds: { width: 300, height: 900 },
      });
      const result = algo.compute(ctx);
      // Each child should get 300px tall (900 / 3)
      expect(result.shapes[0].height).toBe(300);
      expect(result.shapes[1].height).toBe(300);
      expect(result.shapes[2].height).toBe(300);
    });

    it('should give children the full cross-axis size (width)', () => {
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['linDir', 'fromT']]),
        bounds: { width: 300, height: 900 },
      });
      const result = algo.compute(ctx);
      for (const shape of result.shapes) {
        expect(shape.width).toBe(300);
      }
    });
  });

  // ==========================================================================
  // fromB (bottom to top)
  // ==========================================================================

  describe('fromB direction', () => {
    it('should arrange children bottom-to-top', () => {
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['linDir', 'fromB']]),
        bounds: { width: 300, height: 900 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(3);

      // First child should be bottommost
      expect(result.shapes[0].y).toBeGreaterThan(result.shapes[1].y);
      expect(result.shapes[1].y).toBeGreaterThan(result.shapes[2].y);
    });
  });

  // ==========================================================================
  // Spacing
  // ==========================================================================

  describe('spacing', () => {
    it('should apply spacing between children from sp constraint', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([['sp', 20]]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        constraints,
        bounds: { width: 1000, height: 300 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(3);

      // Total spacing = 2 * 20 = 40
      // Available for children = 1000 - 40 = 960
      // Each child = 960 / 3 = 320
      expect(result.shapes[0].width).toBeCloseTo(320, 1);
      expect(result.shapes[1].width).toBeCloseTo(320, 1);
      expect(result.shapes[2].width).toBeCloseTo(320, 1);

      // Gap between shapes should be 20
      const gap1 = result.shapes[1].x - (result.shapes[0].x + result.shapes[0].width);
      const gap2 = result.shapes[2].x - (result.shapes[1].x + result.shapes[1].width);
      expect(gap1).toBeCloseTo(20, 1);
      expect(gap2).toBeCloseTo(20, 1);
    });

    it('should fall back to sibSp when sp is not set', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([['sibSp', 30]]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        constraints,
        bounds: { width: 1000, height: 300 },
      });
      const result = algo.compute(ctx);

      // Total spacing = 2 * 30 = 60
      // Available = 1000 - 60 = 940
      // Each child = ~313.33
      expect(result.shapes[0].width).toBeCloseTo(940 / 3, 1);

      const gap = result.shapes[1].x - (result.shapes[0].x + result.shapes[0].width);
      expect(gap).toBeCloseTo(30, 1);
    });

    it('should use zero spacing when neither sp nor sibSp is set', () => {
      const ctx = makeContext({
        children: threeChildren(),
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);

      // No spacing, so each child gets 300px
      expect(result.shapes[0].width).toBe(300);
      const gap = result.shapes[1].x - (result.shapes[0].x + result.shapes[0].width);
      expect(gap).toBeCloseTo(0, 1);
    });

    it('should apply spacing for vertical direction', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([['sp', 10]]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        constraints,
        params: new Map([['linDir', 'fromT']]),
        bounds: { width: 300, height: 1000 },
      });
      const result = algo.compute(ctx);

      // Total spacing = 2 * 10 = 20
      // Available = 1000 - 20 = 980
      // Each child height = ~326.67
      const gap = result.shapes[1].y - (result.shapes[0].y + result.shapes[0].height);
      expect(gap).toBeCloseTo(10, 1);
    });

    it('should handle spacing with single child (no gaps)', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([['sp', 50]]),
      };
      const ctx = makeContext({
        children: [makeChild('a')],
        constraints,
        bounds: { width: 1000, height: 300 },
      });
      const result = algo.compute(ctx);
      // Single child gets full width
      expect(result.shapes[0].width).toBe(1000);
    });
  });

  // ==========================================================================
  // Cross-axis alignment
  // ==========================================================================

  describe('cross-axis alignment (chAlign)', () => {
    it('should align to top (default for horizontal)', () => {
      const ctx = makeContext({
        children: threeChildren(),
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      for (const shape of result.shapes) {
        expect(shape.y).toBe(0);
      }
    });

    it('should align to bottom with chAlign=b', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['a:h', 100],
          ['b:h', 100],
          ['c:h', 100],
        ]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['chAlign', 'b']]),
        constraints,
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      for (const shape of result.shapes) {
        expect(shape.y).toBe(200); // 300 - 100
      }
    });

    it('should center on cross-axis with chAlign=ctr (horizontal)', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['a:h', 100],
          ['b:h', 100],
          ['c:h', 100],
        ]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['chAlign', 'ctr']]),
        constraints,
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      for (const shape of result.shapes) {
        expect(shape.y).toBe(100); // (300 - 100) / 2
      }
    });

    it('should align to left for vertical flow with chAlign=l', () => {
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([
          ['linDir', 'fromT'],
          ['chAlign', 'l'],
        ]),
        bounds: { width: 300, height: 900 },
      });
      const result = algo.compute(ctx);
      for (const shape of result.shapes) {
        expect(shape.x).toBe(0);
      }
    });

    it('should align to right for vertical flow with chAlign=r', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['a:w', 100],
          ['b:w', 100],
          ['c:w', 100],
        ]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([
          ['linDir', 'fromT'],
          ['chAlign', 'r'],
        ]),
        constraints,
        bounds: { width: 300, height: 900 },
      });
      const result = algo.compute(ctx);
      for (const shape of result.shapes) {
        expect(shape.x).toBe(200); // 300 - 100
      }
    });
  });

  // ==========================================================================
  // Horizontal alignment (horzAlign) for horizontal flow
  // ==========================================================================

  describe('horizontal alignment (horzAlign)', () => {
    it('should center-align block with horzAlign=ctr', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['a:w', 100],
          ['b:w', 100],
          ['c:w', 100],
        ]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['horzAlign', 'ctr']]),
        constraints,
        bounds: { width: 1000, height: 300 },
      });
      const result = algo.compute(ctx);
      // Total width = 300, remaining = 700, offset = 350
      expect(result.shapes[0].x).toBeCloseTo(350, 0);
    });

    it('should right-align block with horzAlign=r', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['a:w', 100],
          ['b:w', 100],
          ['c:w', 100],
        ]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['horzAlign', 'r']]),
        constraints,
        bounds: { width: 1000, height: 300 },
      });
      const result = algo.compute(ctx);
      // Total width = 300, remaining = 700, offset = 700
      expect(result.shapes[0].x).toBeCloseTo(700, 0);
    });

    it('should left-align block with horzAlign=l', () => {
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['horzAlign', 'l']]),
        bounds: { width: 1000, height: 300 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].x).toBe(0);
    });
  });

  // ==========================================================================
  // Vertical alignment (vertAlign) for horizontal flow
  // ==========================================================================

  describe('vertical alignment (vertAlign) for horizontal flow', () => {
    it('should center children vertically with vertAlign=mid', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['a:h', 100],
          ['b:h', 100],
          ['c:h', 100],
        ]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['vertAlign', 'mid']]),
        constraints,
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      for (const shape of result.shapes) {
        expect(shape.y).toBe(100); // (300 - 100) / 2
      }
    });

    it('should bottom-align children with vertAlign=b', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['a:h', 100],
          ['b:h', 100],
          ['c:h', 100],
        ]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['vertAlign', 'b']]),
        constraints,
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      for (const shape of result.shapes) {
        expect(shape.y).toBe(200); // 300 - 100
      }
    });
  });

  // ==========================================================================
  // Vertical alignment for vertical flow
  // ==========================================================================

  describe('vertical alignment (vertAlign) for vertical flow', () => {
    it('should center-align block vertically with vertAlign=mid', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['a:h', 100],
          ['b:h', 100],
          ['c:h', 100],
        ]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([
          ['linDir', 'fromT'],
          ['vertAlign', 'mid'],
        ]),
        constraints,
        bounds: { width: 300, height: 1000 },
      });
      const result = algo.compute(ctx);
      // Total height = 300, remaining = 700, offset = 350
      expect(result.shapes[0].y).toBeCloseTo(350, 0);
    });
  });

  // ==========================================================================
  // stElem (starting element)
  // ==========================================================================

  describe('stElem (starting element)', () => {
    it('should skip first element when stElem=2', () => {
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['stElem', '2']]),
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      // Should only have 2 shapes (b, c)
      expect(result.shapes).toHaveLength(2);
    });

    it('should skip first two elements when stElem=3', () => {
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['stElem', '3']]),
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      // Should only have 1 shape (c)
      expect(result.shapes).toHaveLength(1);
    });

    it('should return empty when stElem > children count', () => {
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['stElem', '10']]),
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(0);
    });

    it('should include all children when stElem=1 (default)', () => {
      const ctx = makeContext({
        children: threeChildren(),
        params: new Map([['stElem', '1']]),
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(3);
    });
  });

  // ==========================================================================
  // Single child
  // ==========================================================================

  describe('single child', () => {
    it('should give single child the full width', () => {
      const ctx = makeContext({
        children: [makeChild('a')],
        bounds: { width: 1000, height: 300 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].x).toBe(0);
      expect(result.shapes[0].width).toBe(1000);
    });

    it('should give single child the full height for vertical', () => {
      const ctx = makeContext({
        children: [makeChild('a')],
        params: new Map([['linDir', 'fromT']]),
        bounds: { width: 300, height: 1000 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].y).toBe(0);
      expect(result.shapes[0].height).toBe(1000);
    });
  });

  // ==========================================================================
  // Custom child sizes from constraints
  // ==========================================================================

  describe('custom child sizes', () => {
    it('should use constraint-specified widths for individual children', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['a:w', 200],
          ['b:w', 300],
          ['c:w', 400],
        ]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        constraints,
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].width).toBe(200);
      expect(result.shapes[1].width).toBe(300);
      expect(result.shapes[2].width).toBe(400);
    });

    it('should use constraint-specified heights for individual children', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['a:h', 100],
          ['b:h', 200],
          ['c:h', 300],
        ]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        constraints,
        bounds: { width: 900, height: 400 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].height).toBe(100);
      expect(result.shapes[1].height).toBe(200);
      expect(result.shapes[2].height).toBe(300);
    });
  });

  // ==========================================================================
  // Used bounds
  // ==========================================================================

  describe('used bounds', () => {
    it('should compute used bounds from shape extents', () => {
      const ctx = makeContext({
        children: threeChildren(),
        bounds: { width: 900, height: 300 },
      });
      const result = algo.compute(ctx);
      // Each child is 300x300, total width = 900
      expect(result.usedBounds.width).toBe(900);
      expect(result.usedBounds.height).toBe(300);
    });

    it('should compute used bounds with spacing', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([['sp', 50]]),
      };
      const ctx = makeContext({
        children: threeChildren(),
        constraints,
        bounds: { width: 1000, height: 300 },
      });
      const result = algo.compute(ctx);
      // Total spacing = 100, child width = (1000-100)/3 = 300
      // Total = 300*3 + 100 = 1000
      expect(result.usedBounds.width).toBeCloseTo(1000, 0);
    });
  });

  // ==========================================================================
  // Shape properties
  // ==========================================================================

  describe('shape properties', () => {
    it('should pass through model IDs', () => {
      const ctx = makeContext({
        children: [
          makeChild('a', { dataPointId: 'dp-1' }),
          makeChild('b', { dataPointId: 'dp-2' }),
        ],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].modelId).toBe('dp-1');
      expect(result.shapes[1].modelId).toBe('dp-2');
    });

    it('should pass through text content', () => {
      const ctx = makeContext({
        children: [makeChild('a', { text: 'Item 1' }), makeChild('b', { text: 'Item 2' })],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].text).toBe('Item 1');
      expect(result.shapes[1].text).toBe('Item 2');
    });

    it('should pass through style labels', () => {
      const ctx = makeContext({
        children: [makeChild('a', { styleLbl: 'node1' }), makeChild('b', { styleLbl: 'node2' })],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].styleLbl).toBe('node1');
      expect(result.shapes[1].styleLbl).toBe('node2');
    });

    it('should pass through shape adjustments', () => {
      const adj = new Map([['adj', 0.5]]);
      const ctx = makeContext({
        children: [makeChild('a', { shape: { type: 'roundRect', adjustments: adj } })],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].adjustments).toBe(adj);
    });

    it('should use shape type from child', () => {
      const ctx = makeContext({
        children: [
          makeChild('a', { shape: { type: 'ellipse' } }),
          makeChild('b', { shape: { type: 'diamond' } }),
        ],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].shapeType).toBe('ellipse');
      expect(result.shapes[1].shapeType).toBe('diamond');
    });
  });

  // ==========================================================================
  // Connectors
  // ==========================================================================

  describe('connectors', () => {
    it('should always return empty connectors', () => {
      const ctx = makeContext({ children: threeChildren() });
      const result = algo.compute(ctx);
      expect(result.connectors).toEqual([]);
    });
  });

  // ==========================================================================
  // createLinearAlgorithm factory
  // ==========================================================================

  describe('createLinearAlgorithm', () => {
    it('should create a LinearAlgorithm instance', () => {
      const algo = createLinearAlgorithm();
      expect(algo).toBeInstanceOf(LinearAlgorithm);
    });

    it('should have correct type', () => {
      const algo = createLinearAlgorithm();
      expect(algo.type).toBe('lin');
    });
  });

  // ==========================================================================
  // Two children
  // ==========================================================================

  describe('two children', () => {
    it('should split evenly with two children', () => {
      const ctx = makeContext({
        children: [makeChild('a'), makeChild('b')],
        bounds: { width: 800, height: 300 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(2);
      expect(result.shapes[0].width).toBe(400);
      expect(result.shapes[1].width).toBe(400);
      expect(result.shapes[0].x).toBe(0);
      expect(result.shapes[1].x).toBe(400);
    });
  });

  // ==========================================================================
  // Many children
  // ==========================================================================

  describe('many children', () => {
    it('should handle 10 children', () => {
      const children = Array.from({ length: 10 }, (_, i) => makeChild(`item${i}`));
      const ctx = makeContext({
        children,
        bounds: { width: 1000, height: 300 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(10);

      // Each child should be 100px wide
      for (const shape of result.shapes) {
        expect(shape.width).toBe(100);
      }
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle zero-width bounds', () => {
      const ctx = makeContext({
        children: threeChildren(),
        bounds: { width: 0, height: 300 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(3);
      for (const shape of result.shapes) {
        expect(shape.width).toBe(0);
      }
    });

    it('should handle zero-height bounds', () => {
      const ctx = makeContext({
        children: threeChildren(),
        bounds: { width: 900, height: 0 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(3);
      for (const shape of result.shapes) {
        expect(shape.height).toBe(0);
      }
    });

    it('should handle default shape type for children without shapes', () => {
      const ctx = makeContext({
        children: [makeNode({ name: 'child1' })],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].shapeType).toBe('rect');
    });
  });
});
