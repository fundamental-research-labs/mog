import type { NodeId, Diagram, DiagramNode } from '@mog-sdk/contracts/diagram';
import {
  addNodeToDiagram,
  createNode,
  createNodeId,
  demoteNode,
  getNodeDepth,
  getOrderedNodes,
  moveNodeDown,
  moveNodeUp,
  promoteNode,
  removeNodeFromDiagram,
  updateNodeText,
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

// Helper to create a diagram with a single root node
function createSingleNodeDiagram(): Diagram {
  const node = createNode({ text: 'Root', level: 0, parentId: null });
  return {
    layoutId: 'test-layout',
    category: 'list',
    nodes: new Map([[node.id, node]]),
    rootNodeIds: [node.id],
    quickStyleId: 'subtle-effect',
    colorThemeId: 'colorful-1',
    layoutOptions: {},
  };
}

// Helper to create a hierarchical diagram with multiple levels
function createHierarchicalDiagram(): Diagram {
  // Create nodes
  const root1 = createNode({ text: 'Root 1', level: 0, parentId: null });
  const root2 = createNode({ text: 'Root 2', level: 0, parentId: null });
  const child1 = createNode({ text: 'Child 1', level: 1, parentId: root1.id });
  const child2 = createNode({ text: 'Child 2', level: 1, parentId: root1.id });
  const grandchild = createNode({ text: 'Grandchild', level: 2, parentId: child1.id });

  // Set up relationships
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

describe('createNodeId', () => {
  it('should generate unique IDs', () => {
    const id1 = createNodeId();
    const id2 = createNodeId();
    expect(id1).not.toBe(id2);
  });

  it('should generate UUID-like format', () => {
    const id = createNodeId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('createNode', () => {
  it('should create a node with default values', () => {
    const node = createNode({});
    expect(node.id).toBeDefined();
    expect(node.text).toBe('');
    expect(node.level).toBe(0);
    expect(node.parentId).toBe(null);
    expect(node.childIds).toEqual([]);
    expect(node.siblingOrder).toBe(0);
  });

  it('should create a node with specified values', () => {
    const parentId = createNodeId();
    const node = createNode({
      text: 'Test Node',
      level: 2,
      parentId,
    });
    expect(node.text).toBe('Test Node');
    expect(node.level).toBe(2);
    expect(node.parentId).toBe(parentId);
  });
});

describe('addNodeToDiagram', () => {
  it('should add a node as root when no reference is provided', () => {
    const diagram = createEmptyDiagram();
    const node = createNode({ text: 'New Root' });
    const result = addNodeToDiagram(diagram, node, 'after');

    expect(result.rootNodeIds).toContain(node.id);
    expect(result.nodes.get(node.id)?.level).toBe(0);
    expect(result.nodes.get(node.id)?.parentId).toBe(null);
    expect(result.nodes.get(node.id)?.siblingOrder).toBe(0);
  });

  it('should add a node before a reference at root level', () => {
    const diagram = createSingleNodeDiagram();
    const existingRootId = diagram.rootNodeIds[0];
    const node = createNode({ text: 'Before' });
    const result = addNodeToDiagram(diagram, node, 'before', existingRootId);

    expect(result.rootNodeIds[0]).toBe(node.id);
    expect(result.rootNodeIds[1]).toBe(existingRootId);
    expect(result.nodes.get(node.id)?.siblingOrder).toBe(0);
    expect(result.nodes.get(existingRootId)?.siblingOrder).toBe(1);
  });

  it('should add a node after a reference at root level', () => {
    const diagram = createSingleNodeDiagram();
    const existingRootId = diagram.rootNodeIds[0];
    const node = createNode({ text: 'After' });
    const result = addNodeToDiagram(diagram, node, 'after', existingRootId);

    expect(result.rootNodeIds[0]).toBe(existingRootId);
    expect(result.rootNodeIds[1]).toBe(node.id);
    expect(result.nodes.get(existingRootId)?.siblingOrder).toBe(0);
    expect(result.nodes.get(node.id)?.siblingOrder).toBe(1);
  });

  it('should add a child node', () => {
    const diagram = createSingleNodeDiagram();
    const rootId = diagram.rootNodeIds[0];
    const node = createNode({ text: 'Child' });
    const result = addNodeToDiagram(diagram, node, 'child', rootId);

    expect(result.nodes.get(node.id)?.parentId).toBe(rootId);
    expect(result.nodes.get(node.id)?.level).toBe(1);
    expect(result.nodes.get(rootId)?.childIds).toContain(node.id);
  });

  it('should add a node above (becomes sibling of parent)', () => {
    const diagram = createHierarchicalDiagram();
    // Get a child node (not root)
    const rootId = diagram.rootNodeIds[0];
    const childId = diagram.nodes.get(rootId)!.childIds[0];

    const node = createNode({ text: 'Above' });
    const result = addNodeToDiagram(diagram, node, 'above', childId);

    // New node should be at same level as the parent (root level)
    expect(result.nodes.get(node.id)?.level).toBe(0);
    expect(result.nodes.get(node.id)?.parentId).toBe(null);
    expect(result.rootNodeIds).toContain(node.id);
  });

  it('should throw error when adding above a root node', () => {
    const diagram = createSingleNodeDiagram();
    const rootId = diagram.rootNodeIds[0];
    const node = createNode({ text: 'Above' });

    expect(() => addNodeToDiagram(diagram, node, 'above', rootId)).toThrow(
      'Cannot add above a root node',
    );
  });

  it('should throw error when reference node not found', () => {
    const diagram = createEmptyDiagram();
    const node = createNode({ text: 'Test' });
    const fakeId = createNodeId();

    expect(() => addNodeToDiagram(diagram, node, 'after', fakeId)).toThrow('Reference node');
  });

  it('should add node before a child (not at root level)', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const root = diagram.nodes.get(rootId)!;
    const secondChildId = root.childIds[1];

    const node = createNode({ text: 'Before Child 2' });
    const result = addNodeToDiagram(diagram, node, 'before', secondChildId);

    const updatedRoot = result.nodes.get(rootId)!;
    expect(updatedRoot.childIds.indexOf(node.id)).toBe(1); // Between Child 1 and Child 2
    expect(result.nodes.get(node.id)?.parentId).toBe(rootId);
    expect(result.nodes.get(node.id)?.level).toBe(1);
  });
});

describe('removeNodeFromDiagram', () => {
  it('should remove a root node with children (cascade delete)', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const result = removeNodeFromDiagram(diagram, rootId);

    expect(result.rootNodeIds).not.toContain(rootId);
    expect(result.nodes.has(rootId)).toBe(false);
    // Children should also be removed
    expect(result.rootNodeIds.length).toBe(1);
  });

  it('should remove a node without removing children (reassign to parent)', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const root = diagram.nodes.get(rootId)!;
    const childId = root.childIds[0];
    const grandchildId = diagram.nodes.get(childId)!.childIds[0];

    const result = removeNodeFromDiagram(diagram, childId, { removeChildren: false });

    // Child should be removed but grandchild should become child of root
    expect(result.nodes.has(childId)).toBe(false);
    expect(result.nodes.has(grandchildId)).toBe(true);
    expect(result.nodes.get(grandchildId)?.parentId).toBe(rootId);
    expect(result.nodes.get(grandchildId)?.level).toBe(1);
  });

  it('should return diagram unchanged if node not found', () => {
    const diagram = createSingleNodeDiagram();
    const fakeId = createNodeId();
    const result = removeNodeFromDiagram(diagram, fakeId);

    expect(result).toEqual(diagram);
  });

  it('should update sibling orders after removal', () => {
    const diagram = createHierarchicalDiagram();
    const root2Id = diagram.rootNodeIds[1];
    const result = removeNodeFromDiagram(diagram, diagram.rootNodeIds[0]);

    expect(result.nodes.get(root2Id)?.siblingOrder).toBe(0);
  });
});

describe('promoteNode', () => {
  it('should promote a child to root level', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const childId = diagram.nodes.get(rootId)!.childIds[0];

    const result = promoteNode(diagram, childId);

    expect(result.nodes.get(childId)?.level).toBe(0);
    expect(result.nodes.get(childId)?.parentId).toBe(null);
    expect(result.rootNodeIds).toContain(childId);
  });

  it('should not promote a root node', () => {
    const diagram = createSingleNodeDiagram();
    const rootId = diagram.rootNodeIds[0];
    const result = promoteNode(diagram, rootId);

    expect(result).toEqual(diagram);
  });

  it('should promote grandchild to child level', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const childId = diagram.nodes.get(rootId)!.childIds[0];
    const grandchildId = diagram.nodes.get(childId)!.childIds[0];

    const result = promoteNode(diagram, grandchildId);

    expect(result.nodes.get(grandchildId)?.level).toBe(1);
    expect(result.nodes.get(grandchildId)?.parentId).toBe(rootId);
    expect(result.nodes.get(rootId)?.childIds).toContain(grandchildId);
  });
});

describe('demoteNode', () => {
  it('should demote a node to become child of previous sibling', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const root = diagram.nodes.get(rootId)!;
    const secondChildId = root.childIds[1];
    const firstChildId = root.childIds[0];

    const result = demoteNode(diagram, secondChildId);

    expect(result.nodes.get(secondChildId)?.parentId).toBe(firstChildId);
    expect(result.nodes.get(secondChildId)?.level).toBe(2);
    expect(result.nodes.get(firstChildId)?.childIds).toContain(secondChildId);
  });

  it('should not demote first sibling', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const firstChildId = diagram.nodes.get(rootId)!.childIds[0];

    const result = demoteNode(diagram, firstChildId);

    expect(result).toEqual(diagram);
  });

  it('should demote second root to become child of first root', () => {
    const diagram = createHierarchicalDiagram();
    const secondRootId = diagram.rootNodeIds[1];
    const firstRootId = diagram.rootNodeIds[0];

    const result = demoteNode(diagram, secondRootId);

    expect(result.nodes.get(secondRootId)?.parentId).toBe(firstRootId);
    expect(result.nodes.get(secondRootId)?.level).toBe(1);
    expect(result.rootNodeIds).not.toContain(secondRootId);
  });
});

