import type {
  NodeId,
  Diagram,
  DiagramLayoutDefinition,
  DiagramNode,
} from '@mog-sdk/contracts/diagram';
import { changeLayout, createDiagram } from '../../src/models/diagram';
import {
  addNodeToDiagram,
  computeNodeLevel,
  createNode,
  createNodeId,
  demoteNode,
  moveNodeDown,
  moveNodeUp,
  promoteNode,
  recomputeAllLevels,
  removeNodeFromDiagram,
} from '../../src/models/node';

// Helper to create a minimal empty diagram
function createEmptyDiagram(): Diagram {
  return {
    layoutId: 'test-layout',
    category: 'list',
    nodes: new Map(),
    rootNodeIds: [],
    quickStyleId: 'subtle-effect',
    colorThemeId: 'colorful-1',
    layoutOptions: {},
  };
}

// Helper to create a hierarchical diagram with multiple levels
function createHierarchicalDiagram(): Diagram {
  const root1 = createNode({ text: 'Root 1', level: 0, parentId: null });
  const root2 = createNode({ text: 'Root 2', level: 0, parentId: null });
  const child1 = createNode({ text: 'Child 1', level: 1, parentId: root1.id });
  const child2 = createNode({ text: 'Child 2', level: 1, parentId: root1.id });
  const grandchild = createNode({ text: 'Grandchild', level: 2, parentId: child1.id });

  root1.siblingOrder = 0;
  root2.siblingOrder = 1;
  root1.childIds = [child1.id, child2.id];
  child1.siblingOrder = 0;
  child2.siblingOrder = 1;
  child1.childIds = [grandchild.id];
  grandchild.siblingOrder = 0;

  const nodes = new Map<NodeId, DiagramNode>([
    [root1.id, root1],
    [root2.id, root2],
    [child1.id, child1],
    [child2.id, child2],
    [grandchild.id, grandchild],
  ]);

  return {
    layoutId: 'test-layout',
    category: 'hierarchy',
    nodes,
    rootNodeIds: [root1.id, root2.id],
    quickStyleId: 'subtle-effect',
    colorThemeId: 'colorful-1',
    layoutOptions: {},
  };
}

// Helper to create a layout definition
function createLayoutDefinition(
  overrides?: Partial<DiagramLayoutDefinition>,
): DiagramLayoutDefinition {
  return {
    id: 'test-layout',
    name: 'Test Layout',
    description: 'A test layout',
    category: 'list',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 5,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'straight',
    algorithm: 'linear-horizontal',
    thumbnail: '',
    ...overrides,
  };
}

describe('computeNodeLevel', () => {
  it('should return 0 for a root node', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    expect(computeNodeLevel(diagram, rootId)).toBe(0);
  });

  it('should return 1 for a child of root', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const childId = diagram.nodes.get(rootId)!.childIds[0];
    expect(computeNodeLevel(diagram, childId)).toBe(1);
  });

  it('should return 2 for a grandchild', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const childId = diagram.nodes.get(rootId)!.childIds[0];
    const grandchildId = diagram.nodes.get(childId)!.childIds[0];
    expect(computeNodeLevel(diagram, grandchildId)).toBe(2);
  });

  it('should throw Error when circular parentId chain is detected', () => {
    // Manually create a cycle: A -> B -> A
    const idA = createNodeId();
    const idB = createNodeId();

    const nodeA: DiagramNode = {
      id: idA,
      text: 'A',
      level: 0,
      parentId: idB,
      childIds: [idB],
      siblingOrder: 0,
    };
    const nodeB: DiagramNode = {
      id: idB,
      text: 'B',
      level: 1,
      parentId: idA,
      childIds: [idA],
      siblingOrder: 0,
    };

    const diagram: Diagram = {
      layoutId: 'test',
      category: 'list',
      nodes: new Map([
        [idA, nodeA],
        [idB, nodeB],
      ]),
      rootNodeIds: [],
      quickStyleId: 'subtle-effect',
      colorThemeId: 'colorful-1',
      layoutOptions: {},
    };

    expect(() => computeNodeLevel(diagram, idA)).toThrow('Cycle detected');
  });

  it('should throw Error on self-referencing parentId', () => {
    const id = createNodeId();
    const node: DiagramNode = {
      id,
      text: 'Self',
      level: 0,
      parentId: id,
      childIds: [],
      siblingOrder: 0,
    };

    const diagram: Diagram = {
      layoutId: 'test',
      category: 'list',
      nodes: new Map([[id, node]]),
      rootNodeIds: [],
      quickStyleId: 'subtle-effect',
      colorThemeId: 'colorful-1',
      layoutOptions: {},
    };

    expect(() => computeNodeLevel(diagram, id)).toThrow('Cycle detected');
  });
});

