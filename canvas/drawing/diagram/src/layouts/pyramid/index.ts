/**
 * Pyramid Layouts
 *
 * Layouts for showing proportional, hierarchical, or triangular relationships.
 *
 * Includes:
 * - BasicPyramidLayout: Standard pyramid (widest at bottom)
 * - InvertedPyramidLayout: Inverted pyramid (widest at top)
 * - SegmentedPyramidLayout: Pyramid with visible segments
 * - PyramidListLayout: Pyramid with side text labels
 * - BalancePyramidLayout: Pyramid showing two contrasting sides
 */

import type {
  ILayoutAlgorithm,
  ILayoutRegistry,
  LayoutResult,
  NodeId,
} from '@mog-sdk/contracts/diagram';
import { BaseLayoutAlgorithm, type NodeHierarchyInfo } from '../base-layout';
import type { IConnectorRouter } from '../connector-router';

// =============================================================================
// Layout Implementations
// =============================================================================

/**
 * Basic Pyramid - Standard pyramid shape (widest at bottom)
 */
export class BasicPyramidLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes
   * @sideEffects None - pure function
   */
  compute(
    nodes: Map<NodeId, NodeHierarchyInfo>,
    rootNodeIds: NodeId[],
    bounds: { width: number; height: number },
    _options: Record<string, unknown>,
    _connectorRouter?: IConnectorRouter,
  ): LayoutResult {
    this._boundsCache.clear();

    const sortedRoots = this.getSortedChildren(rootNodeIds, nodes);
    const count = sortedRoots.length;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    if (count === 0) {
      return { positions, connectors: [], bounds };
    }

    const segmentHeight = bounds.height / count;
    const gap = 3;

    sortedRoots.forEach((id, index) => {
      // Width increases as we go down (index 0 = top, smallest)
      const widthRatio = (index + 1) / count;
      const segmentWidth = bounds.width * widthRatio;
      const x = (bounds.width - segmentWidth) / 2;
      const y = index * segmentHeight;

      positions.set(id, {
        x,
        y: y + gap / 2,
        width: segmentWidth,
        height: segmentHeight - gap,
        rotation: 0,
      });
    });

    return { positions, connectors: [], bounds };
  }
}

/**
 * Inverted Pyramid - Widest at top
 */
export class InvertedPyramidLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes
   * @sideEffects None - pure function
   */
  compute(
    nodes: Map<NodeId, NodeHierarchyInfo>,
    rootNodeIds: NodeId[],
    bounds: { width: number; height: number },
    _options: Record<string, unknown>,
    _connectorRouter?: IConnectorRouter,
  ): LayoutResult {
    this._boundsCache.clear();

    const sortedRoots = this.getSortedChildren(rootNodeIds, nodes);
    const count = sortedRoots.length;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    if (count === 0) {
      return { positions, connectors: [], bounds };
    }

    const segmentHeight = bounds.height / count;
    const gap = 3;

    sortedRoots.forEach((id, index) => {
      // Width decreases as we go down (index 0 = top, largest)
      const widthRatio = (count - index) / count;
      const segmentWidth = bounds.width * widthRatio;
      const x = (bounds.width - segmentWidth) / 2;
      const y = index * segmentHeight;

      positions.set(id, {
        x,
        y: y + gap / 2,
        width: segmentWidth,
        height: segmentHeight - gap,
        rotation: 0,
      });
    });

    return { positions, connectors: [], bounds };
  }
}

/**
 * Segmented Pyramid - Pyramid with visible segment divisions
 */
export class SegmentedPyramidLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes
   * @sideEffects None - pure function
   */
  compute(
    nodes: Map<NodeId, NodeHierarchyInfo>,
    rootNodeIds: NodeId[],
    bounds: { width: number; height: number },
    _options: Record<string, unknown>,
    _connectorRouter?: IConnectorRouter,
  ): LayoutResult {
    this._boundsCache.clear();

    const sortedRoots = this.getSortedChildren(rootNodeIds, nodes);
    const count = sortedRoots.length;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    if (count === 0) {
      return { positions, connectors: [], bounds };
    }

    const segmentHeight = bounds.height / count;
    const gap = 8; // Larger gap for visible segmentation

    sortedRoots.forEach((id, index) => {
      const widthRatio = (index + 1) / count;
      const segmentWidth = bounds.width * widthRatio;
      const x = (bounds.width - segmentWidth) / 2;
      const y = index * segmentHeight;

      positions.set(id, {
        x,
        y: y + gap / 2,
        width: segmentWidth,
        height: segmentHeight - gap,
        rotation: 0,
      });
    });

    return { positions, connectors: [], bounds };
  }
}

/**
 * Pyramid List - Pyramid with text labels on the side
 */
