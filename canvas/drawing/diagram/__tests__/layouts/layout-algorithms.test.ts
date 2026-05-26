/**
 * Layout Algorithm Tests
 *
 * Tests for individual Diagram layout algorithms.
 */

import type { NodeId } from '@mog-sdk/contracts/diagram';
import { BasicCycleLayout } from '../../src/layouts/cycle';
import { OrganizationChartLayout } from '../../src/layouts/hierarchy';
import { BasicBlockListLayout } from '../../src/layouts/list';
import { BasicMatrixLayout } from '../../src/layouts/matrix';
import { PictureGridLayout } from '../../src/layouts/picture';
import { BasicProcessLayout } from '../../src/layouts/process';
import { BasicPyramidLayout } from '../../src/layouts/pyramid';
import { BasicRadialLayout, BasicVennLayout } from '../../src/layouts/relationship';

// Helper to create node data
function createNodes(
  count: number,
  withHierarchy: boolean = false,
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

  if (withHierarchy) {
    // Create hierarchical structure
    const rootId = 'root' as NodeId;
    const childIds = Array.from(
      { length: Math.min(count - 1, 3) },
      (_, i) => `child${i}` as NodeId,
    );

    nodes.set(rootId, {
      level: 0,
      parentId: null,
      childIds,
      siblingOrder: 0,
    });

    childIds.forEach((childId, index) => {
      nodes.set(childId, {
        level: 1,
        parentId: rootId,
        childIds: [],
        siblingOrder: index,
      });
    });

    return { nodes, rootNodeIds: [rootId] };
  }

  // Create flat list
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

describe('BasicBlockListLayout', () => {
  const layout = new BasicBlockListLayout();

  it('should position nodes vertically with correct spacing', () => {
    const { nodes, rootNodeIds } = createNodes(3);

    const result = layout.compute(nodes, rootNodeIds, { width: 300, height: 400 }, {});

    expect(result.positions.size).toBe(3);
    expect(result.positions.get('node0' as NodeId)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 60,
      rotation: 0,
    });
    expect(result.positions.get('node1' as NodeId)!.y).toBe(70); // 60 + 10 spacing
    expect(result.positions.get('node2' as NodeId)!.y).toBe(140);
  });

  it('should handle empty node list', () => {
    const result = layout.compute(new Map(), [], { width: 300, height: 400 }, {});

    expect(result.positions.size).toBe(0);
    expect(result.connectors.length).toBe(0);
  });

  it('should handle single node', () => {
    const { nodes, rootNodeIds } = createNodes(1);

    const result = layout.compute(nodes, rootNodeIds, { width: 300, height: 400 }, {});

    expect(result.positions.size).toBe(1);
    expect(result.bounds.height).toBe(60);
  });

  it('should calculate bounds correctly', () => {
    const { nodes, rootNodeIds } = createNodes(5);

    const result = layout.compute(nodes, rootNodeIds, { width: 300, height: 400 }, {});

    // 5 nodes * 60 height + 4 gaps * 10 = 340
    expect(result.bounds.height).toBe(340);
  });
});

describe('BasicProcessLayout', () => {
  const layout = new BasicProcessLayout();

  it('should position nodes horizontally', () => {
    const { nodes, rootNodeIds } = createNodes(3);

    const result = layout.compute(nodes, rootNodeIds, { width: 500, height: 200 }, {});

    expect(result.positions.size).toBe(3);

    const pos0 = result.positions.get('node0' as NodeId)!;
    const pos1 = result.positions.get('node1' as NodeId)!;
    const pos2 = result.positions.get('node2' as NodeId)!;

    // Nodes should be in horizontal order
    expect(pos1.x).toBeGreaterThan(pos0.x);
    expect(pos2.x).toBeGreaterThan(pos1.x);

    // All nodes should be at same y
    expect(pos1.y).toBe(pos0.y);
    expect(pos2.y).toBe(pos0.y);
  });

  it('should create connectors between nodes', () => {
    const { nodes, rootNodeIds } = createNodes(3);

    const result = layout.compute(nodes, rootNodeIds, { width: 500, height: 200 }, {});

    expect(result.connectors.length).toBe(2);
    expect(result.connectors[0].fromId).toBe('node0');
    expect(result.connectors[0].toId).toBe('node1');
    expect(result.connectors[1].fromId).toBe('node1');
    expect(result.connectors[1].toId).toBe('node2');
  });
});

