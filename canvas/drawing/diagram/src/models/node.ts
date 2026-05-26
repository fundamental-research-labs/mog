/**
 * Diagram Node Operations
 *
 * Pure functions for manipulating Diagram nodes within diagrams.
 * All functions return new objects (immutable patterns).
 */

import type { NodeId, Diagram, DiagramNode } from '@mog-sdk/contracts/diagram';
import { createNodeId } from '../types';
import { getDiagramNodeDefault } from '../defaults/diagram-defaults';

// Re-export createNodeId
export { createNodeId } from '../types';

/**
 * Create a new Diagram node
 */
export function createNode(options: {
  text?: string;
  level?: number;
  parentId?: NodeId | null;
}): DiagramNode {
  return {
    id: createNodeId(),
    text: options.text ?? (getDiagramNodeDefault('text') as string),
    level: options.level ?? (getDiagramNodeDefault('level') as number),
    parentId: options.parentId ?? (getDiagramNodeDefault('parentId') as NodeId | null),
    childIds: [],
    siblingOrder: getDiagramNodeDefault('siblingOrder') as number,
  };
}

/**
 * Compute the level of a node by walking its parentId chain.
 *
 * Root nodes (parentId === null) have level 0.
 * Each parent hop increments level by 1.
 * Throws if a cycle is detected in the parentId chain.
 *
 * @param diagram The diagram containing the node
 * @param nodeId The node to compute the level for
 * @returns The computed level (0 for root, 1 for child of root, etc.)
 */
export function computeNodeLevel(diagram: Diagram, nodeId: NodeId): number {
  let depth = 0;
  let currentId: NodeId | null = nodeId;
  const visited = new Set<NodeId>();

  while (currentId !== null) {
    const node = diagram.nodes.get(currentId);
    if (!node) break;

    if (node.parentId === null) {
      // Reached a root node; depth is the number of hops so far
      return depth;
    }

    // Check for cycle before following parentId
    if (visited.has(currentId)) {
      throw new Error(`Cycle detected in Diagram node parentId chain at node ${currentId}`);
    }
    visited.add(currentId);

    currentId = node.parentId;
    depth++;
  }

  return depth;
}

/**
 * Recompute the level field for all nodes in a diagram based on their parentId chains.
 *
 * This ensures level is always derived from structure and prevents desync bugs.
 * Each node's level is clamped to parentLevel + 1 (or 0 for roots).
 *
 * @param diagram The diagram to recompute levels for
 * @returns A new diagram with all node levels updated
 */
export function recomputeAllLevels(diagram: Diagram): Diagram {
  const newNodes = new Map(diagram.nodes);

  for (const [id, node] of newNodes) {
    const computedLevel = computeNodeLevel(diagram, id);
    if (node.level !== computedLevel) {
      newNodes.set(id, { ...node, level: computedLevel });
    }
  }

  return {
    ...diagram,
    nodes: newNodes,
  };
}

/**
 * Add a node to a diagram
 *
 * @param diagram The diagram to add the node to
 * @param node The node to add
 * @param position Where to add relative to reference:
 *   - 'before': Same level, before reference
 *   - 'after': Same level, after reference
 *   - 'above': One level up (becomes sibling of reference's parent)
 *   - 'below': One level down (becomes child of reference)
 *   - 'child': Becomes child of reference
 * @param referenceNodeId Optional reference node for positioning
 * @returns New diagram with the node added
 */