describe('moveNodeUp', () => {
  it('should swap with previous sibling', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const root = diagram.nodes.get(rootId)!;
    const secondChildId = root.childIds[1];
    const firstChildId = root.childIds[0];

    const result = moveNodeUp(diagram, secondChildId);

    const updatedRoot = result.nodes.get(rootId)!;
    expect(updatedRoot.childIds[0]).toBe(secondChildId);
    expect(updatedRoot.childIds[1]).toBe(firstChildId);
    expect(result.nodes.get(secondChildId)?.siblingOrder).toBe(0);
    expect(result.nodes.get(firstChildId)?.siblingOrder).toBe(1);
  });

  it('should not move first sibling up', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const firstChildId = diagram.nodes.get(rootId)!.childIds[0];

    const result = moveNodeUp(diagram, firstChildId);

    expect(result).toEqual(diagram);
  });

  it('should move root node up', () => {
    const diagram = createHierarchicalDiagram();
    const secondRootId = diagram.rootNodeIds[1];

    const result = moveNodeUp(diagram, secondRootId);

    expect(result.rootNodeIds[0]).toBe(secondRootId);
  });
});

describe('moveNodeDown', () => {
  it('should swap with next sibling', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const root = diagram.nodes.get(rootId)!;
    const firstChildId = root.childIds[0];
    const secondChildId = root.childIds[1];

    const result = moveNodeDown(diagram, firstChildId);

    const updatedRoot = result.nodes.get(rootId)!;
    expect(updatedRoot.childIds[0]).toBe(secondChildId);
    expect(updatedRoot.childIds[1]).toBe(firstChildId);
  });

  it('should not move last sibling down', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const root = diagram.nodes.get(rootId)!;
    const lastChildId = root.childIds[root.childIds.length - 1];

    const result = moveNodeDown(diagram, lastChildId);

    expect(result).toEqual(diagram);
  });
});

