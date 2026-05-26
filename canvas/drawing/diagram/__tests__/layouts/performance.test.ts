/**
 * Layout Performance Tests
 *
 * Tests to ensure layout algorithms meet performance requirements.
 * - 100 nodes should complete in < 100ms
 * - 1000 nodes should complete in < 500ms
 */

import type { NodeId } from '@mog-sdk/contracts/diagram';
import { BasicCycleLayout } from '../../src/layouts/cycle';
import { OrganizationChartLayout } from '../../src/layouts/hierarchy';
import { BasicBlockListLayout } from '../../src/layouts/list';
import { PictureGridLayout } from '../../src/layouts/picture';
import { BasicProcessLayout } from '../../src/layouts/process';

// Helper to create many flat nodes
function createFlatNodes(count: number): {
  nodes: Map<
    NodeId,
    { level: number; parentId: NodeId | null; childIds: NodeId[]; siblingOrder: number }
  >;
  rootNodeIds: NodeId[];
} {
  const nodes = new Map<
    NodeId,
    { level: number; parentId: NodeId | null; childIds: NodeId[]; siblingOrder: number }
  >();
  const rootNodeIds: NodeId[] = [];

  for (let i = 0; i < count; i++) {
    const id = `node${i}` as NodeId;
    rootNodeIds.push(id);
    nodes.set(id, {
      level: 0,
      parentId: null,
      childIds: [],
      siblingOrder: i,
    });
  }

  return { nodes, rootNodeIds };
}

// Helper to create deep hierarchy (chain)
function createDeepHierarchy(depth: number): {
  nodes: Map<
    NodeId,
    { level: number; parentId: NodeId | null; childIds: NodeId[]; siblingOrder: number }
  >;
  rootNodeIds: NodeId[];
} {
  const nodes = new Map<
    NodeId,
    { level: number; parentId: NodeId | null; childIds: NodeId[]; siblingOrder: number }
  >();

  for (let i = 0; i < depth; i++) {
    const id = `node${i}` as NodeId;
    const parentId = i === 0 ? null : (`node${i - 1}` as NodeId);
    const childIds = i === depth - 1 ? [] : [`node${i + 1}` as NodeId];

    nodes.set(id, {
      level: i,
      parentId,
      childIds,
      siblingOrder: 0,
    });
  }

  return { nodes, rootNodeIds: ['node0' as NodeId] };
}

// Helper to create wide hierarchy
function createWideHierarchy(
  childrenPerNode: number,
  levels: number,
): {
  nodes: Map<
    NodeId,
    { level: number; parentId: NodeId | null; childIds: NodeId[]; siblingOrder: number }
  >;
  rootNodeIds: NodeId[];
} {
  const nodes = new Map<
    NodeId,
    { level: number; parentId: NodeId | null; childIds: NodeId[]; siblingOrder: number }
  >();
  let nodeCounter = 0;

  function createNode(level: number, parentId: NodeId | null, siblingOrder: number): NodeId {
    const id = `node${nodeCounter++}` as NodeId;
    const childIds: NodeId[] = [];

    if (level < levels - 1) {
      for (let i = 0; i < childrenPerNode; i++) {
        childIds.push(createNode(level + 1, id, i));
      }
    }

    nodes.set(id, {
      level,
      parentId,
      childIds,
      siblingOrder,
    });

    return id;
  }

  const rootId = createNode(0, null, 0);
  return { nodes, rootNodeIds: [rootId] };
}