export function addNodeToDiagram(
  diagram: Diagram,
  node: DiagramNode,
  position: 'before' | 'after' | 'above' | 'below' | 'child',
  referenceNodeId?: NodeId,
): Diagram {
  const newNodes = new Map(diagram.nodes);
  const newRootNodeIds = [...diagram.rootNodeIds];

  // Create a mutable copy of the node we're adding
  const nodeToAdd = { ...node };

  if (!referenceNodeId) {
    // No reference - add as root node at end
    nodeToAdd.level = 0;
    nodeToAdd.parentId = null;
    nodeToAdd.siblingOrder = newRootNodeIds.length;
    newNodes.set(nodeToAdd.id, nodeToAdd);
    newRootNodeIds.push(nodeToAdd.id);
  } else {
    const refNode = newNodes.get(referenceNodeId);
    if (!refNode) throw new Error(`Reference node ${referenceNodeId} not found`);

    switch (position) {
      case 'before':
      case 'after': {
        // Same level as reference
        nodeToAdd.level = refNode.level;
        nodeToAdd.parentId = refNode.parentId;

        // 4d fix: Add nodeToAdd to map BEFORE updating sibling orders
        // so the forEach loops can find it when recomputing siblingOrder
        newNodes.set(nodeToAdd.id, nodeToAdd);

        if (refNode.parentId) {
          // Has parent - insert into parent's childIds
          const parent = newNodes.get(refNode.parentId)!;
          const refIndex = parent.childIds.indexOf(referenceNodeId);
          const insertIndex = position === 'before' ? refIndex : refIndex + 1;
          const newChildIds = [...parent.childIds];
          newChildIds.splice(insertIndex, 0, nodeToAdd.id);
          newNodes.set(parent.id, { ...parent, childIds: newChildIds });
          // Update sibling orders
          newChildIds.forEach((id, i) => {
            const n = newNodes.get(id)!;
            newNodes.set(id, { ...n, siblingOrder: i });
          });
        } else {
          // Root level
          const refIndex = newRootNodeIds.indexOf(referenceNodeId);
          const insertIndex = position === 'before' ? refIndex : refIndex + 1;
          newRootNodeIds.splice(insertIndex, 0, nodeToAdd.id);
          newRootNodeIds.forEach((id, i) => {
            const n = newNodes.get(id)!;
            newNodes.set(id, { ...n, siblingOrder: i });
          });
        }
        break;
      }

      case 'above': {
        // Promote: becomes sibling of reference's parent
        if (!refNode.parentId) {
          throw new Error('Cannot add above a root node');
        }
        const parent = newNodes.get(refNode.parentId)!;
        nodeToAdd.level = parent.level;
        nodeToAdd.parentId = parent.parentId;

        // Add nodeToAdd to map before sibling order updates
        newNodes.set(nodeToAdd.id, nodeToAdd);

        // Insert after parent in grandparent's children (or root)
        if (parent.parentId) {
          const grandparent = newNodes.get(parent.parentId)!;
          const parentIndex = grandparent.childIds.indexOf(parent.id);
          const newChildIds = [...grandparent.childIds];
          newChildIds.splice(parentIndex + 1, 0, nodeToAdd.id);
          newNodes.set(grandparent.id, { ...grandparent, childIds: newChildIds });
          // Update sibling orders for grandparent's children
          newChildIds.forEach((id, i) => {
            const n = newNodes.get(id)!;
            newNodes.set(id, { ...n, siblingOrder: i });
          });
        } else {
          // Parent is a root node, so new node becomes a root
          const parentIndex = newRootNodeIds.indexOf(parent.id);
          newRootNodeIds.splice(parentIndex + 1, 0, nodeToAdd.id);
          newRootNodeIds.forEach((id, i) => {
            const n = newNodes.get(id)!;
            newNodes.set(id, { ...n, siblingOrder: i });
          });
        }
        break;
      }

      case 'below':
      case 'child': {
        // Becomes child of reference
        nodeToAdd.level = refNode.level + 1;
        nodeToAdd.parentId = referenceNodeId;
        nodeToAdd.siblingOrder = refNode.childIds.length;
        newNodes.set(nodeToAdd.id, nodeToAdd);
        newNodes.set(referenceNodeId, {
          ...refNode,
          childIds: [...refNode.childIds, nodeToAdd.id],
        });
        break;
      }
    }
  }

  const result: Diagram = {
    ...diagram,
    nodes: newNodes,
    rootNodeIds: newRootNodeIds,
  };

  return recomputeAllLevels(result);
}

