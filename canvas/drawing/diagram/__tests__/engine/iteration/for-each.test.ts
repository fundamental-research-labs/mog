/**
 * Comprehensive tests for the ForEach executor.
 *
 * Tests:
 * - Simple iteration over children
 * - ptType filtering during iteration
 * - Nested forEach (narrowed context)
 * - ref attribute (reuse another forEach's definition)
 * - cnt, st, step subsequence parameters
 * - hideLastTrans during iteration
 * - Empty data (no matching points)
 * - Single point iteration
 * - Iteration context correctness (position, count, depth)
 * - PresOf mapper: self, child, descendant, empty mappings
 */

import {
  DataModel,
  DataModelConnection,
  DataModelPoint,
  PointType,
} from '../../../src/engine/data-model';

import { executeForEach, ForEachRegistry } from '../../../src/engine/iteration/for-each';

import {
  createDefaultPresOfSpec,
  resolvePresOf,
} from '../../../src/engine/iteration/pres-of-mapper';

import type { IterationContext, LayoutNodeChildRef } from '@mog-sdk/contracts/diagram';

import { createDefaultForEach, createDefaultVariableList } from '../../../src/ooxml-engine-runtime';

// ============================================================================
// Test Helpers
// ============================================================================

function pt(modelId: string, type: PointType, text: string = ''): DataModelPoint {
  return { modelId, type, text };
}

function parOf(
  modelId: string,
  srcId: string,
  destId: string,
  srcOrd: number,
): DataModelConnection {
  return { modelId, type: 'parOf', srcId, destId, srcOrd, destOrd: 0 };
}

function layoutNodeRef(name: string): LayoutNodeChildRef {
  return { kind: 'layoutNode', name };
}

function createContext(overrides?: Partial<IterationContext>): IterationContext {
  return {
    currentPoint: overrides?.currentPoint ?? '0',
    position: overrides?.position ?? 1,
    count: overrides?.count ?? 1,
    depth: overrides?.depth ?? 0,
    variables: overrides?.variables ?? createDefaultVariableList(),
  };
}

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Standard list:
 * doc -> [A(node), B(node), C(node), D(node), E(node)]
 */
function createFlatList(): DataModel {
  return DataModel.fromPoints(
    [
      pt('0', 'doc', 'Root'),
      pt('A', 'node', 'A'),
      pt('B', 'node', 'B'),
      pt('C', 'node', 'C'),
      pt('D', 'node', 'D'),
      pt('E', 'node', 'E'),
    ],
    [
      parOf('c1', '0', 'A', 0),
      parOf('c2', '0', 'B', 1),
      parOf('c3', '0', 'C', 2),
      parOf('c4', '0', 'D', 3),
      parOf('c5', '0', 'E', 4),
    ],
  );
}

/**
 * Hierarchy with mixed types:
 * doc -> [n1(node), st1(sibTrans), n2(node), st2(sibTrans), n3(node)]
 * n1 -> [n1a(node), n1b(node)]
 */
function createMixedHierarchy(): DataModel {
  return DataModel.fromPoints(
    [
      pt('0', 'doc', 'Root'),
      pt('n1', 'node', 'Node1'),
      pt('st1', 'sibTrans', 'Trans1'),
      pt('n2', 'node', 'Node2'),
      pt('st2', 'sibTrans', 'Trans2'),
      pt('n3', 'node', 'Node3'),
      pt('n1a', 'node', 'Node1a'),
      pt('n1b', 'node', 'Node1b'),
    ],
    [
      parOf('c1', '0', 'n1', 0),
      parOf('c2', '0', 'st1', 1),
      parOf('c3', '0', 'n2', 2),
      parOf('c4', '0', 'st2', 3),
      parOf('c5', '0', 'n3', 4),
      parOf('c6', 'n1', 'n1a', 0),
      parOf('c7', 'n1', 'n1b', 1),
    ],
  );
}

/**
 * Org chart with assistant:
 * doc -> boss(node) -> [asst(asst), vp1(node), vp2(node)]
 */