export class PyramidListLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes
   * @sideEffects None - pure function
   */
  compute(
    nodes: Map<NodeId, NodeHierarchyInfo>,
    rootNodeIds: NodeId[],
    bounds: { width: number; height: number },
    _options: Record<string, unknown>,
    _connectorRouter?: IConnectorRouter,
  ): LayoutResult {
    this._boundsCache.clear();

    const sortedRoots = this.getSortedChildren(rootNodeIds, nodes);
    const count = sortedRoots.length;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    if (count === 0) {
      return { positions, connectors: [], bounds };
    }

    // Split width: pyramid on left, text area on right
    const pyramidWidth = bounds.width * 0.5;
    const textWidth = bounds.width * 0.45;
    const textX = pyramidWidth + bounds.width * 0.05;
    const segmentHeight = bounds.height / count;
    const gap = 5;

    sortedRoots.forEach((id, index) => {
      // Pyramid segments on the left (width calculated for reference, not used for positioning)
      const widthRatio = (index + 1) / count;
      const _segmentWidth = pyramidWidth * widthRatio;
      void _segmentWidth; // Preserved for potential future use (pyramid indicator rendering)
      const y = index * segmentHeight;

      // For pyramid list, we use the text area as the main node position
      positions.set(id, {
        x: textX,
        y: y + gap / 2,
        width: textWidth,
        height: segmentHeight - gap,
        rotation: 0,
      });
    });

    return { positions, connectors: [], bounds };
  }
}

/**
 * Balance Pyramid - Shows two contrasting aspects
 */
export class BalancePyramidLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes
   * @sideEffects None - pure function
   */
  compute(
    nodes: Map<NodeId, NodeHierarchyInfo>,
    rootNodeIds: NodeId[],
    bounds: { width: number; height: number },
    _options: Record<string, unknown>,
    _connectorRouter?: IConnectorRouter,
  ): LayoutResult {
    this._boundsCache.clear();

    const sortedRoots = this.getSortedChildren(rootNodeIds, nodes);
    const count = sortedRoots.length;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    if (count === 0) {
      return { positions, connectors: [], bounds };
    }

    const centerX = bounds.width / 2;
    const sideWidth = (bounds.width - 20) / 2; // 20px gap in middle
    const segmentHeight = bounds.height / Math.ceil(count / 2);
    const gap = 5;

    // Split items between left and right sides
    sortedRoots.forEach((id, index) => {
      const isLeft = index % 2 === 0;
      const row = Math.floor(index / 2);
      const y = row * segmentHeight;

      // Segments get narrower toward bottom (like a pyramid split down the middle)
      const rowFromBottom = Math.ceil(count / 2) - row;
      const widthRatio = rowFromBottom / Math.ceil(count / 2);
      const segmentWidth = sideWidth * widthRatio;

      if (isLeft) {
        // Left side - align to center
        positions.set(id, {
          x: centerX - segmentWidth - 10,
          y: y + gap / 2,
          width: segmentWidth,
          height: segmentHeight - gap,
          rotation: 0,
        });
      } else {
        // Right side - align to center
        positions.set(id, {
          x: centerX + 10,
          y: y + gap / 2,
          width: segmentWidth,
          height: segmentHeight - gap,
          rotation: 0,
        });
      }
    });

    return { positions, connectors: [], bounds };
  }
}

// =============================================================================
// Implementation Registry
// =============================================================================

export const pyramidImplementations = new Map<string, ILayoutAlgorithm>([
  ['pyramid/basic-pyramid', new BasicPyramidLayout()],
  ['pyramid/inverted-pyramid', new InvertedPyramidLayout()],
  ['pyramid/segmented-pyramid', new SegmentedPyramidLayout()],
  ['pyramid/pyramid-list', new PyramidListLayout()],
  ['pyramid/balance-pyramid', new BalancePyramidLayout()],
]);

// =============================================================================
// Layout Registration
// =============================================================================

export function registerPyramidLayouts(registry: ILayoutRegistry): void {
  registry.register({
    id: 'pyramid/basic-pyramid',
    name: 'Basic Pyramid',
    description: 'Use to show proportional, interconnected, or hierarchical relationships',
    category: 'pyramid',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'trapezoid',
    defaultConnectorType: 'none',
    algorithm: 'pyramid',
    thumbnail: '',
  });

  registry.register({
    id: 'pyramid/inverted-pyramid',
    name: 'Inverted Pyramid',
    description: 'Use to show proportional relationships with the largest at top',
    category: 'pyramid',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'trapezoid',
    defaultConnectorType: 'none',
    algorithm: 'pyramid',
    thumbnail: '',
  });

  registry.register({
    id: 'pyramid/segmented-pyramid',
    name: 'Segmented Pyramid',
    description: 'Use to show distinct segments in a pyramid structure',
    category: 'pyramid',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'trapezoid',
    defaultConnectorType: 'none',
    algorithm: 'pyramid',
    thumbnail: '',
  });

  registry.register({
    id: 'pyramid/pyramid-list',
    name: 'Pyramid List',
    description: 'Use to show proportional relationships with text descriptions',
    category: 'pyramid',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'pyramid',
    thumbnail: '',
  });

  registry.register({
    id: 'pyramid/balance-pyramid',
    name: 'Balance Pyramid',
    description: 'Use to show two contrasting ideas in a pyramid structure',
    category: 'pyramid',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'pyramid',
    thumbnail: '',
  });
}