/**
 * Remove a node from a diagram
 *
 * @param diagram The diagram to remove from
 * @param nodeId The node to remove
 * @param options Configuration:
 *   - removeChildren: If true (default), remove all descendants. If false, reassign children to parent.
 * @returns New diagram with the node removed
 */
export function removeNodeFromDiagram(
  diagram: Diagram,
  nodeId: NodeId,
  options?: { removeChildren?: boolean },
): Diagram {
  const node = diagram.nodes.get(nodeId);
  if (!node) return diagram;

  const newNodes = new Map(diagram.nodes);
  let newRootNodeIds = [...diagram.rootNodeIds];
  const removeChildren = options?.removeChildren ?? true;

  if (removeChildren) {
    // Recursively remove all descendants
    const removeRecursive = (id: NodeId) => {
      const n = newNodes.get(id);
      if (n) {
        n.childIds.forEach(removeRecursive);
        newNodes.delete(id);
      }
    };
    removeRecursive(nodeId);
  } else {
    // Reassign children to parent
    const children = node.childIds;
    children.forEach((childId) => {
      const child = newNodes.get(childId)!;
      newNodes.set(childId, {
        ...child,
        parentId: node.parentId,
        level: node.level,
      });
    });

    if (node.parentId) {
      const parent = newNodes.get(node.parentId)!;
      // Insert children at the position where the removed node was
      const nodeIndex = parent.childIds.indexOf(nodeId);
      const newChildIds = [...parent.childIds];
      newChildIds.splice(nodeIndex, 1, ...children);
      newNodes.set(node.parentId, { ...parent, childIds: newChildIds });
    } else {
      // Node was a root - children become roots at its position
      const nodeIndex = newRootNodeIds.indexOf(nodeId);
      newRootNodeIds.splice(nodeIndex, 1, ...children);
    }
    newNodes.delete(nodeId);
  }

  // Remove from parent's childIds or rootNodeIds (if not already handled above)
  if (removeChildren) {
    if (node.parentId) {
      const parent = newNodes.get(node.parentId);
      if (parent) {
        newNodes.set(node.parentId, {
          ...parent,
          childIds: parent.childIds.filter((id) => id !== nodeId),
        });
      }
    } else {
      newRootNodeIds = newRootNodeIds.filter((id) => id !== nodeId);
    }
  }

  // Recompute sibling orders
  const updatedNodes = recomputeSiblingOrders(newNodes, newRootNodeIds);

  const result: Diagram = {
    ...diagram,
    nodes: updatedNodes,
    rootNodeIds: newRootNodeIds,
  };

  return recomputeAllLevels(result);
}

/**
 * Promote a node (move up one level in hierarchy)
 *
 * @param diagram The diagram
 * @param nodeId The node to promote
 * @returns New diagram with the node promoted
 */
export function promoteNode(diagram: Diagram, nodeId: NodeId): Diagram {
  const node = diagram.nodes.get(nodeId);
  if (!node || !node.parentId) return diagram; // Can't promote root

  const parent = diagram.nodes.get(node.parentId)!;
  const newNodes = new Map(diagram.nodes);
  const newRootNodeIds = [...diagram.rootNodeIds];

  // Remove from parent's children
  newNodes.set(parent.id, {
    ...parent,
    childIds: parent.childIds.filter((id) => id !== nodeId),
  });

  // Update node's level and parent
  const promotedNode = {
    ...node,
    level: parent.level,
    parentId: parent.parentId,
  };
  newNodes.set(nodeId, promotedNode);

  // Add to grandparent's children (or root)
  if (parent.parentId) {
    const grandparent = newNodes.get(parent.parentId)!;
    const parentIndex = grandparent.childIds.indexOf(parent.id);
    const newChildIds = [...grandparent.childIds];
    newChildIds.splice(parentIndex + 1, 0, nodeId);
    newNodes.set(grandparent.id, { ...grandparent, childIds: newChildIds });
  } else {
    const parentIndex = newRootNodeIds.indexOf(parent.id);
    newRootNodeIds.splice(parentIndex + 1, 0, nodeId);
  }

  const updatedNodes = recomputeSiblingOrders(newNodes, newRootNodeIds);

  const result: Diagram = {
    ...diagram,
    nodes: updatedNodes,
    rootNodeIds: newRootNodeIds,
  };

  return recomputeAllLevels(result);
}