describe('recomputeAllLevels', () => {
  it('should fix incorrect levels to match parentId chain', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const childId = diagram.nodes.get(rootId)!.childIds[0];
    const grandchildId = diagram.nodes.get(childId)!.childIds[0];

    // Manually set wrong levels
    const wrongNodes = new Map(diagram.nodes);
    const wrongChild = { ...wrongNodes.get(childId)!, level: 5 };
    const wrongGrandchild = { ...wrongNodes.get(grandchildId)!, level: 99 };
    wrongNodes.set(childId, wrongChild);
    wrongNodes.set(grandchildId, wrongGrandchild);

    const wrongDiagram = { ...diagram, nodes: wrongNodes };
    const fixed = recomputeAllLevels(wrongDiagram);

    expect(fixed.nodes.get(rootId)?.level).toBe(0);
    expect(fixed.nodes.get(childId)?.level).toBe(1);
    expect(fixed.nodes.get(grandchildId)?.level).toBe(2);
  });

  it('should not modify levels when they are already correct', () => {
    const diagram = createHierarchicalDiagram();
    const result = recomputeAllLevels(diagram);

    // All levels should remain the same
    for (const [id, node] of diagram.nodes) {
      expect(result.nodes.get(id)?.level).toBe(node.level);
    }
  });

  it('should handle empty diagram', () => {
    const empty = createEmptyDiagram();
    const result = recomputeAllLevels(empty);
    expect(result.nodes.size).toBe(0);
  });
});

