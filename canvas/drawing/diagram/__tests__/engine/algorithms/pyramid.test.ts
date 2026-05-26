/**
 * Tests for the Pyramid layout algorithm.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.7 (Pyramid Algorithm)
 */

import type { VariableList } from '@mog-sdk/contracts/diagram';
import type {
  AlgorithmContext,
  LayoutNodeInstance,
} from '../../../src/engine/algorithms/algorithm-types';
import { PyramidAlgorithm } from '../../../src/engine/algorithms/pyramid';
import { createResolvedConstraints } from '../../../src/engine/constraints/constraint-evaluator';

// =============================================================================
// Test Helpers
// =============================================================================

const DEFAULT_VARIABLES: VariableList = {
  orgChart: false,
  chMax: -1,
  chPref: -1,
  bulletEnabled: false,
  dir: 'norm',
  hierBranch: 'std',
  animOne: 'none',
  animLvl: 'none',
  resizeHandles: 'rel',
};

function makeChild(
  name: string,
  text?: string,
  overrides?: Partial<LayoutNodeInstance>,
): LayoutNodeInstance {
  return {
    name,
    text: text ?? name,
    constraints: [],
    rules: [],
    children: [],
    dataPointId: `dp_${name}`,
    ...overrides,
  };
}

function makeContext(
  children: LayoutNodeInstance[],
  params: Record<string, string> = {},
  bounds: { width: number; height: number } = { width: 500, height: 400 },
  constraintOverrides: Record<string, number> = {},
): AlgorithmContext {
  const constraints = createResolvedConstraints();
  for (const [key, value] of Object.entries(constraintOverrides)) {
    constraints.values.set(key, value);
  }

  const paramMap = new Map<string, string>();
  for (const [k, v] of Object.entries(params)) {
    paramMap.set(k, v);
  }

  return {
    node: {
      name: 'pyramidRoot',
      constraints: [],
      rules: [],
      children,
    },
    constraints,
    children,
    params: paramMap,
    variables: DEFAULT_VARIABLES,
    bounds,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('PyramidAlgorithm', () => {
  let algo: PyramidAlgorithm;

  beforeEach(() => {
    algo = new PyramidAlgorithm();
  });

  it('should have type "pyra"', () => {
    expect(algo.type).toBe('pyra');
  });

  // ---------------------------------------------------------------------------
  // Empty / Single child
  // ---------------------------------------------------------------------------

  it('should return empty result for no children', () => {
    const ctx = makeContext([]);
    const result = algo.compute(ctx);
    expect(result.shapes).toHaveLength(0);
    expect(result.connectors).toHaveLength(0);
    expect(result.usedBounds.width).toBe(0);
    expect(result.usedBounds.height).toBe(0);
  });

  it('should handle a single child (full width)', () => {
    const ctx = makeContext([makeChild('A')]);
    const result = algo.compute(ctx);
    expect(result.shapes).toHaveLength(1);

    const shape = result.shapes[0];
    expect(shape.width).toBe(500);
    expect(shape.height).toBe(400);
    expect(shape.x).toBe(0);
    expect(shape.y).toBe(0);
    expect(shape.text).toBe('A');
  });

  // ---------------------------------------------------------------------------
  // Standard pyramid (fromT) — default direction
  // ---------------------------------------------------------------------------

  describe('standard pyramid (fromT)', () => {
    it('should arrange 3 levels with increasing widths top to bottom', () => {
      const children = [makeChild('L1'), makeChild('L2'), makeChild('L3')];
      const ctx = makeContext(children, {}, { width: 300, height: 300 });
      const result = algo.compute(ctx);

      expect(result.shapes).toHaveLength(3);

      // fromT: top is narrow, bottom is wide
      // Level 0 (top): width = 300 * 1/3 = 100
      // Level 1 (mid): width = 300 * 2/3 = 200
      // Level 2 (bot): width = 300 * 3/3 = 300
      expect(result.shapes[0].width).toBe(100);
      expect(result.shapes[1].width).toBe(200);
      expect(result.shapes[2].width).toBe(300);
    });

    it('should center each level horizontally', () => {
      const children = [makeChild('L1'), makeChild('L2')];
      const ctx = makeContext(children, {}, { width: 200, height: 200 });
      const result = algo.compute(ctx);

      // Level 0: width = 200 * 1/2 = 100, centered at x = (200-100)/2 = 50
      expect(result.shapes[0].x).toBe(50);
      // Level 1: width = 200 * 2/2 = 200, centered at x = (200-200)/2 = 0
      expect(result.shapes[1].x).toBe(0);
    });

    it('should divide height equally among levels', () => {
      const children = [makeChild('L1'), makeChild('L2'), makeChild('L3')];
      const ctx = makeContext(children, {}, { width: 300, height: 300 });
      const result = algo.compute(ctx);

      for (const shape of result.shapes) {
        expect(shape.height).toBe(100);
      }
    });

    it('should position levels top-to-bottom', () => {
      const children = [makeChild('L1'), makeChild('L2')];
      const ctx = makeContext(children, {}, { width: 200, height: 200 });
      const result = algo.compute(ctx);

      expect(result.shapes[0].y).toBe(0);
      expect(result.shapes[1].y).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // Inverted pyramid (fromB)
  // ---------------------------------------------------------------------------

  describe('inverted pyramid (fromB)', () => {
    it('should arrange levels with widths reversed (wide at top)', () => {
      const children = [makeChild('L1'), makeChild('L2'), makeChild('L3')];
      const ctx = makeContext(children, { linDir: 'fromB' }, { width: 300, height: 300 });
      const result = algo.compute(ctx);

      expect(result.shapes).toHaveLength(3);

      // fromB: children maintain original order, but width progression is inverted.
      // Width at visual level i (inverted) = 300 * (3 - i) / 3
      // Level 0 (L1, top): 300, Level 1 (L2, mid): 200, Level 2 (L3, bottom): 100
      const widths = result.shapes.map((s) => s.width);
      expect(widths[0]).toBe(300);
      expect(widths[1]).toBe(200);
      expect(widths[2]).toBe(100);
    });

    it('should preserve child order (only width progression is inverted)', () => {
      const children = [makeChild('L1', 'First'), makeChild('L2', 'Second')];
      const ctx = makeContext(children, { linDir: 'fromB' }, { width: 200, height: 200 });
      const result = algo.compute(ctx);

      // With fromB, children maintain their original order; only the width
      // progression is inverted (wider at visual top, narrower at bottom).
      expect(result.shapes[0].text).toBe('First');
      expect(result.shapes[1].text).toBe('Second');
      // First child (top) should be wider than second (bottom)
      expect(result.shapes[0].width).toBeGreaterThan(result.shapes[1].width);
    });
  });

  // ---------------------------------------------------------------------------
  // Spacing
  // ---------------------------------------------------------------------------

  describe('spacing', () => {
    it('should account for sibling spacing between levels', () => {
      const children = [makeChild('L1'), makeChild('L2')];
      const ctx = makeContext(children, {}, { width: 200, height: 200 }, { sibSp: 20 });
      const result = algo.compute(ctx);

      // Total spacing = 20 * (2-1) = 20
      // Level height = (200 - 20) / 2 = 90
      expect(result.shapes[0].height).toBe(90);
      expect(result.shapes[1].height).toBe(90);

      // Positions: y0 = 0, y1 = 90 + 20 = 110
      expect(result.shapes[0].y).toBe(0);
      expect(result.shapes[1].y).toBe(110);
    });

    it('should use sp constraint as fallback when sibSp is not set', () => {
      const children = [makeChild('L1'), makeChild('L2')];
      const ctx = makeContext(children, {}, { width: 200, height: 200 }, { sp: 10 });
      const result = algo.compute(ctx);

      // sibSp falls back to sp = 10
      const expectedHeight = (200 - 10) / 2;
      expect(result.shapes[0].height).toBe(expectedHeight);
    });

    it('should handle no spacing', () => {
      const children = [makeChild('L1'), makeChild('L2')];
      const ctx = makeContext(children, {}, { width: 200, height: 200 });
      const result = algo.compute(ctx);

      expect(result.shapes[0].height).toBe(100);
      expect(result.shapes[0].y).toBe(0);
      expect(result.shapes[1].y).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // Shape types
  // ---------------------------------------------------------------------------

  describe('shape types', () => {
    it('should use default trapezoid shape type', () => {
      const ctx = makeContext([makeChild('A')]);
      const result = algo.compute(ctx);
      expect(result.shapes[0].shapeType).toBe('trapezoid');
    });

    it('should use pyraLvlNode parameter for shape type', () => {
      const ctx = makeContext([makeChild('A')], { pyraLvlNode: 'triangle' });
      const result = algo.compute(ctx);
      expect(result.shapes[0].shapeType).toBe('triangle');
    });

    it('should use child shape type if defined', () => {
      const child = makeChild('A');
      child.shape = { type: 'ellipse' };
      const ctx = makeContext([child]);
      const result = algo.compute(ctx);
      expect(result.shapes[0].shapeType).toBe('ellipse');
    });

    it('should prefer child shape type over pyraLvlNode', () => {
      const child = makeChild('A');
      child.shape = { type: 'diamond' };
      const ctx = makeContext([child], { pyraLvlNode: 'triangle' });
      const result = algo.compute(ctx);
      expect(result.shapes[0].shapeType).toBe('diamond');
    });
  });

  // ---------------------------------------------------------------------------
  // Accent regions
  // ---------------------------------------------------------------------------

  describe('accent regions', () => {
    it('should create accent shapes when pyraAcctPos=bef', () => {
      const children = [makeChild('L1')];
      const ctx = makeContext(
        children,
        { pyraAcctPos: 'bef', pyraAcctBkgdNode: 'rect', pyraAcctTxNode: 'rect' },
        { width: 400, height: 200 },
        { pyraAcctRatio: 0.2 },
      );
      const result = algo.compute(ctx);

      // 1 level shape + 1 accent background + 1 accent text = 3
      expect(result.shapes).toHaveLength(3);

      // The accent width = 400 * 0.2 = 80
      // The level shape should be shifted right
      const levelShape = result.shapes[0];
      expect(levelShape.x).toBeGreaterThanOrEqual(80);

      // Accent shapes should be at x=0
      const accentBkgd = result.shapes[1];
      expect(accentBkgd.x).toBe(0);
      expect(accentBkgd.shapeType).toBe('rect');
    });

    it('should create accent shapes when pyraAcctPos=aft', () => {
      const children = [makeChild('L1')];
      const ctx = makeContext(
        children,
        { pyraAcctPos: 'aft', pyraAcctBkgdNode: 'roundRect', pyraAcctTxNode: 'rect' },
        { width: 500, height: 200 },
        { pyraAcctRatio: 0.3 },
      );
      const result = algo.compute(ctx);

      expect(result.shapes).toHaveLength(3);

      // Accent x should be at the pyramid width (500 - 500*0.3 = 350)
      const accentBkgd = result.shapes[1];
      expect(accentBkgd.x).toBe(350);
      expect(accentBkgd.shapeType).toBe('roundRect');
    });

    it('should not create accent shapes when pyraAcctPos is not set', () => {
      const children = [makeChild('L1'), makeChild('L2')];
      const ctx = makeContext(children);
      const result = algo.compute(ctx);

      // Only the level shapes
      expect(result.shapes).toHaveLength(2);
    });

    it('should only create accent background when pyraAcctBkgdNode is specified', () => {
      const children = [makeChild('L1')];
      const ctx = makeContext(
        children,
        { pyraAcctPos: 'bef', pyraAcctTxNode: 'rect' },
        { width: 400, height: 200 },
      );
      const result = algo.compute(ctx);
      // 1 level + 1 accent text = 2 (no accent background)
      expect(result.shapes).toHaveLength(2);
    });

    it('should only create accent text when pyraAcctTxNode is specified', () => {
      const children = [makeChild('L1')];
      const ctx = makeContext(
        children,
        { pyraAcctPos: 'bef', pyraAcctBkgdNode: 'rect' },
        { width: 400, height: 200 },
      );
      const result = algo.compute(ctx);
      // 1 level + 1 accent background = 2 (no accent text)
      expect(result.shapes).toHaveLength(2);
    });

    it('should use default accent ratio when pyraAcctRatio constraint is missing', () => {
      const children = [makeChild('L1')];
      const ctx = makeContext(
        children,
        { pyraAcctPos: 'bef', pyraAcctBkgdNode: 'rect' },
        { width: 400, height: 200 },
      );
      const result = algo.compute(ctx);

      // Default ratio is 0.25, so accent width = 400 * 0.25 = 100
      const accentShape = result.shapes[1];
      expect(accentShape.width).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // Model ID and text
  // ---------------------------------------------------------------------------

  describe('data binding', () => {
    it('should set modelId from dataPointId', () => {
      const child = makeChild('A', 'Text A');
      const ctx = makeContext([child]);
      const result = algo.compute(ctx);
      expect(result.shapes[0].modelId).toBe('dp_A');
    });

    it('should set text from child text', () => {
      const child = makeChild('A', 'Hello World');
      const ctx = makeContext([child]);
      const result = algo.compute(ctx);
      expect(result.shapes[0].text).toBe('Hello World');
    });

    it('should use presOfId when dataPointId is not available', () => {
      const child = makeChild('A');
      delete child.dataPointId;
      child.presOfId = 'pres_A';
      const ctx = makeContext([child]);
      const result = algo.compute(ctx);
      expect(result.shapes[0].modelId).toBe('pres_A');
    });

    it('should pass style label through', () => {
      const child = makeChild('A');
      child.styleLbl = 'node1';
      const ctx = makeContext([child]);
      const result = algo.compute(ctx);
      expect(result.shapes[0].styleLbl).toBe('node1');
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple levels
  // ---------------------------------------------------------------------------

  describe('multiple levels', () => {
    it('should handle 5 levels correctly', () => {
      const children = Array.from({ length: 5 }, (_, i) => makeChild(`L${i + 1}`));
      const ctx = makeContext(children, {}, { width: 500, height: 500 });
      const result = algo.compute(ctx);

      expect(result.shapes).toHaveLength(5);

      // Level widths should increase
      for (let i = 1; i < result.shapes.length; i++) {
        expect(result.shapes[i].width).toBeGreaterThan(result.shapes[i - 1].width);
      }

      // All heights should be equal
      const firstHeight = result.shapes[0].height;
      for (const shape of result.shapes) {
        expect(shape.height).toBe(firstHeight);
      }

      // Y positions should increase
      for (let i = 1; i < result.shapes.length; i++) {
        expect(result.shapes[i].y).toBeGreaterThan(result.shapes[i - 1].y);
      }
    });

    it('should produce no connectors', () => {
      const children = [makeChild('A'), makeChild('B')];
      const ctx = makeContext(children);
      const result = algo.compute(ctx);
      expect(result.connectors).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Used bounds
  // ---------------------------------------------------------------------------

  describe('used bounds', () => {
    it('should report full bounds as used', () => {
      const children = [makeChild('A'), makeChild('B')];
      const ctx = makeContext(children, {}, { width: 300, height: 200 });
      const result = algo.compute(ctx);
      expect(result.usedBounds.width).toBe(300);
      expect(result.usedBounds.height).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle zero-width bounds', () => {
      const children = [makeChild('A')];
      const ctx = makeContext(children, {}, { width: 0, height: 200 });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].width).toBe(0);
    });

    it('should handle zero-height bounds', () => {
      const children = [makeChild('A')];
      const ctx = makeContext(children, {}, { width: 200, height: 0 });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].height).toBe(0);
    });

    it('should handle 10 levels', () => {
      const children = Array.from({ length: 10 }, (_, i) => makeChild(`L${i}`));
      const ctx = makeContext(children, {}, { width: 1000, height: 1000 });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(10);

      // The widest level (bottom) should be 1000
      const lastShape = result.shapes[result.shapes.length - 1];
      expect(lastShape.width).toBe(1000);

      // The narrowest level (top) should be 100
      expect(result.shapes[0].width).toBe(100);
    });
  });
});
