/**
 * Base Layout Algorithm (DEPRECATED)
 *
 * @deprecated This base class is for hardcoded layout implementations that are
 * being replaced by the new OOXML layout engine. New layouts should be defined
 * as LayoutDefinition objects in `src/definitions/` and rendered by the engine
 * in `src/engine/layout-engine.ts`.
 *
 * Abstract base class for all Diagram layout algorithms.
 * Provides shared utilities for:
 * - Tree bounds computation with memoization
 * - Node distribution calculations
 * - Sorted sibling access
 *
 * All layout algorithms must be PURE FUNCTIONS - they should not have
 * side effects and should produce the same output for the same input.
 */

import type { ILayoutAlgorithm, LayoutResult, NodeId } from '@mog-sdk/contracts/diagram';
import type { IConnectorRouter, NodeHierarchyInfo } from './types';

// =============================================================================
// Types
// =============================================================================

// NodeHierarchyInfo and NodePosition live in `./types` (shared with
// connector-router). Re-exported here for backward-compatible imports.
export type { NodeHierarchyInfo, NodePosition } from './types';

// =============================================================================
// Base Layout Algorithm
// =============================================================================

/**
 * Abstract base class for layout algorithms.
 *
 * Subclasses must implement the compute() method to calculate
 * node positions and connector paths.
 *
 * @example
 * ```typescript
 * class MyLayout extends BaseLayoutAlgorithm {
 *   compute(nodes, rootNodeIds, bounds, options, connectorRouter): LayoutResult {
 *     // Clear cache first
 *     this._boundsCache.clear();
 *
 *     // Calculate positions...
 *     return { positions, connectors, bounds };
 *   }
 * }
 * ```
 */
export abstract class BaseLayoutAlgorithm implements ILayoutAlgorithm {
  /**
   * Cache for computeTreeBounds results to avoid O(n^2) complexity on deep trees.
   *
   * IMPORTANT: Must be cleared at the start of each compute() call
   * to ensure fresh calculations per layout.
   */
  protected _boundsCache = new Map<string, { width: number; height: number }>();

  /**
   * Compute layout positions for all nodes.
   *
   * @param nodes Map of NodeId to hierarchy info
   * @param rootNodeIds Ordered array of root node IDs
   * @param bounds Available space for layout
   * @param options Layout-specific options
   * @param connectorRouter Optional router for connector paths
   * @returns Computed positions and connector paths
   *
   * @complexity Varies by implementation (documented per subclass)
   * @sideEffects None - pure function (must clear _boundsCache at start)
   */
  abstract compute(
    nodes: Map<NodeId, NodeHierarchyInfo>,
    rootNodeIds: NodeId[],
    bounds: { width: number; height: number },
    options: Record<string, unknown>,
    connectorRouter?: IConnectorRouter,
  ): LayoutResult;

  // ===========================================================================
  // Tree Bounds Computation
  // ===========================================================================

  /**
   * Compute the total bounds of a subtree rooted at a node.
   *
   * Uses memoization via _boundsCache to avoid O(n^2) complexity
   * on deep trees (100+ levels).
   *
   * @param nodeId Root node of subtree
   * @param nodes All nodes in the diagram
   * @param nodeWidth Width of each node
   * @param nodeHeight Height of each node
   * @param hSpacing Horizontal spacing between siblings
   * @param vSpacing Vertical spacing between levels
   * @returns Total width and height of the subtree
   *
   * @complexity O(n) for n nodes with memoization
   * @sideEffects Writes to _boundsCache (must clear at start of compute())
   */
  protected computeTreeBounds(
    nodeId: NodeId,
    nodes: Map<NodeId, { childIds: NodeId[] }>,
    nodeWidth: number,
    nodeHeight: number,
    hSpacing: number,
    vSpacing: number,
  ): { width: number; height: number } {
    const cacheKey = `${nodeId}-${nodeWidth}-${nodeHeight}-${hSpacing}-${vSpacing}`;

    if (this._boundsCache.has(cacheKey)) {
      return this._boundsCache.get(cacheKey)!;
    }

    const node = nodes.get(nodeId);
    if (!node || node.childIds.length === 0) {
      const result = { width: nodeWidth, height: nodeHeight };
      this._boundsCache.set(cacheKey, result);
      return result;
    }

    const childBounds = node.childIds.map((childId) =>
      this.computeTreeBounds(childId, nodes, nodeWidth, nodeHeight, hSpacing, vSpacing),
    );

    const totalChildWidth =
      childBounds.reduce((sum, b) => sum + b.width, 0) + (childBounds.length - 1) * hSpacing;

    const maxChildHeight = Math.max(...childBounds.map((b) => b.height));

    const result = {
      width: Math.max(nodeWidth, totalChildWidth),
      height: nodeHeight + vSpacing + maxChildHeight,
    };

    this._boundsCache.set(cacheKey, result);
    return result;
  }

  // ===========================================================================
  // Node Ordering
  // ===========================================================================

  /**
   * Get nodes sorted by siblingOrder.
   *
   * @param nodeIds Array of node IDs to sort
   * @param nodes Map containing siblingOrder for each node
   * @returns New array sorted by siblingOrder
   *
   * @complexity O(n log n) for n nodes
   * @sideEffects None - pure function (creates new array)
   */
  protected getSortedChildren(
    nodeIds: NodeId[],
    nodes: Map<NodeId, { siblingOrder: number }>,
  ): NodeId[] {
    return [...nodeIds].sort((a, b) => {
      const nodeA = nodes.get(a);
      const nodeB = nodes.get(b);
      if (!nodeA || !nodeB) return 0;
      return nodeA.siblingOrder - nodeB.siblingOrder;
    });
  }
}
