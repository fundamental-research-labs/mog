/**
 * Tests for the Composite Layout Algorithm.
 *
 * The composite algorithm positions children using constraint-resolved values.
 * Each child's position is determined by its constraint values (l, t, w, h).
 *
 * Tests verify:
 * - Basic positioning from constraints
 * - Default positioning when constraints are missing
 * - Center-based positioning (ctrX, ctrY)
 * - Aspect ratio enforcement
 * - Multiple children with different constraints
 * - Hidden geometry handling
 * - Shape type resolution
 * - Used bounds calculation
 * - Edge cases (no children, empty constraints, etc.)
 */

import type {
  AlgorithmContext,
  LayoutNodeInstance,
} from '../../../src/engine/algorithms/algorithm-types';
import {
  CompositeAlgorithm,
  createCompositeAlgorithm,
} from '../../../src/engine/algorithms/composite';
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

function makeContext(overrides: Partial<AlgorithmContext> = {}): AlgorithmContext {
  const defaultConstraints: ResolvedConstraints = {
    values: new Map(),
  };

  return {
    node: makeNode({ name: 'composite1' }),
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

function makeChild(name: string, overrides: Partial<LayoutNodeInstance> = {}): LayoutNodeInstance {
  return makeNode({
    name,
    shape: { type: 'rect' },
    ...overrides,
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('CompositeAlgorithm', () => {
  let algo: CompositeAlgorithm;

  beforeEach(() => {
    algo = new CompositeAlgorithm();
  });

  // ==========================================================================
  // Type
  // ==========================================================================

  describe('type', () => {
    it('should have type "composite"', () => {
      expect(algo.type).toBe('composite');
    });
  });

  // ==========================================================================
  // No children
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

    it('should return parent bounds as usedBounds when no children', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      expect(result.usedBounds).toEqual({ width: 1000, height: 800 });
    });
  });

  // ==========================================================================
  // Basic positioning from constraints
  // ==========================================================================

  describe('basic positioning from constraints', () => {
    it('should position a single child using l, t, w, h constraints', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:l', 100],
          ['child1:t', 50],
          ['child1:w', 200],
          ['child1:h', 150],
        ]),
      };
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].x).toBe(100);
      expect(result.shapes[0].y).toBe(50);
      expect(result.shapes[0].width).toBe(200);
      expect(result.shapes[0].height).toBe(150);
    });

    it('should position multiple children from constraints', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:l', 0],
          ['child1:t', 0],
          ['child1:w', 400],
          ['child1:h', 300],
          ['child2:l', 500],
          ['child2:t', 0],
          ['child2:w', 400],
          ['child2:h', 300],
        ]),
      };
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1'), makeChild('child2')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(2);

      expect(result.shapes[0].x).toBe(0);
      expect(result.shapes[0].y).toBe(0);
      expect(result.shapes[0].width).toBe(400);
      expect(result.shapes[0].height).toBe(300);

      expect(result.shapes[1].x).toBe(500);
      expect(result.shapes[1].y).toBe(0);
      expect(result.shapes[1].width).toBe(400);
      expect(result.shapes[1].height).toBe(300);
    });

    it('should handle children with only width and height constraints', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:w', 300],
          ['child1:h', 200],
        ]),
      };
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].x).toBe(0); // default
      expect(result.shapes[0].y).toBe(0); // default
      expect(result.shapes[0].width).toBe(300);
      expect(result.shapes[0].height).toBe(200);
    });

    it('should handle children with only position constraints', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:l', 50],
          ['child1:t', 25],
        ]),
      };
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].x).toBe(50);
      expect(result.shapes[0].y).toBe(25);
      expect(result.shapes[0].width).toBe(1000); // parent width
      expect(result.shapes[0].height).toBe(800); // parent height
    });
  });

  // ==========================================================================
  // Default positioning
  // ==========================================================================

  describe('default positioning', () => {
    it('should default position to (0,0) when no constraints', () => {
      const ctx = makeContext({
        children: [makeChild('child1')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].x).toBe(0);
      expect(result.shapes[0].y).toBe(0);
    });

    it('should default size to parent bounds when no constraints', () => {
      const ctx = makeContext({
        children: [makeChild('child1')],
        bounds: { width: 500, height: 400 },
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].width).toBe(500);
      expect(result.shapes[0].height).toBe(400);
    });
  });

  // ==========================================================================
  // Center-based positioning
  // ==========================================================================

  describe('center-based positioning', () => {
    it('should position using ctrX and ctrY', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:ctrX', 500],
          ['child1:ctrY', 400],
          ['child1:w', 200],
          ['child1:h', 100],
        ]),
      };
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      // ctrX=500, w=200 -> x = 500 - 100 = 400
      expect(result.shapes[0].x).toBe(400);
      // ctrY=400, h=100 -> y = 400 - 50 = 350
      expect(result.shapes[0].y).toBe(350);
    });

    it('should position using ctrX only (ctrY defaults)', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:ctrX', 300],
          ['child1:w', 100],
          ['child1:h', 100],
        ]),
      };
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].x).toBe(250); // 300 - 50
      expect(result.shapes[0].y).toBe(0); // default, no ctrY
    });
  });

  // ==========================================================================
  // Aspect ratio
  // ==========================================================================

  describe('aspect ratio', () => {
    it('should enforce aspect ratio - shrink width', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:l', 0],
          ['child1:t', 0],
          ['child1:w', 400],
          ['child1:h', 200],
        ]),
      };
      // ar = 1.0 means square, so 400x200 becomes 200x200
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1')],
        params: new Map([['ar', '1.0']]),
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].width).toBe(200);
      expect(result.shapes[0].height).toBe(200);
    });

    it('should enforce aspect ratio - shrink height', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:l', 0],
          ['child1:t', 0],
          ['child1:w', 200],
          ['child1:h', 400],
        ]),
      };
      // ar = 1.0 means square, so 200x400 becomes 200x200
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1')],
        params: new Map([['ar', '1.0']]),
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].width).toBe(200);
      expect(result.shapes[0].height).toBe(200);
    });

    it('should not change shape when aspect ratio already matches', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:l', 0],
          ['child1:t', 0],
          ['child1:w', 400],
          ['child1:h', 200],
        ]),
      };
      // ar = 2.0 already matches 400/200
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1')],
        params: new Map([['ar', '2.0']]),
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].width).toBe(400);
      expect(result.shapes[0].height).toBe(200);
    });

    it('should handle aspect ratio > 1 (wider)', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:w', 100],
          ['child1:h', 100],
        ]),
      };
      // ar = 2.0 means 2:1, 100x100 should become 100x50
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1')],
        params: new Map([['ar', '2.0']]),
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].width).toBe(100);
      expect(result.shapes[0].height).toBe(50);
    });

    it('should handle aspect ratio < 1 (taller)', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:w', 100],
          ['child1:h', 100],
        ]),
      };
      // ar = 0.5 means 1:2, 100x100 should become 50x100
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1')],
        params: new Map([['ar', '0.5']]),
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].width).toBe(50);
      expect(result.shapes[0].height).toBe(100);
    });

    it('should not apply aspect ratio when param is missing', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:w', 400],
          ['child1:h', 200],
        ]),
      };
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].width).toBe(400);
      expect(result.shapes[0].height).toBe(200);
    });
  });

  // ==========================================================================
  // Shape type resolution
  // ==========================================================================

  describe('shape type resolution', () => {
    it('should use the shape type from the child node', () => {
      const ctx = makeContext({
        children: [makeChild('child1', { shape: { type: 'roundRect' } })],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].shapeType).toBe('roundRect');
    });

    it('should default to "rect" when no shape type is specified', () => {
      const ctx = makeContext({
        children: [makeChild('child1', { shape: undefined })],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].shapeType).toBe('rect');
    });

    it('should handle ellipse shape type', () => {
      const ctx = makeContext({
        children: [makeChild('child1', { shape: { type: 'ellipse' } })],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].shapeType).toBe('ellipse');
    });
  });

  // ==========================================================================
  // Style labels
  // ==========================================================================

  describe('style labels', () => {
    it('should pass through style labels from children', () => {
      const ctx = makeContext({
        children: [makeChild('child1', { styleLbl: 'node1' })],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].styleLbl).toBe('node1');
    });

    it('should handle children without style labels', () => {
      const ctx = makeContext({
        children: [makeChild('child1')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].styleLbl).toBeUndefined();
    });
  });

  // ==========================================================================
  // Text content
  // ==========================================================================

  describe('text content', () => {
    it('should pass through text from data points', () => {
      const ctx = makeContext({
        children: [makeChild('child1', { text: 'Hello World' })],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].text).toBe('Hello World');
    });

    it('should handle children without text', () => {
      const ctx = makeContext({
        children: [makeChild('child1')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].text).toBeUndefined();
    });
  });

  // ==========================================================================
  // Model IDs
  // ==========================================================================

  describe('model IDs', () => {
    it('should pass through data point IDs', () => {
      const ctx = makeContext({
        children: [makeChild('child1', { dataPointId: 'dp-1' })],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].modelId).toBe('dp-1');
    });

    it('should handle children without data point IDs', () => {
      const ctx = makeContext({
        children: [makeChild('child1')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].modelId).toBeUndefined();
    });
  });

  // ==========================================================================
  // Hidden geometry
  // ==========================================================================

  describe('hidden geometry', () => {
    it('should skip children with hidden geometry and no text', () => {
      const ctx = makeContext({
        children: [makeChild('child1', { shape: { type: 'rect', hideGeom: true } })],
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(0);
    });

    it('should include children with hidden geometry but with text', () => {
      const ctx = makeContext({
        children: [
          makeChild('child1', {
            shape: { type: 'rect', hideGeom: true },
            text: 'Some text',
          }),
        ],
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Used bounds
  // ==========================================================================

  describe('used bounds', () => {
    it('should compute used bounds from shape positions', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:l', 100],
          ['child1:t', 50],
          ['child1:w', 300],
          ['child1:h', 200],
          ['child2:l', 500],
          ['child2:t', 100],
          ['child2:w', 400],
          ['child2:h', 250],
        ]),
      };
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1'), makeChild('child2')],
      });
      const result = algo.compute(ctx);
      // maxRight = max(100+300, 500+400) = 900
      // maxBottom = max(50+200, 100+250) = 350
      expect(result.usedBounds.width).toBe(900);
      expect(result.usedBounds.height).toBe(350);
    });

    it('should return parent bounds when no children produce shapes', () => {
      const ctx = makeContext({
        children: [makeChild('child1', { shape: { type: 'rect', hideGeom: true } })],
      });
      const result = algo.compute(ctx);
      expect(result.usedBounds).toEqual({ width: 1000, height: 800 });
    });
  });

  // ==========================================================================
  // Adjustments
  // ==========================================================================

  describe('shape adjustments', () => {
    it('should pass through shape adjustments', () => {
      const adjustments = new Map([
        ['adj', 0.25],
        ['adj1', 0.5],
      ]);
      const ctx = makeContext({
        children: [makeChild('child1', { shape: { type: 'roundRect', adjustments } })],
      });
      const result = algo.compute(ctx);
      expect(result.shapes[0].adjustments).toBe(adjustments);
    });
  });

  // ==========================================================================
  // createCompositeAlgorithm factory
  // ==========================================================================

  describe('createCompositeAlgorithm', () => {
    it('should create a CompositeAlgorithm instance', () => {
      const algo = createCompositeAlgorithm();
      expect(algo).toBeInstanceOf(CompositeAlgorithm);
    });

    it('should have correct type', () => {
      const algo = createCompositeAlgorithm();
      expect(algo.type).toBe('composite');
    });
  });

  // ==========================================================================
  // Multiple children layout
  // ==========================================================================

  describe('multiple children layout', () => {
    it('should handle 4 quadrant layout', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['tl:l', 0],
          ['tl:t', 0],
          ['tl:w', 500],
          ['tl:h', 400],
          ['tr:l', 500],
          ['tr:t', 0],
          ['tr:w', 500],
          ['tr:h', 400],
          ['bl:l', 0],
          ['bl:t', 400],
          ['bl:w', 500],
          ['bl:h', 400],
          ['br:l', 500],
          ['br:t', 400],
          ['br:w', 500],
          ['br:h', 400],
        ]),
      };
      const ctx = makeContext({
        constraints,
        children: [makeChild('tl'), makeChild('tr'), makeChild('bl'), makeChild('br')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(4);

      // Top-left
      expect(result.shapes[0].x).toBe(0);
      expect(result.shapes[0].y).toBe(0);
      expect(result.shapes[0].width).toBe(500);

      // Top-right
      expect(result.shapes[1].x).toBe(500);
      expect(result.shapes[1].y).toBe(0);

      // Bottom-left
      expect(result.shapes[2].x).toBe(0);
      expect(result.shapes[2].y).toBe(400);

      // Bottom-right
      expect(result.shapes[3].x).toBe(500);
      expect(result.shapes[3].y).toBe(400);
    });

    it('should handle overlapping children', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['child1:l', 0],
          ['child1:t', 0],
          ['child1:w', 600],
          ['child1:h', 400],
          ['child2:l', 400],
          ['child2:t', 200],
          ['child2:w', 600],
          ['child2:h', 400],
        ]),
      };
      const ctx = makeContext({
        constraints,
        children: [makeChild('child1'), makeChild('child2')],
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(2);
      // Overlapping is fine - composite doesn't prevent it
    });

    it('should handle children without names', () => {
      const ctx = makeContext({
        children: [makeNode({ shape: { type: 'rect' } }), makeNode({ shape: { type: 'rect' } })],
      });
      const result = algo.compute(ctx);
      // Children without names use default positioning
      expect(result.shapes).toHaveLength(2);
    });
  });

  // ==========================================================================
  // Connectors
  // ==========================================================================

  describe('connectors', () => {
    it('should always return empty connectors', () => {
      const ctx = makeContext({
        children: [makeChild('child1'), makeChild('child2')],
      });
      const result = algo.compute(ctx);
      expect(result.connectors).toEqual([]);
    });
  });
});