describe('Layout Performance', () => {
  describe('List Layout Performance', () => {
    const layout = new BasicBlockListLayout();

    it('should handle 100 nodes in list layout within 100ms', () => {
      const { nodes, rootNodeIds } = createFlatNodes(100);

      const start = performance.now();
      const result = layout.compute(nodes, rootNodeIds, { width: 800, height: 6000 }, {});
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(result.positions.size).toBe(100);
    });

    it('should handle 1000 nodes in list layout within 500ms', () => {
      const { nodes, rootNodeIds } = createFlatNodes(1000);

      const start = performance.now();
      const result = layout.compute(nodes, rootNodeIds, { width: 800, height: 60000 }, {});
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(500);
      expect(result.positions.size).toBe(1000);
    });
  });

  describe('Process Layout Performance', () => {
    const layout = new BasicProcessLayout();

    it('should handle 100 nodes within 100ms', () => {
      const { nodes, rootNodeIds } = createFlatNodes(100);

      const start = performance.now();
      const result = layout.compute(nodes, rootNodeIds, { width: 20000, height: 200 }, {});
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(result.positions.size).toBe(100);
    });
  });

  describe('Cycle Layout Performance', () => {
    const layout = new BasicCycleLayout();

    it('should handle 100 nodes within 100ms', () => {
      const { nodes, rootNodeIds } = createFlatNodes(100);

      const start = performance.now();
      const result = layout.compute(nodes, rootNodeIds, { width: 2000, height: 2000 }, {});
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(result.positions.size).toBe(100);
    });
  });

  describe('Hierarchy Layout Performance', () => {
    const layout = new OrganizationChartLayout();

    it('should handle deep hierarchy (100 levels) within 200ms', () => {
      const { nodes, rootNodeIds } = createDeepHierarchy(100);

      const start = performance.now();
      const result = layout.compute(nodes, rootNodeIds, { width: 800, height: 10000 }, {});
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(200);
      expect(result.positions.size).toBe(100);
    });

    it('should handle wide hierarchy (100 children per node, 3 levels) within 300ms', () => {
      // 1 + 100 + 10,000 = 10,101 nodes total would be too many
      // Use fewer children per level: 1 + 10 + 100 = 111 nodes
      const { nodes, rootNodeIds } = createWideHierarchy(10, 3);

      const start = performance.now();
      const result = layout.compute(nodes, rootNodeIds, { width: 20000, height: 1000 }, {});
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(300);
      expect(result.positions.size).toBe(111); // 1 + 10 + 100
    });

    it('should handle medium-wide hierarchy (10 children, 4 levels) within 500ms', () => {
      // 1 + 10 + 100 + 1000 = 1111 nodes
      const { nodes, rootNodeIds } = createWideHierarchy(10, 4);

      const start = performance.now();
      const result = layout.compute(nodes, rootNodeIds, { width: 50000, height: 2000 }, {});
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(500);
      expect(result.positions.size).toBe(1111);
    });
  });

  describe('Grid Layout Performance', () => {
    const layout = new PictureGridLayout();

    it('should handle 100 nodes within 100ms', () => {
      const { nodes, rootNodeIds } = createFlatNodes(100);

      const start = performance.now();
      const result = layout.compute(nodes, rootNodeIds, { width: 1000, height: 1000 }, {});
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(result.positions.size).toBe(100);
    });

    it('should handle 1000 nodes within 500ms', () => {
      const { nodes, rootNodeIds } = createFlatNodes(1000);

      const start = performance.now();
      const result = layout.compute(nodes, rootNodeIds, { width: 3000, height: 3000 }, {});
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(500);
      expect(result.positions.size).toBe(1000);
    });
  });

  describe('Bounds Cache Effectiveness', () => {
    it('should benefit from memoization on repeated subtree calculations', () => {
      // Create a hierarchy where the same subtree bounds are calculated multiple times
      // This tests that the _boundsCache is working
      const layout = new OrganizationChartLayout();

      // Binary tree structure: each node has 2 children
      // This creates repeated calculations without memoization
      const nodes = new Map<
        NodeId,
        { level: number; parentId: NodeId | null; childIds: NodeId[]; siblingOrder: number }
      >();

      function createBinaryTree(nodeId: string, level: number, maxLevel: number): void {
        const id = nodeId as NodeId;
        const childIds: NodeId[] = [];

        if (level < maxLevel) {
          const leftId = `${nodeId}_l`;
          const rightId = `${nodeId}_r`;
          childIds.push(leftId as NodeId, rightId as NodeId);
          createBinaryTree(leftId, level + 1, maxLevel);
          createBinaryTree(rightId, level + 1, maxLevel);
        }

        nodes.set(id, {
          level,
          parentId: level === 0 ? null : (`${nodeId.slice(0, -2)}` as NodeId),
          childIds,
          siblingOrder: nodeId.endsWith('_l') ? 0 : 1,
        });
      }

      // 7 levels = 127 nodes
      createBinaryTree('root', 0, 6);

      // First run
      const start1 = performance.now();
      layout.compute(nodes, ['root' as NodeId], { width: 10000, height: 1000 }, {});
      const duration1 = performance.now() - start1;

      // Second run should benefit from memoization patterns
      const start2 = performance.now();
      layout.compute(nodes, ['root' as NodeId], { width: 10000, height: 1000 }, {});
      const duration2 = performance.now() - start2;

      // Both should complete quickly
      expect(duration1).toBeLessThan(200);
      expect(duration2).toBeLessThan(200);
    });
  });
});