function createOrgChart(): DataModel {
  return DataModel.fromPoints(
    [
      pt('0', 'doc', 'Root'),
      pt('boss', 'node', 'Boss'),
      pt('asst', 'asst', 'Assistant'),
      pt('vp1', 'node', 'VP1'),
      pt('vp2', 'node', 'VP2'),
    ],
    [
      parOf('c1', '0', 'boss', 0),
      parOf('c2', 'boss', 'asst', 0),
      parOf('c3', 'boss', 'vp1', 1),
      parOf('c4', 'boss', 'vp2', 2),
    ],
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('ForEach Executor', () => {
  const variables = createDefaultVariableList();
  const childNode = layoutNodeRef('childLayout');

  // ==========================================================================
  // Simple Iteration
  // ==========================================================================

  describe('simple iteration', () => {
    it('should iterate over all children', () => {
      const dm = createFlatList();
      const forEach = createDefaultForEach({
        axis: 'ch',
        ptType: 'all',
        children: [childNode],
      });

      const root = dm.getRoot();
      const parentCtx = createContext();

      const result = executeForEach(forEach, dm, root, parentCtx, variables);
      expect(result.iterations).toHaveLength(5);
      expect(result.iterations.map((i) => i.dataPoint.modelId)).toEqual(['A', 'B', 'C', 'D', 'E']);
    });

    it('should set correct position for each iteration', () => {
      const dm = createFlatList();
      const forEach = createDefaultForEach({
        axis: 'ch',
        children: [childNode],
      });

      const root = dm.getRoot();
      const parentCtx = createContext();
      const result = executeForEach(forEach, dm, root, parentCtx, variables);

      expect(result.iterations.map((i) => i.context.position)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should set correct count for each iteration', () => {
      const dm = createFlatList();
      const forEach = createDefaultForEach({
        axis: 'ch',
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      // All iterations should have the same count (total matched points)
      expect(result.iterations.every((i) => i.context.count === 5)).toBe(true);
    });

    it('should set correct depth for each iteration', () => {
      const dm = createFlatList();
      const forEach = createDefaultForEach({
        axis: 'ch',
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      // All children of root are at depth 1
      expect(result.iterations.every((i) => i.context.depth === 1)).toBe(true);
    });

    it('should set currentPoint in context', () => {
      const dm = createFlatList();
      const forEach = createDefaultForEach({
        axis: 'ch',
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      expect(result.iterations.map((i) => i.context.currentPoint)).toEqual([
        'A',
        'B',
        'C',
        'D',
        'E',
      ]);
    });

    it('should include children template in each iteration', () => {
      const dm = createFlatList();
      const child1 = layoutNodeRef('shape1');
      const child2 = layoutNodeRef('shape2');

      const forEach = createDefaultForEach({
        axis: 'ch',
        children: [child1, child2],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      for (const iteration of result.iterations) {
        expect(iteration.children).toEqual([child1, child2]);
      }
    });
  });

  // ==========================================================================
  // ptType Filtering
  // ==========================================================================

  describe('ptType filtering', () => {
    it('should filter by node type', () => {
      const dm = createMixedHierarchy();
      const forEach = createDefaultForEach({
        axis: 'ch',
        ptType: 'node',
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      expect(result.iterations).toHaveLength(3); // n1, n2, n3
      expect(result.iterations.map((i) => i.dataPoint.modelId)).toEqual(['n1', 'n2', 'n3']);
    });

    it('should filter by sibTrans type', () => {
      const dm = createMixedHierarchy();
      const forEach = createDefaultForEach({
        axis: 'ch',
        ptType: 'sibTrans',
        hideLastTrans: false,
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      expect(result.iterations).toHaveLength(2); // st1, st2
    });

    it('should filter by asst type', () => {
      const dm = createOrgChart();
      const forEach = createDefaultForEach({
        axis: 'ch',
        ptType: 'asst',
        children: [childNode],
      });

      const boss = dm.getPoint('boss')!;
      const result = executeForEach(forEach, dm, boss, createContext(), variables);

      expect(result.iterations).toHaveLength(1);
      expect(result.iterations[0].dataPoint.modelId).toBe('asst');
    });

    it('should filter by multi-type "node asst"', () => {
      const dm = createOrgChart();
      const forEach = createDefaultForEach({
        axis: 'ch',
        ptType: 'node asst',
        children: [childNode],
      });

      const boss = dm.getPoint('boss')!;
      const result = executeForEach(forEach, dm, boss, createContext(), variables);

      expect(result.iterations).toHaveLength(3); // asst, vp1, vp2
    });

    it('should return position/count relative to filtered set', () => {
      const dm = createMixedHierarchy();
      const forEach = createDefaultForEach({
        axis: 'ch',
        ptType: 'node',
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      // 3 nodes after filtering, positions should be 1, 2, 3
      expect(result.iterations.map((i) => i.context.position)).toEqual([1, 2, 3]);
      expect(result.iterations.every((i) => i.context.count === 3)).toBe(true);
    });
  });

  // ==========================================================================
  // Subsequence Parameters (cnt, st, step)
  // ==========================================================================

  describe('subsequence parameters', () => {
    it('should limit with cnt', () => {
      const dm = createFlatList();
      const forEach = createDefaultForEach({
        axis: 'ch',
        cnt: 3,
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      expect(result.iterations).toHaveLength(3);
      expect(result.iterations.map((i) => i.dataPoint.modelId)).toEqual(['A', 'B', 'C']);
    });

    it('should start from st', () => {
      const dm = createFlatList();
      const forEach = createDefaultForEach({
        axis: 'ch',
        st: 3,
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      expect(result.iterations).toHaveLength(3); // C, D, E
      expect(result.iterations.map((i) => i.dataPoint.modelId)).toEqual(['C', 'D', 'E']);
    });

    it('should step over items', () => {
      const dm = createFlatList();
      const forEach = createDefaultForEach({
        axis: 'ch',
        step: 2,
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      expect(result.iterations.map((i) => i.dataPoint.modelId)).toEqual(['A', 'C', 'E']);
    });

    it('should combine st + step + cnt', () => {
      const dm = createFlatList();
      const forEach = createDefaultForEach({
        axis: 'ch',
        st: 2,
        step: 2,
        cnt: 2,
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      expect(result.iterations.map((i) => i.dataPoint.modelId)).toEqual(['B', 'D']);
    });

    it('should update count based on actual matched points after subsequence', () => {
      const dm = createFlatList();
      const forEach = createDefaultForEach({
        axis: 'ch',
        cnt: 3,
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      // Count reflects the actual number of matched items after subsequence
      expect(result.iterations.every((i) => i.context.count === 3)).toBe(true);
    });
  });

  // ==========================================================================
  // hideLastTrans
  // ==========================================================================

  describe('hideLastTrans', () => {
    it('should hide last sibTrans by default', () => {
      const dm = createMixedHierarchy();
      const forEach = createDefaultForEach({
        axis: 'ch',
        // hideLastTrans defaults to true
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      // Children: n1, st1, n2, st2, n3 — last is n3 (not sibTrans), so no removal
      // But hideLastTrans applies during navigation
      const pointIds = result.iterations.map((i) => i.dataPoint.modelId);
      expect(pointIds).toEqual(['n1', 'st1', 'n2', 'st2', 'n3']);
    });

    it('should NOT hide last sibTrans when hideLastTrans=false', () => {
      // Create a model where the last child IS a sibTrans
      const dm = DataModel.fromPoints(
        [pt('0', 'doc', 'Root'), pt('n1', 'node', 'N1'), pt('st1', 'sibTrans', 'T1')],
        [parOf('c1', '0', 'n1', 0), parOf('c2', '0', 'st1', 1)],
      );

      const forEachHide = createDefaultForEach({
        axis: 'ch',
        hideLastTrans: true,
        children: [childNode],
      });

      const forEachNoHide = createDefaultForEach({
        axis: 'ch',
        hideLastTrans: false,
        children: [childNode],
      });

      const root = dm.getRoot();

      const resultHide = executeForEach(forEachHide, dm, root, createContext(), variables);
      expect(resultHide.iterations.map((i) => i.dataPoint.modelId)).toEqual(['n1']);

      const resultNoHide = executeForEach(forEachNoHide, dm, root, createContext(), variables);
      expect(resultNoHide.iterations.map((i) => i.dataPoint.modelId)).toEqual(['n1', 'st1']);
    });
  });

  // ==========================================================================
  // Empty Data
  // ==========================================================================

  describe('empty data', () => {
    it('should return empty iterations for no children', () => {
      const dm = DataModel.fromPoints([pt('0', 'doc', 'Root')], []);

      const forEach = createDefaultForEach({
        axis: 'ch',
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      expect(result.iterations).toHaveLength(0);
    });

    it('should return empty when ptType matches nothing', () => {
      const dm = createFlatList();
      const forEach = createDefaultForEach({
        axis: 'ch',
        ptType: 'asst',
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      expect(result.iterations).toHaveLength(0);
    });

    it('should handle non-existent context point', () => {
      const dm = createFlatList();
      const forEach = createDefaultForEach({
        axis: 'ch',
        children: [childNode],
      });

      // Ghost point
      const ghostPoint: DataModelPoint = pt('ghost', 'node', 'Ghost');
      const result = executeForEach(forEach, dm, ghostPoint, createContext(), variables);

      expect(result.iterations).toHaveLength(0);
    });
  });

  // ==========================================================================
  // ref Attribute
  // ==========================================================================

  describe('ref attribute', () => {
    it('should reuse referenced forEach definition', () => {
      const dm = createFlatList();

      // Define a named forEach
      const namedForEach = createDefaultForEach({
        name: 'nodeIterator',
        axis: 'ch',
        ptType: 'node',
        children: [childNode],
      });

      // Create a ref forEach
      const refForEach = createDefaultForEach({
        ref: 'nodeIterator',
        // These would be ignored in favor of the referenced definition
      });

      const registry: ForEachRegistry = new Map([['nodeIterator', namedForEach]]);

      const root = dm.getRoot();
      const result = executeForEach(refForEach, dm, root, createContext(), variables, registry);

      expect(result.iterations).toHaveLength(5);
      expect(result.iterations[0].children).toEqual([childNode]);
    });

    it('should use original forEach when ref not found', () => {
      const dm = createFlatList();

      const forEach = createDefaultForEach({
        ref: 'nonexistent',
        axis: 'ch',
        ptType: 'node',
        children: [childNode],
      });

      // Empty registry
      const registry: ForEachRegistry = new Map();

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables, registry);

      // Falls back to original forEach definition
      expect(result.iterations).toHaveLength(5);
    });

    it('should use original forEach when no registry provided', () => {
      const dm = createFlatList();

      const forEach = createDefaultForEach({
        ref: 'someRef',
        axis: 'ch',
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      expect(result.iterations).toHaveLength(5);
    });
  });

  // ==========================================================================
  // Nested ForEach (Context Narrowing)
  // ==========================================================================

  describe('nested forEach', () => {
    it('should narrow context when iterating children of children', () => {
      const dm = createMixedHierarchy();

      // Outer forEach: iterate node children of root
      const outerForEach = createDefaultForEach({
        axis: 'ch',
        ptType: 'node',
        children: [childNode],
      });

      const root = dm.getRoot();
      const outerResult = executeForEach(outerForEach, dm, root, createContext(), variables);

      // n1 has children n1a, n1b
      // For n1, run inner forEach
      const innerForEach = createDefaultForEach({
        axis: 'ch',
        ptType: 'node',
        children: [layoutNodeRef('innerChild')],
      });

      const n1Iteration = outerResult.iterations[0];
      expect(n1Iteration.dataPoint.modelId).toBe('n1');

      const innerResult = executeForEach(
        innerForEach,
        dm,
        n1Iteration.dataPoint,
        n1Iteration.context,
        variables,
      );

      expect(innerResult.iterations).toHaveLength(2);
      expect(innerResult.iterations.map((i) => i.dataPoint.modelId)).toEqual(['n1a', 'n1b']);
      expect(innerResult.iterations[0].context.position).toBe(1);
      expect(innerResult.iterations[1].context.position).toBe(2);
      expect(innerResult.iterations[0].context.count).toBe(2);
    });

    it('should return empty for leaf node inner forEach', () => {
      const dm = createFlatList();

      const forEach = createDefaultForEach({
        axis: 'ch',
        children: [childNode],
      });

      // Iterate children of root, then for each try to iterate children
      const root = dm.getRoot();
      const outerResult = executeForEach(forEach, dm, root, createContext(), variables);

      // A has no children
      const innerResult = executeForEach(
        forEach,
        dm,
        outerResult.iterations[0].dataPoint,
        outerResult.iterations[0].context,
        variables,
      );

      expect(innerResult.iterations).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Axis Chaining
  // ==========================================================================

  describe('axis chaining in forEach', () => {
    it('should navigate grandchildren with "ch ch"', () => {
      const dm = createMixedHierarchy();

      const forEach = createDefaultForEach({
        axis: 'ch ch',
        ptType: 'node',
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      // Grandchildren of root through node filter: n1a, n1b
      expect(result.iterations.map((i) => i.dataPoint.modelId)).toEqual(['n1a', 'n1b']);
    });
  });

  // ==========================================================================
  // Single Point Iteration
  // ==========================================================================

  describe('single point iteration', () => {
    it('should handle single child', () => {
      const dm = DataModel.fromPoints(
        [pt('0', 'doc', 'Root'), pt('A', 'node', 'A')],
        [parOf('c1', '0', 'A', 0)],
      );

      const forEach = createDefaultForEach({
        axis: 'ch',
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      expect(result.iterations).toHaveLength(1);
      expect(result.iterations[0].context.position).toBe(1);
      expect(result.iterations[0].context.count).toBe(1);
    });

    it('should handle self axis (one iteration)', () => {
      const dm = createFlatList();

      const forEach = createDefaultForEach({
        axis: 'self',
        children: [childNode],
      });

      const root = dm.getRoot();
      const result = executeForEach(forEach, dm, root, createContext(), variables);

      expect(result.iterations).toHaveLength(1);
      expect(result.iterations[0].dataPoint.modelId).toBe('0');
    });
  });
});

// ============================================================================
// PresOf Mapper Tests
// ============================================================================

describe('PresOf Mapper', () => {
  function pt2(modelId: string, type: PointType, text: string = ''): DataModelPoint {
    return { modelId, type, text };
  }

  function parOf2(
    modelId: string,
    srcId: string,
    destId: string,
    srcOrd: number,
  ): DataModelConnection {
    return { modelId, type: 'parOf', srcId, destId, srcOrd, destOrd: 0 };
  }

  /**
   * doc -> [A, B, C]
   * A -> [A1, A2]
   */
  function createPresOfModel(): DataModel {
    return DataModel.fromPoints(
      [
        pt2('0', 'doc', 'Root'),
        pt2('A', 'node', 'A'),
        pt2('B', 'node', 'B'),
        pt2('C', 'node', 'C'),
        pt2('A1', 'node', 'A1'),
        pt2('A2', 'node', 'A2'),
      ],
      [
        parOf2('c1', '0', 'A', 0),
        parOf2('c2', '0', 'B', 1),
        parOf2('c3', '0', 'C', 2),
        parOf2('c4', 'A', 'A1', 0),
        parOf2('c5', 'A', 'A2', 1),
      ],
    );
  }

  describe('self mapping', () => {
    it('should map to self by default', () => {
      const dm = createPresOfModel();
      const contextPoint = dm.getPoint('A')!;
      const presOf = createDefaultPresOfSpec();

      const result = resolvePresOf(presOf, dm, contextPoint);
      expect(result).toHaveLength(1);
      expect(result[0].modelId).toBe('A');
    });

    it('should map to self with explicit axis="self"', () => {
      const dm = createPresOfModel();
      const contextPoint = dm.getPoint('B')!;
      const presOf = createDefaultPresOfSpec({ axis: 'self' });

      const result = resolvePresOf(presOf, dm, contextPoint);
      expect(result).toHaveLength(1);
      expect(result[0].modelId).toBe('B');
    });
  });

  describe('child mapping', () => {
    it('should map to children', () => {
      const dm = createPresOfModel();
      const contextPoint = dm.getPoint('A')!;
      const presOf = createDefaultPresOfSpec({ axis: 'ch' });

      const result = resolvePresOf(presOf, dm, contextPoint);
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.modelId)).toEqual(['A1', 'A2']);
    });

    it('should map to children with ptType filter', () => {
      const dm = DataModel.fromPoints(
        [
          pt2('0', 'doc', 'Root'),
          pt2('A', 'node', 'A'),
          pt2('B', 'asst', 'B'),
          pt2('C', 'node', 'C'),
        ],
        [parOf2('c1', '0', 'A', 0), parOf2('c2', '0', 'B', 1), parOf2('c3', '0', 'C', 2)],
      );

      const contextPoint = dm.getRoot();
      const presOf = createDefaultPresOfSpec({ axis: 'ch', ptType: 'node' });

      const result = resolvePresOf(presOf, dm, contextPoint);
      expect(result.map((p) => p.modelId)).toEqual(['A', 'C']);
    });
  });

  describe('descendant mapping', () => {
    it('should map to all descendants', () => {
      const dm = createPresOfModel();
      const contextPoint = dm.getRoot();
      const presOf = createDefaultPresOfSpec({ axis: 'des' });

      const result = resolvePresOf(presOf, dm, contextPoint);
      expect(result).toHaveLength(5); // A, A1, A2, B, C
    });
  });

  describe('empty mapping', () => {
    it('should return empty when no children', () => {
      const dm = createPresOfModel();
      const contextPoint = dm.getPoint('B')!;
      const presOf = createDefaultPresOfSpec({ axis: 'ch' });

      const result = resolvePresOf(presOf, dm, contextPoint);
      expect(result).toHaveLength(0);
    });

    it('should return empty for none axis', () => {
      const dm = createPresOfModel();
      const contextPoint = dm.getPoint('A')!;
      const presOf = createDefaultPresOfSpec({ axis: 'none' });

      const result = resolvePresOf(presOf, dm, contextPoint);
      expect(result).toHaveLength(0);
    });
  });

  describe('subsequence in presOf', () => {
    it('should apply cnt to limit results', () => {
      const dm = createPresOfModel();
      const contextPoint = dm.getRoot();
      const presOf = createDefaultPresOfSpec({ axis: 'ch', cnt: 2 });

      const result = resolvePresOf(presOf, dm, contextPoint);
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.modelId)).toEqual(['A', 'B']);
    });

    it('should apply st to start from offset', () => {
      const dm = createPresOfModel();
      const contextPoint = dm.getRoot();
      const presOf = createDefaultPresOfSpec({ axis: 'ch', st: 2 });

      const result = resolvePresOf(presOf, dm, contextPoint);
      expect(result.map((p) => p.modelId)).toEqual(['B', 'C']);
    });
  });

  describe('createDefaultPresOfSpec', () => {
    it('should create default spec', () => {
      const spec = createDefaultPresOfSpec();
      expect(spec.axis).toBe('self');
      expect(spec.ptType).toBe('all');
      expect(spec.cnt).toBe(0);
      expect(spec.st).toBe(1);
      expect(spec.step).toBe(1);
      expect(spec.hideLastTrans).toBe(true);
    });

    it('should accept overrides', () => {
      const spec = createDefaultPresOfSpec({
        axis: 'ch',
        ptType: 'node',
        cnt: 5,
      });
      expect(spec.axis).toBe('ch');
      expect(spec.ptType).toBe('node');
      expect(spec.cnt).toBe(5);
      expect(spec.st).toBe(1); // default
    });
  });
});
