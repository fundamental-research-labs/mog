/**
 * Diagram Text Model (Outline Parsing)
 *
 * Pure functions for parsing and generating outline text representations
 * of Diagram diagrams. Used for the text pane editing experience.
 */

import type { NodeId, Diagram, DiagramNode } from '@mog-sdk/contracts/diagram';
import { createNode, getOrderedNodes } from './node';

/**
 * Represents a parsed outline node (text and level)
 */
export interface OutlineNode {
  text: string;
  level: number;
}

/**
 * Parse text pane outline into node structure
 *
 * Format supports:
 * - Indentation with tabs or 2 spaces per level
 * - Optional bullet prefixes (- or bullet character)
 *
 * Example:
 * ```
 * First level
 *   Second level
 *     Third level
 *   Another second level
 * ```
 *
 * @param text The outline text to parse
 * @returns Array of parsed outline nodes
 */
export function parseOutline(text: string): OutlineNode[] {
  const lines = text.split('\n');
  const result: OutlineNode[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // Count leading tabs or spaces (2 spaces = 1 level)
    let level = 0;
    let i = 0;
    while (i < line.length) {
      if (line[i] === '\t') {
        level++;
        i++;
      } else if (line[i] === ' ' && line[i + 1] === ' ') {
        level++;
        i += 2;
      } else {
        break;
      }
    }

    // Remove bullet if present
    let content = line.slice(i).trim();
    if (content.startsWith('- ') || content.startsWith('\u2022 ')) {
      content = content.slice(2);
    }

    result.push({ text: content, level });
  }

  return result;
}

/**
 * Rebuild diagram nodes from outline
 *
 * Creates a new node structure from the parsed outline, replacing
 * all existing nodes in the diagram.
 *
 * @param diagram The diagram to update
 * @param outline The parsed outline nodes
 * @returns New diagram with nodes rebuilt from outline
 */
export function applyOutlineToDiagram(diagram: Diagram, outline: OutlineNode[]): Diagram {
  if (outline.length === 0) {
    // Return diagram with empty nodes
    return {
      ...diagram,
      nodes: new Map(),
      rootNodeIds: [],
    };
  }

  const newNodes = new Map<NodeId, DiagramNode>();
  const newRootNodeIds: NodeId[] = [];
  const parentStack: NodeId[] = [];

  for (let i = 0; i < outline.length; i++) {
    const { text, level } = outline[i];

    // Adjust parent stack to current level
    while (parentStack.length > level) {
      parentStack.pop();
    }

    const parentId = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null;
    const node = createNode({ text, level, parentId });

    newNodes.set(node.id, node);

    if (parentId) {
      const parent = newNodes.get(parentId)!;
      const newChildIds = [...parent.childIds, node.id];
      newNodes.set(parentId, {
        ...parent,
        childIds: newChildIds,
      });
      // Update sibling order based on position in parent's children
      newNodes.set(node.id, {
        ...newNodes.get(node.id)!,
        siblingOrder: newChildIds.length - 1,
      });
    } else {
      newRootNodeIds.push(node.id);
      // Update sibling order based on position in root nodes
      newNodes.set(node.id, {
        ...newNodes.get(node.id)!,
        siblingOrder: newRootNodeIds.length - 1,
      });
    }

    // Update parent stack - set this node as potential parent at this level
    parentStack[level] = node.id;
  }

  return {
    ...diagram,
    nodes: newNodes,
    rootNodeIds: newRootNodeIds,
  };
}

/**
 * Convert diagram to text pane outline format
 *
 * Generates a string representation of the diagram structure
 * suitable for display in a text pane.
 *
 * @param diagram The diagram to convert
 * @returns Outline text representation
 */
export function diagramToOutline(diagram: Diagram): string {
  const orderedNodes = getOrderedNodes(diagram);

  return orderedNodes
    .map((node) => {
      const indent = '\t'.repeat(node.level);
      const bullet = '\u2022 ';
      return `${indent}${bullet}${node.text}`;
    })
    .join('\n');
}