describe('descendant level propagation after structural mutations', () => {
  it('addNodeToDiagram: levels are correct after adding child', () => {
    let diagram = createEmptyDiagram();
    const root = createNode({ text: 'Root' });
    diagram = addNodeToDiagram(diagram, root, 'after');
    expect(diagram.nodes.get(root.id)?.level).toBe(0);

    const child = createNode({ text: 'Child' });
    diagram = addNodeToDiagram(diagram, child, 'child', root.id);
    expect(diagram.nodes.get(child.id)?.level).toBe(1);

    const grandchild = createNode({ text: 'Grandchild' });
    diagram = addNodeToDiagram(diagram, grandchild, 'child', child.id);
    expect(diagram.nodes.get(grandchild.id)?.level).toBe(2);
  });

  it('addNodeToDiagram: levels are correct after adding before/after', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const childId = diagram.nodes.get(rootId)!.childIds[0];

    const sibling = createNode({ text: 'Sibling' });
    const result = addNodeToDiagram(diagram, sibling, 'after', childId);
    expect(result.nodes.get(sibling.id)?.level).toBe(1);
  });

  it('promoteNode: levels update correctly for the promoted node', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const childId = diagram.nodes.get(rootId)!.childIds[0];
    const grandchildId = diagram.nodes.get(childId)!.childIds[0];

    // Promote grandchild to be sibling of its parent (child level)
    const result = promoteNode(diagram, grandchildId);
    expect(result.nodes.get(grandchildId)?.level).toBe(1);
    expect(result.nodes.get(grandchildId)?.parentId).toBe(rootId);
  });

  it('promoteNode: promote to root level, level becomes 0', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const childId = diagram.nodes.get(rootId)!.childIds[0];

    const result = promoteNode(diagram, childId);
    expect(result.nodes.get(childId)?.level).toBe(0);
    expect(result.nodes.get(childId)?.parentId).toBe(null);
  });

  it('demoteNode: levels update correctly for the demoted node', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const secondChildId = diagram.nodes.get(rootId)!.childIds[1];
    const firstChildId = diagram.nodes.get(rootId)!.childIds[0];

    const result = demoteNode(diagram, secondChildId);
    expect(result.nodes.get(secondChildId)?.level).toBe(2);
    expect(result.nodes.get(secondChildId)?.parentId).toBe(firstChildId);
  });

  it('demoteNode: root becomes child of previous root', () => {
    const diagram = createHierarchicalDiagram();
    const secondRootId = diagram.rootNodeIds[1];
    const firstRootId = diagram.rootNodeIds[0];

    const result = demoteNode(diagram, secondRootId);
    expect(result.nodes.get(secondRootId)?.level).toBe(1);
    expect(result.nodes.get(secondRootId)?.parentId).toBe(firstRootId);
  });

  it('removeNodeFromDiagram: levels are correct after reassigning children to parent', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const childId = diagram.nodes.get(rootId)!.childIds[0];
    const grandchildId = diagram.nodes.get(childId)!.childIds[0];

    // Remove child without removing children - grandchild should move up
    const result = removeNodeFromDiagram(diagram, childId, { removeChildren: false });
    expect(result.nodes.has(childId)).toBe(false);
    expect(result.nodes.get(grandchildId)?.level).toBe(1);
    expect(result.nodes.get(grandchildId)?.parentId).toBe(rootId);
  });

  it('moveNodeUp: levels remain consistent', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const secondChildId = diagram.nodes.get(rootId)!.childIds[1];

    const result = moveNodeUp(diagram, secondChildId);

    // All levels should still be consistent
    for (const [id, node] of result.nodes) {
      expect(node.level).toBe(computeNodeLevel(result, id));
    }
  });

  it('moveNodeDown: levels remain consistent', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const firstChildId = diagram.nodes.get(rootId)!.childIds[0];

    const result = moveNodeDown(diagram, firstChildId);

    // All levels should still be consistent
    for (const [id, node] of result.nodes) {
      expect(node.level).toBe(computeNodeLevel(result, id));
    }
  });

  it('changeLayout: levels remain consistent when flattening', () => {
    const layout = createLayoutDefinition({ category: 'hierarchy', supportsChildren: true });
    let diagram = createDiagram(layout);
    const rootId = diagram.rootNodeIds[0];

    const child = createNode({ text: 'Child' });
    diagram = addNodeToDiagram(diagram, child, 'child', rootId);

    const grandchild = createNode({ text: 'Grandchild' });
    diagram = addNodeToDiagram(diagram, grandchild, 'child', child.id);

    // Flatten to a layout that doesn't support children
    const flatLayout = createLayoutDefinition({
      id: 'flat',
      supportsChildren: false,
    });
    const result = changeLayout(diagram, flatLayout);

    // All nodes should be level 0 after flattening
    for (const [, node] of result.nodes) {
      expect(node.level).toBe(0);
    }
  });

  it('changeLayout: levels remain consistent when not flattening', () => {
    const diagram = createHierarchicalDiagram();
    const newLayout = createLayoutDefinition({
      id: 'new-hierarchy',
      category: 'hierarchy',
      supportsChildren: true,
    });

    const result = changeLayout(diagram, newLayout);

    // All levels should be consistent with parentId chain
    for (const [id, node] of result.nodes) {
      expect(node.level).toBe(computeNodeLevel(result, id));
    }
  });
});

describe('level consistency across all mutations (comprehensive)', () => {
  it('should maintain level consistency through a sequence of mutations', () => {
    // Start with empty diagram, build up, then tear down
    let diagram = createEmptyDiagram();

    // Add 3 root nodes
    const root1 = createNode({ text: 'R1' });
    diagram = addNodeToDiagram(diagram, root1, 'after');
    const root2 = createNode({ text: 'R2' });
    diagram = addNodeToDiagram(diagram, root2, 'after');
    const root3 = createNode({ text: 'R3' });
    diagram = addNodeToDiagram(diagram, root3, 'after');

    // Add children to root1
    const c1 = createNode({ text: 'C1' });
    diagram = addNodeToDiagram(diagram, c1, 'child', root1.id);
    const c2 = createNode({ text: 'C2' });
    diagram = addNodeToDiagram(diagram, c2, 'child', root1.id);

    // Add grandchild to c1
    const gc1 = createNode({ text: 'GC1' });
    diagram = addNodeToDiagram(diagram, gc1, 'child', c1.id);

    // Verify all levels
    expect(diagram.nodes.get(root1.id)?.level).toBe(0);
    expect(diagram.nodes.get(root2.id)?.level).toBe(0);
    expect(diagram.nodes.get(root3.id)?.level).toBe(0);
    expect(diagram.nodes.get(c1.id)?.level).toBe(1);
    expect(diagram.nodes.get(c2.id)?.level).toBe(1);
    expect(diagram.nodes.get(gc1.id)?.level).toBe(2);

    // Demote root2 under root1
    diagram = demoteNode(diagram, root2.id);
    expect(diagram.nodes.get(root2.id)?.level).toBe(1);

    // Promote gc1 from level 2 to level 1
    diagram = promoteNode(diagram, gc1.id);
    expect(diagram.nodes.get(gc1.id)?.level).toBe(1);

    // Move nodes around - levels should stay consistent
    diagram = moveNodeDown(diagram, c1.id);

    // Verify full consistency
    for (const [id, node] of diagram.nodes) {
      expect(node.level).toBe(computeNodeLevel(diagram, id));
    }
  });
});