describe('updateNodeText', () => {
  it('should update node text', () => {
    const diagram = createSingleNodeDiagram();
    const rootId = diagram.rootNodeIds[0];

    const result = updateNodeText(diagram, rootId, 'Updated Text');

    expect(result.nodes.get(rootId)?.text).toBe('Updated Text');
  });

  it('should return diagram unchanged if node not found', () => {
    const diagram = createSingleNodeDiagram();
    const fakeId = createNodeId();

    const result = updateNodeText(diagram, fakeId, 'Test');

    expect(result).toEqual(diagram);
  });
});

describe('getOrderedNodes', () => {
  it('should return nodes in depth-first order', () => {
    const diagram = createHierarchicalDiagram();
    const ordered = getOrderedNodes(diagram);

    // Should be: Root1, Child1, Grandchild, Child2, Root2
    expect(ordered[0].text).toBe('Root 1');
    expect(ordered[1].text).toBe('Child 1');
    expect(ordered[2].text).toBe('Grandchild');
    expect(ordered[3].text).toBe('Child 2');
    expect(ordered[4].text).toBe('Root 2');
  });

  it('should return empty array for empty diagram', () => {
    const diagram = createEmptyDiagram();
    const ordered = getOrderedNodes(diagram);

    expect(ordered).toEqual([]);
  });

  it('should respect siblingOrder', () => {
    const diagram = createHierarchicalDiagram();
    // Manually reverse child order in memory
    const rootId = diagram.rootNodeIds[0];
    const root = diagram.nodes.get(rootId)!;
    const child1 = diagram.nodes.get(root.childIds[0])!;
    const child2 = diagram.nodes.get(root.childIds[1])!;
    child1.siblingOrder = 1;
    child2.siblingOrder = 0;

    const ordered = getOrderedNodes(diagram);

    // Child 2 should come before Child 1 now
    expect(ordered[1].text).toBe('Child 2');
    expect(ordered[2].text).toBe('Child 1');
  });
});