describe('BasicCycleLayout', () => {
  const layout = new BasicCycleLayout();

  it('should distribute nodes evenly around circle', () => {
    const { nodes, rootNodeIds } = createNodes(4);

    const result = layout.compute(nodes, rootNodeIds, { width: 400, height: 400 }, {});

    expect(result.positions.size).toBe(4);

    const centerX = 200;
    const centerY = 200;

    // Verify nodes are at roughly equal distances from center
    const positions = Array.from(result.positions.values());
    const distances = positions.map((pos) => {
      const dx = pos.x + pos.width / 2 - centerX;
      const dy = pos.y + pos.height / 2 - centerY;
      return Math.sqrt(dx * dx + dy * dy);
    });

    // All distances should be similar (within 5 pixels)
    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
    distances.forEach((d) => {
      expect(Math.abs(d - avgDistance)).toBeLessThan(5);
    });
  });

  it('should create circular connectors', () => {
    const { nodes, rootNodeIds } = createNodes(4);

    const result = layout.compute(nodes, rootNodeIds, { width: 400, height: 400 }, {});

    // 4 nodes = 4 connectors (closing the loop)
    expect(result.connectors.length).toBe(4);

    // Last connector should connect back to first node
    expect(result.connectors[3].toId).toBe('node0');
  });

  it('should handle minimum 2 nodes', () => {
    const { nodes, rootNodeIds } = createNodes(2);

    const result = layout.compute(nodes, rootNodeIds, { width: 400, height: 400 }, {});

    expect(result.positions.size).toBe(2);
    expect(result.connectors.length).toBe(2);
  });
});

describe('OrganizationChartLayout', () => {
  const layout = new OrganizationChartLayout();

  it('should position root above children', () => {
    const { nodes, rootNodeIds } = createNodes(4, true);

    const result = layout.compute(nodes, rootNodeIds, { width: 600, height: 400 }, {});

    const rootPos = result.positions.get('root' as NodeId)!;
    const childPos = result.positions.get('child0' as NodeId)!;

    expect(rootPos.y).toBeLessThan(childPos.y);
  });

  it('should create connectors from root to children', () => {
    const { nodes, rootNodeIds } = createNodes(4, true);

    const result = layout.compute(nodes, rootNodeIds, { width: 600, height: 400 }, {});

    expect(result.connectors.length).toBe(3); // 3 children
    result.connectors.forEach((conn) => {
      expect(conn.fromId).toBe('root');
    });
  });

  it('should handle deep hierarchy', () => {
    // Create 3-level hierarchy
    const nodes = new Map<
      NodeId,
      { level: number; parentId: NodeId | null; childIds: NodeId[]; siblingOrder: number }
    >();

    nodes.set('root' as NodeId, {
      level: 0,
      parentId: null,
      childIds: ['child0' as NodeId],
      siblingOrder: 0,
    });
    nodes.set('child0' as NodeId, {
      level: 1,
      parentId: 'root' as NodeId,
      childIds: ['grandchild0' as NodeId],
      siblingOrder: 0,
    });
    nodes.set('grandchild0' as NodeId, {
      level: 2,
      parentId: 'child0' as NodeId,
      childIds: [],
      siblingOrder: 0,
    });

    const result = layout.compute(nodes, ['root' as NodeId], { width: 600, height: 400 }, {});

    const rootPos = result.positions.get('root' as NodeId)!;
    const childPos = result.positions.get('child0' as NodeId)!;
    const grandchildPos = result.positions.get('grandchild0' as NodeId)!;

    // Verify vertical ordering
    expect(rootPos.y).toBeLessThan(childPos.y);
    expect(childPos.y).toBeLessThan(grandchildPos.y);

    // Verify connectors
    expect(result.connectors.length).toBe(2);
  });
});