describe('circular parent guard (recomputeAllLevels)', () => {
  it('should throw when recomputeAllLevels encounters a cycle', () => {
    const idA = createNodeId();
    const idB = createNodeId();

    const nodeA: DiagramNode = {
      id: idA,
      text: 'A',
      level: 0,
      parentId: idB,
      childIds: [idB],
      siblingOrder: 0,
    };
    const nodeB: DiagramNode = {
      id: idB,
      text: 'B',
      level: 1,
      parentId: idA,
      childIds: [idA],
      siblingOrder: 0,
    };

    const diagram: Diagram = {
      layoutId: 'test',
      category: 'list',
      nodes: new Map([
        [idA, nodeA],
        [idB, nodeB],
      ]),
      rootNodeIds: [],
      quickStyleId: 'subtle-effect',
      colorThemeId: 'colorful-1',
      layoutOptions: {},
    };

    expect(() => recomputeAllLevels(diagram)).toThrow('Cycle detected');
  });

  it('should throw on a 3-node cycle', () => {
    const idA = createNodeId();
    const idB = createNodeId();
    const idC = createNodeId();

    const nodeA: DiagramNode = {
      id: idA,
      text: 'A',
      level: 0,
      parentId: idC,
      childIds: [idB],
      siblingOrder: 0,
    };
    const nodeB: DiagramNode = {
      id: idB,
      text: 'B',
      level: 1,
      parentId: idA,
      childIds: [idC],
      siblingOrder: 0,
    };
    const nodeC: DiagramNode = {
      id: idC,
      text: 'C',
      level: 2,
      parentId: idB,
      childIds: [idA],
      siblingOrder: 0,
    };

    const diagram: Diagram = {
      layoutId: 'test',
      category: 'list',
      nodes: new Map([
        [idA, nodeA],
        [idB, nodeB],
        [idC, nodeC],
      ]),
      rootNodeIds: [],
      quickStyleId: 'subtle-effect',
      colorThemeId: 'colorful-1',
      layoutOptions: {},
    };

    expect(() => recomputeAllLevels(diagram)).toThrow('Cycle detected');
  });
});

describe('level clamping', () => {
  it('should clamp levels that are higher than parentLevel + 1', () => {
    const root = createNode({ text: 'Root', level: 0, parentId: null });
    const child = createNode({ text: 'Child', level: 5, parentId: root.id });
    root.childIds = [child.id];

    const diagram: Diagram = {
      layoutId: 'test',
      category: 'list',
      nodes: new Map([
        [root.id, root],
        [child.id, child],
      ]),
      rootNodeIds: [root.id],
      quickStyleId: 'subtle-effect',
      colorThemeId: 'colorful-1',
      layoutOptions: {},
    };

    const result = recomputeAllLevels(diagram);
    expect(result.nodes.get(root.id)?.level).toBe(0);
    expect(result.nodes.get(child.id)?.level).toBe(1);
  });

  it('should clamp a deeply nested node with wrong level', () => {
    const root = createNode({ text: 'Root', level: 0, parentId: null });
    const child = createNode({ text: 'Child', level: 1, parentId: root.id });
    const grandchild = createNode({ text: 'Grandchild', level: 999, parentId: child.id });
    root.childIds = [child.id];
    child.childIds = [grandchild.id];

    const diagram: Diagram = {
      layoutId: 'test',
      category: 'list',
      nodes: new Map([
        [root.id, root],
        [child.id, child],
        [grandchild.id, grandchild],
      ]),
      rootNodeIds: [root.id],
      quickStyleId: 'subtle-effect',
      colorThemeId: 'colorful-1',
      layoutOptions: {},
    };

    const result = recomputeAllLevels(diagram);
    expect(result.nodes.get(grandchild.id)?.level).toBe(2);
  });
});