describe('getNodeDepth', () => {
  it('should return 0 for root node', () => {
    const diagram = createSingleNodeDiagram();
    const rootId = diagram.rootNodeIds[0];

    expect(getNodeDepth(diagram, rootId)).toBe(0);
  });

  it('should return correct depth for nested nodes', () => {
    const diagram = createHierarchicalDiagram();
    const rootId = diagram.rootNodeIds[0];
    const childId = diagram.nodes.get(rootId)!.childIds[0];
    const grandchildId = diagram.nodes.get(childId)!.childIds[0];

    expect(getNodeDepth(diagram, childId)).toBe(1);
    expect(getNodeDepth(diagram, grandchildId)).toBe(2);
  });
});

describe('edge cases', () => {
  describe('empty diagram handling', () => {
    it('should handle operations on empty diagram', () => {
      const diagram = createEmptyDiagram();

      expect(getOrderedNodes(diagram)).toEqual([]);
      expect(removeNodeFromDiagram(diagram, createNodeId())).toEqual(diagram);
    });
  });

  describe('invalid node references', () => {
    it('should handle invalid nodeId in promoteNode', () => {
      const diagram = createSingleNodeDiagram();
      const result = promoteNode(diagram, createNodeId());
      expect(result).toEqual(diagram);
    });

    it('should handle invalid nodeId in demoteNode', () => {
      const diagram = createSingleNodeDiagram();
      const result = demoteNode(diagram, createNodeId());
      expect(result).toEqual(diagram);
    });

    it('should handle invalid nodeId in moveNodeUp', () => {
      const diagram = createSingleNodeDiagram();
      const result = moveNodeUp(diagram, createNodeId());
      expect(result).toEqual(diagram);
    });

    it('should handle invalid nodeId in moveNodeDown', () => {
      const diagram = createSingleNodeDiagram();
      const result = moveNodeDown(diagram, createNodeId());
      expect(result).toEqual(diagram);
    });
  });

  describe('boundary conditions', () => {
    it('should handle promoting already root node', () => {
      const diagram = createSingleNodeDiagram();
      const rootId = diagram.rootNodeIds[0];
      const result = promoteNode(diagram, rootId);
      expect(result).toEqual(diagram);
    });

    it('should handle demoting first sibling', () => {
      const diagram = createSingleNodeDiagram();
      const rootId = diagram.rootNodeIds[0];
      const result = demoteNode(diagram, rootId);
      expect(result).toEqual(diagram);
    });
  });

  describe('multi-root scenarios', () => {
    it('should correctly handle multiple roots when adding', () => {
      let diagram = createEmptyDiagram();

      const node1 = createNode({ text: 'First' });
      diagram = addNodeToDiagram(diagram, node1, 'after');

      const node2 = createNode({ text: 'Second' });
      diagram = addNodeToDiagram(diagram, node2, 'after');

      const node3 = createNode({ text: 'Third' });
      diagram = addNodeToDiagram(diagram, node3, 'before', node2.id);

      expect(diagram.rootNodeIds.length).toBe(3);
      expect(diagram.rootNodeIds[0]).toBe(node1.id);
      expect(diagram.rootNodeIds[1]).toBe(node3.id);
      expect(diagram.rootNodeIds[2]).toBe(node2.id);
    });

    it('should maintain correct order when operating on multiple roots', () => {
      const diagram = createHierarchicalDiagram();
      const firstRootId = diagram.rootNodeIds[0];
      const secondRootId = diagram.rootNodeIds[1];

      const result = moveNodeDown(diagram, firstRootId);

      expect(result.rootNodeIds[0]).toBe(secondRootId);
      expect(result.rootNodeIds[1]).toBe(firstRootId);
    });
  });

  describe('siblingOrder consistency', () => {
    it('should maintain consistent siblingOrder after add operations', () => {
      let diagram = createSingleNodeDiagram();
      const rootId = diagram.rootNodeIds[0];

      // Add multiple children
      const child1 = createNode({ text: 'Child 1' });
      diagram = addNodeToDiagram(diagram, child1, 'child', rootId);

      const child2 = createNode({ text: 'Child 2' });
      diagram = addNodeToDiagram(diagram, child2, 'child', rootId);

      const child3 = createNode({ text: 'Child 3' });
      diagram = addNodeToDiagram(diagram, child3, 'before', child2.id);

      const root = diagram.nodes.get(rootId)!;
      const children = root.childIds.map((id) => diagram.nodes.get(id)!);

      // Verify siblingOrder matches position in array
      children.forEach((child, index) => {
        expect(child.siblingOrder).toBe(index);
      });
    });

    it('should maintain consistent siblingOrder after remove operations', () => {
      const diagram = createHierarchicalDiagram();
      const rootId = diagram.rootNodeIds[0];
      const firstChildId = diagram.nodes.get(rootId)!.childIds[0];

      const result = removeNodeFromDiagram(diagram, firstChildId);

      const root = result.nodes.get(rootId)!;
      const children = root.childIds.map((id) => result.nodes.get(id)!);

      children.forEach((child, index) => {
        expect(child.siblingOrder).toBe(index);
      });
    });

    it('should maintain consistent siblingOrder after move operations', () => {
      const diagram = createHierarchicalDiagram();
      const rootId = diagram.rootNodeIds[0];
      const secondChildId = diagram.nodes.get(rootId)!.childIds[1];

      const result = moveNodeUp(diagram, secondChildId);

      const root = result.nodes.get(rootId)!;
      const children = root.childIds.map((id) => result.nodes.get(id)!);

      children.forEach((child, index) => {
        expect(child.siblingOrder).toBe(index);
      });
    });
  });
});