/**
 * Demote a node (move down one level by becoming child of previous sibling)
 *
 * @param diagram The diagram
 * @param nodeId The node to demote
 * @returns New diagram with the node demoted
 */
export function demoteNode(diagram: Diagram, nodeId: NodeId): Diagram {
  const node = diagram.nodes.get(nodeId);
  if (!node) return diagram;

  // Find previous sibling to become parent
  const siblings = node.parentId ? diagram.nodes.get(node.parentId)!.childIds : diagram.rootNodeIds;

  const nodeIndex = siblings.indexOf(nodeId);
  if (nodeIndex === 0) return diagram; // Can't demote first sibling

  const newParentId = siblings[nodeIndex - 1];
  const newParent = diagram.nodes.get(newParentId)!;
  const newNodes = new Map(diagram.nodes);
  let newRootNodeIds = [...diagram.rootNodeIds];

  // Remove from current parent/root
  if (node.parentId) {
    const parent = newNodes.get(node.parentId)!;
    newNodes.set(parent.id, {
      ...parent,
      childIds: parent.childIds.filter((id) => id !== nodeId),
    });
  } else {
    newRootNodeIds = newRootNodeIds.filter((id) => id !== nodeId);
  }

  // Add as child of previous sibling
  newNodes.set(newParentId, {
    ...newParent,
    childIds: [...newParent.childIds, nodeId],
  });

  newNodes.set(nodeId, {
    ...node,
    level: newParent.level + 1,
    parentId: newParentId,
  });

  const updatedNodes = recomputeSiblingOrders(newNodes, newRootNodeIds);

  const result: Diagram = {
    ...diagram,
    nodes: updatedNodes,
    rootNodeIds: newRootNodeIds,
  };

  return recomputeAllLevels(result);
}

/**
 * Move a node up among its siblings
 *
 * @param diagram The diagram
 * @param nodeId The node to move up
 * @returns New diagram with the node moved up
 */
export function moveNodeUp(diagram: Diagram, nodeId: NodeId): Diagram {
  const node = diagram.nodes.get(nodeId);
  if (!node) return diagram;

  const siblings = node.parentId ? diagram.nodes.get(node.parentId)!.childIds : diagram.rootNodeIds;

  const nodeIndex = siblings.indexOf(nodeId);
  if (nodeIndex === 0) return diagram; // Already first

  const newNodes = new Map(diagram.nodes);
  let newRootNodeIds = [...diagram.rootNodeIds];

  // Swap with previous sibling
  const newSiblings = [...siblings];
  [newSiblings[nodeIndex - 1], newSiblings[nodeIndex]] = [
    newSiblings[nodeIndex],
    newSiblings[nodeIndex - 1],
  ];

  if (node.parentId) {
    const parent = newNodes.get(node.parentId)!;
    newNodes.set(parent.id, { ...parent, childIds: newSiblings });
  } else {
    newRootNodeIds = newSiblings;
  }

  const updatedNodes = recomputeSiblingOrders(newNodes, newRootNodeIds);

  const result: Diagram = {
    ...diagram,
    nodes: updatedNodes,
    rootNodeIds: newRootNodeIds,
  };

  return recomputeAllLevels(result);
}

/**
 * Move a node down among its siblings
 *
 * @param diagram The diagram
 * @param nodeId The node to move down
 * @returns New diagram with the node moved down
 */