describe('BasicVennLayout', () => {
  const layout = new BasicVennLayout();

  it('should limit to 5 circles', () => {
    const { nodes, rootNodeIds } = createNodes(10);

    const result = layout.compute(nodes, rootNodeIds, { width: 400, height: 400 }, {});

    expect(result.positions.size).toBeLessThanOrEqual(5);
  });

  it('should position 2 circles side by side', () => {
    const { nodes, rootNodeIds } = createNodes(2);

    const result = layout.compute(nodes, rootNodeIds, { width: 400, height: 400 }, {});

    expect(result.positions.size).toBe(2);

    const pos0 = result.positions.get('node0' as NodeId)!;
    const pos1 = result.positions.get('node1' as NodeId)!;

    // Should be side by side (different x, same y)
    expect(pos1.x).toBeGreaterThan(pos0.x);
  });

  it('should have no connectors', () => {
    const { nodes, rootNodeIds } = createNodes(3);

    const result = layout.compute(nodes, rootNodeIds, { width: 400, height: 400 }, {});

    expect(result.connectors.length).toBe(0);
  });
});

describe('BasicRadialLayout', () => {
  const layout = new BasicRadialLayout();

  it('should position center node with satellites', () => {
    const { nodes, rootNodeIds } = createNodes(4, true);

    const result = layout.compute(nodes, rootNodeIds, { width: 400, height: 400 }, {});

    // Center node should be at center
    const centerPos = result.positions.get('root' as NodeId)!;
    expect(centerPos.x + centerPos.width / 2).toBeCloseTo(200, -1);
    expect(centerPos.y + centerPos.height / 2).toBeCloseTo(200, -1);

    // Should have connectors to children
    expect(result.connectors.length).toBe(3);
  });
});

describe('BasicMatrixLayout', () => {
  const layout = new BasicMatrixLayout();

  it('should limit to 4 nodes', () => {
    const { nodes, rootNodeIds } = createNodes(6);

    const result = layout.compute(nodes, rootNodeIds, { width: 400, height: 400 }, {});

    expect(result.positions.size).toBeLessThanOrEqual(4);
  });

  it('should arrange in 2x2 grid', () => {
    const { nodes, rootNodeIds } = createNodes(4);

    const result = layout.compute(nodes, rootNodeIds, { width: 400, height: 400 }, {});

    const positions = Array.from(result.positions.values());

    // Should have 2 distinct x values and 2 distinct y values
    const xValues = new Set(positions.map((p) => p.x));
    const yValues = new Set(positions.map((p) => p.y));

    expect(xValues.size).toBe(2);
    expect(yValues.size).toBe(2);
  });
});

describe('BasicPyramidLayout', () => {
  const layout = new BasicPyramidLayout();

  it('should create pyramid shape (narrow at top, wide at bottom)', () => {
    const { nodes, rootNodeIds } = createNodes(4);

    const result = layout.compute(nodes, rootNodeIds, { width: 400, height: 400 }, {});

    const pos0 = result.positions.get('node0' as NodeId)!; // top
    const pos3 = result.positions.get('node3' as NodeId)!; // bottom

    expect(pos3.width).toBeGreaterThan(pos0.width);
  });

  it('should stack vertically', () => {
    const { nodes, rootNodeIds } = createNodes(3);

    const result = layout.compute(nodes, rootNodeIds, { width: 400, height: 300 }, {});

    const pos0 = result.positions.get('node0' as NodeId)!;
    const pos1 = result.positions.get('node1' as NodeId)!;
    const pos2 = result.positions.get('node2' as NodeId)!;

    expect(pos1.y).toBeGreaterThan(pos0.y);
    expect(pos2.y).toBeGreaterThan(pos1.y);
  });
});

describe('PictureGridLayout', () => {
  const layout = new PictureGridLayout();

  it('should arrange in grid', () => {
    const { nodes, rootNodeIds } = createNodes(9);

    const result = layout.compute(nodes, rootNodeIds, { width: 300, height: 300 }, {});

    expect(result.positions.size).toBe(9);

    // 9 items = 3x3 grid
    const xValues = new Set(Array.from(result.positions.values()).map((p) => p.x));
    const yValues = new Set(Array.from(result.positions.values()).map((p) => p.y));

    expect(xValues.size).toBe(3);
    expect(yValues.size).toBe(3);
  });

  it('should fill bounds proportionally', () => {
    const { nodes, rootNodeIds } = createNodes(4);

    const result = layout.compute(nodes, rootNodeIds, { width: 400, height: 400 }, {});

    // Each cell should take roughly 1/4 of the space (minus gaps)
    const firstPos = result.positions.get('node0' as NodeId)!;
    expect(firstPos.width).toBeGreaterThan(150); // roughly half width
    expect(firstPos.height).toBeGreaterThan(150);
  });
});
