/**
 * Diagram Diagram Model
 *
 * Pure functions for creating and manipulating Diagram diagrams.
 * All functions return new objects (immutable patterns).
 */

import type { NodeId, Diagram, DiagramLayoutDefinition } from '@mog-sdk/contracts/diagram';
import { getDiagramDefault } from '../defaults/diagram-defaults';
import { createNode, recomputeAllLevels } from './node';

/**
 * Create a new Diagram diagram with a default root node
 *
 * @param layoutDefinition The layout definition to use
 * @returns A new diagram with one root node
 */
export function createDiagram(layoutDefinition: DiagramLayoutDefinition): Diagram {
  const rootNode = createNode({ text: '[Text]', level: 0, parentId: null });

  return {
    layoutId: layoutDefinition.id,
    category: layoutDefinition.category,
    nodes: new Map([[rootNode.id, rootNode]]),
    rootNodeIds: [rootNode.id],
    quickStyleId: getDiagramDefault('quickStyleId') as string,
    colorThemeId: getDiagramDefault('colorThemeId') as string,
    layoutOptions: {},
  };
}

/**
 * Change the layout of a diagram while preserving nodes
 *
 * If the new layout doesn't support hierarchy (supportsChildren === false),
 * all nodes will be flattened to level 0.
 *
 * @param diagram The diagram to change
 * @param newLayoutDefinition The new layout definition
 * @returns New diagram with the layout changed
 */
export function changeLayout(
  diagram: Diagram,
  newLayoutDefinition: DiagramLayoutDefinition,
): Diagram {
  // Preserve nodes, change layout
  // May need to flatten hierarchy if new layout doesn't support it
  const needsFlatten =
    !newLayoutDefinition.supportsChildren &&
    Array.from(diagram.nodes.values()).some((n) => n.level > 0);

  if (needsFlatten) {
    // Flatten all nodes to level 0
    const flattenedNodes = new Map(diagram.nodes);
    const newRootIds: NodeId[] = [];

    // Get all nodes and flatten them, preserving order
    // We need to traverse in order to maintain visual order
    const traverse = (nodeId: NodeId) => {
      const node = flattenedNodes.get(nodeId);
      if (!node) return;

      newRootIds.push(nodeId);
      flattenedNodes.set(nodeId, {
        ...node,
        level: 0,
        parentId: null,
        childIds: [],
        siblingOrder: newRootIds.length - 1,
      });

      // Traverse children in order
      [...node.childIds]
        .sort((a, b) => {
          const nodeA = flattenedNodes.get(a);
          const nodeB = flattenedNodes.get(b);
          if (!nodeA || !nodeB) return 0;
          return nodeA.siblingOrder - nodeB.siblingOrder;
        })
        .forEach(traverse);
    };

    // Start with root nodes in order
    [...diagram.rootNodeIds]
      .sort((a, b) => {
        const nodeA = diagram.nodes.get(a);
        const nodeB = diagram.nodes.get(b);
        if (!nodeA || !nodeB) return 0;
        return nodeA.siblingOrder - nodeB.siblingOrder;
      })
      .forEach(traverse);

    const result: Diagram = {
      ...diagram,
      layoutId: newLayoutDefinition.id,
      category: newLayoutDefinition.category,
      nodes: flattenedNodes,
      rootNodeIds: newRootIds,
    };

    return recomputeAllLevels(result);
  }

  const result: Diagram = {
    ...diagram,
    layoutId: newLayoutDefinition.id,
    category: newLayoutDefinition.category,
  };

  return recomputeAllLevels(result);
}

/**
 * Set the quick style of a diagram
 *
 * @param diagram The diagram
 * @param styleId The quick style ID
 * @returns New diagram with the style changed
 */
export function setQuickStyle(diagram: Diagram, styleId: string): Diagram {
  return {
    ...diagram,
    quickStyleId: styleId,
  };
}

/**
 * Set the color theme of a diagram
 *
 * @param diagram The diagram
 * @param themeId The color theme ID
 * @returns New diagram with the theme changed
 */
export function setColorTheme(diagram: Diagram, themeId: string): Diagram {
  return {
    ...diagram,
    colorThemeId: themeId,
  };
}

/**
 * Set layout-specific options for a diagram
 *
 * @param diagram The diagram
 * @param options Layout-specific options to merge
 * @returns New diagram with options updated
 */
export function setLayoutOptions(diagram: Diagram, options: Record<string, unknown>): Diagram {
  return {
    ...diagram,
    layoutOptions: { ...diagram.layoutOptions, ...options },
  };
}