export function moveNodeDown(diagram: Diagram, nodeId: NodeId): Diagram {
  const node = diagram.nodes.get(nodeId);
  if (!node) return diagram;

  const siblings = node.parentId ? diagram.nodes.get(node.parentId)!.childIds : diagram.rootNodeIds;

  const nodeIndex = siblings.indexOf(nodeId);
  if (nodeIndex === siblings.length - 1) return diagram; // Already last

  const newNodes = new Map(diagram.nodes);
  let newRootNodeIds = [...diagram.rootNodeIds];

  // Swap with next sibling
  const newSiblings = [...siblings];
  [newSiblings[nodeIndex], newSiblings[nodeIndex + 1]] = [
    newSiblings[nodeIndex + 1],
    newSiblings[nodeIndex],
  ];

  if (node.parentId) {
    const parent = newNodes.get(node.parentId)!;
    newNodes.set(parent.id, { ...parent, childIds: newSiblings });
  } else {
    newRootNodeIds = newSiblings;
  }

  const updatedNodes = recomputeSiblingOrders(newNodes, newRootNodeIds);

  const result: Diagram = {
    ...diagram,
    nodes: updatedNodes,
    rootNodeIds: newRootNodeIds,
  };

  return recomputeAllLevels(result);
}

/**
 * Update the text content of a node
 *
 * @param diagram The diagram
 * @param nodeId The node to update
 * @param text The new text content
 * @returns New diagram with the node text updated
 */
export function updateNodeText(diagram: Diagram, nodeId: NodeId, text: string): Diagram {
  const node = diagram.nodes.get(nodeId);
  if (!node) return diagram;

  const newNodes = new Map(diagram.nodes);
  newNodes.set(nodeId, { ...node, text });

  return {
    ...diagram,
    nodes: newNodes,
  };
}

/**
 * Get nodes in document order (depth-first traversal)
 *
 * @param diagram The diagram
 * @returns Array of nodes in document order
 */
export function getOrderedNodes(diagram: Diagram): DiagramNode[] {
  const result: DiagramNode[] = [];

  const traverse = (nodeId: NodeId) => {
    const node = diagram.nodes.get(nodeId);
    if (!node) return;
    result.push(node);
    // Sort children by siblingOrder before traversing
    [...node.childIds]
      .sort((a, b) => {
        const nodeA = diagram.nodes.get(a);
        const nodeB = diagram.nodes.get(b);
        if (!nodeA || !nodeB) return 0;
        return nodeA.siblingOrder - nodeB.siblingOrder;
      })
      .forEach(traverse);
  };

  // Sort root nodes by siblingOrder
  [...diagram.rootNodeIds]
    .sort((a, b) => {
      const nodeA = diagram.nodes.get(a);
      const nodeB = diagram.nodes.get(b);
      if (!nodeA || !nodeB) return 0;
      return nodeA.siblingOrder - nodeB.siblingOrder;
    })
    .forEach(traverse);

  return result;
}

/**
 * Get the depth of a node in the hierarchy
 *
 * @param diagram The diagram
 * @param nodeId The node to measure depth for
 * @returns Depth (0 for root, 1 for child of root, etc.)
 */
export function getNodeDepth(diagram: Diagram, nodeId: NodeId): number {
  let depth = 0;
  let node = diagram.nodes.get(nodeId);

  while (node?.parentId) {
    depth++;
    node = diagram.nodes.get(node.parentId);
  }

  return depth;
}

/**
 * Helper to recompute sibling orders after structural changes
 */
function recomputeSiblingOrders(
  nodes: Map<NodeId, DiagramNode>,
  rootNodeIds: NodeId[],
): Map<NodeId, DiagramNode> {
  const updatedNodes = new Map(nodes);

  rootNodeIds.forEach((id, i) => {
    const node = updatedNodes.get(id);
    if (node) {
      updatedNodes.set(id, { ...node, siblingOrder: i });
    }
  });

  updatedNodes.forEach((node) => {
    node.childIds.forEach((childId, i) => {
      const child = updatedNodes.get(childId);
      if (child) {
        updatedNodes.set(childId, { ...child, siblingOrder: i });
      }
    });
  });

  return updatedNodes;
}
