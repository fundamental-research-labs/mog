/**
 * Tests for the Space Layout Algorithm.
 *
 * The space algorithm is the simplest: it allocates space but renders nothing.
 * Tests verify:
 * - Empty shapes and connectors output
 * - usedBounds from constraints (w, h)
 * - usedBounds fallback to parent bounds
 * - Correct algorithm type
 * - Handling of various constraint combinations
 */

import type { AlgorithmContext } from '../../../src/engine/algorithms/algorithm-types';
import { SpaceAlgorithm, createSpaceAlgorithm } from '../../../src/engine/algorithms/space';
import type { ResolvedConstraints } from '../../../src/engine/constraints/constraint-evaluator';

// =============================================================================
// Helpers
// =============================================================================

function makeContext(overrides: Partial<AlgorithmContext> = {}): AlgorithmContext {
  const defaultConstraints: ResolvedConstraints = {
    values: new Map(),
  };

  return {
    node: {
      name: 'space1',
      constraints: [],
      rules: [],
      children: [],
    },
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

// =============================================================================
// Tests
// =============================================================================

describe('SpaceAlgorithm', () => {
  let algo: SpaceAlgorithm;

  beforeEach(() => {
    algo = new SpaceAlgorithm();
  });

  // ==========================================================================
  // Type
  // ==========================================================================

  describe('type', () => {
    it('should have type "sp"', () => {
      expect(algo.type).toBe('sp');
    });
  });

  // ==========================================================================
  // Empty output
  // ==========================================================================

  describe('empty output', () => {
    it('should return empty shapes array', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      expect(result.shapes).toEqual([]);
    });

    it('should return empty connectors array', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      expect(result.connectors).toEqual([]);
    });

    it('should always return empty shapes regardless of children', () => {
      const ctx = makeContext({
        children: [
          { name: 'child1', constraints: [], rules: [], children: [] },
          { name: 'child2', constraints: [], rules: [], children: [] },
        ],
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toEqual([]);
    });

    it('should always return empty connectors regardless of children', () => {
      const ctx = makeContext({
        children: [{ name: 'child1', constraints: [], rules: [], children: [] }],
      });
      const result = algo.compute(ctx);
      expect(result.connectors).toEqual([]);
    });
  });

  // ==========================================================================
  // usedBounds from constraints
  // ==========================================================================

  describe('usedBounds from constraints', () => {
    it('should use w and h from resolved constraints', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['w', 200],
          ['h', 150],
        ]),
      };
      const ctx = makeContext({ constraints });
      const result = algo.compute(ctx);
      expect(result.usedBounds).toEqual({ width: 200, height: 150 });
    });

    it('should use only w from constraints and h from bounds', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([['w', 300]]),
      };
      const ctx = makeContext({ constraints });
      const result = algo.compute(ctx);
      expect(result.usedBounds).toEqual({ width: 300, height: 800 });
    });

    it('should use only h from constraints and w from bounds', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([['h', 100]]),
      };
      const ctx = makeContext({ constraints });
      const result = algo.compute(ctx);
      expect(result.usedBounds).toEqual({ width: 1000, height: 100 });
    });

    it('should fallback to parent bounds when no constraints', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      expect(result.usedBounds).toEqual({ width: 1000, height: 800 });
    });

    it('should handle zero-size constraints', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['w', 0],
          ['h', 0],
        ]),
      };
      const ctx = makeContext({ constraints });
      const result = algo.compute(ctx);
      expect(result.usedBounds).toEqual({ width: 0, height: 0 });
    });

    it('should handle very small constraints', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['w', 0.5],
          ['h', 0.25],
        ]),
      };
      const ctx = makeContext({ constraints });
      const result = algo.compute(ctx);
      expect(result.usedBounds.width).toBeCloseTo(0.5);
      expect(result.usedBounds.height).toBeCloseTo(0.25);
    });

    it('should handle large constraints', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['w', 10000],
          ['h', 5000],
        ]),
      };
      const ctx = makeContext({ constraints });
      const result = algo.compute(ctx);
      expect(result.usedBounds).toEqual({ width: 10000, height: 5000 });
    });
  });

  // ==========================================================================
  // createSpaceAlgorithm factory
  // ==========================================================================

  describe('createSpaceAlgorithm', () => {
    it('should create a SpaceAlgorithm instance', () => {
      const algo = createSpaceAlgorithm();
      expect(algo).toBeInstanceOf(SpaceAlgorithm);
    });

    it('should have correct type', () => {
      const algo = createSpaceAlgorithm();
      expect(algo.type).toBe('sp');
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should ignore non-dimensional constraints', () => {
      const constraints: ResolvedConstraints = {
        values: new Map([
          ['l', 50],
          ['t', 30],
          ['w', 200],
          ['h', 150],
          ['primFontSz', 12],
          ['sp', 10],
        ]),
      };
      const ctx = makeContext({ constraints });
      const result = algo.compute(ctx);
      // Only w and h should be used
      expect(result.usedBounds).toEqual({ width: 200, height: 150 });
    });

    it('should work with different parent bounds', () => {
      const ctx = makeContext({ bounds: { width: 500, height: 300 } });
      const result = algo.compute(ctx);
      expect(result.usedBounds).toEqual({ width: 500, height: 300 });
    });
  });
});
