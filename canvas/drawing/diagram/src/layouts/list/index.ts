/**
 * List Layouts
 *
 * Layouts for showing sequential or grouped blocks of information.
 * List layouts typically don't use connectors and stack items vertically or horizontally.
 *
 * Includes:
 * - BasicBlockListLayout: Simple vertical blocks
 * - VerticalBlockListLayout: Blocks with accent bars
 * - StackedListLayout: Stacked overlapping cards
 * - HorizontalBulletListLayout: Horizontal bullet points
 * - SquareAccentListLayout: Square accent markers
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
 * Basic Block List - Simple vertical stack of blocks
 */
export class BasicBlockListLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (dominated by sorting)
   * @sideEffects None - pure function
   */
  compute(
    nodes: Map<NodeId, NodeHierarchyInfo>,
    rootNodeIds: NodeId[],
    bounds: { width: number; height: number },
    _options: Record<string, unknown>,
    _connectorRouter?: IConnectorRouter,
  ): LayoutResult {
    // Clear bounds cache at the start of each layout computation
    this._boundsCache.clear();

    const sortedRoots = this.getSortedChildren(rootNodeIds, nodes);
    const nodeHeight = 60;
    const spacing = 10;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    sortedRoots.forEach((id, index) => {
      positions.set(id, {
        x: 0,
        y: index * (nodeHeight + spacing),
        width: bounds.width,
        height: nodeHeight,
        rotation: 0,
      });
    });

    const totalHeight =
      sortedRoots.length > 0
        ? sortedRoots.length * nodeHeight + (sortedRoots.length - 1) * spacing
        : 0;

    return {
      positions,
      connectors: [],
      bounds: {
        width: bounds.width,
        height: totalHeight,
      },
    };
  }
}

/**
 * Vertical Block List - Blocks with accent bars on left
 */
export class VerticalBlockListLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (dominated by sorting)
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
    const nodeHeight = 70;
    const spacing = 15;
    const accentWidth = 8;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    sortedRoots.forEach((id, index) => {
      positions.set(id, {
        x: accentWidth + 10, // Offset for accent bar
        y: index * (nodeHeight + spacing),
        width: bounds.width - accentWidth - 10,
        height: nodeHeight,
        rotation: 0,
      });
    });

    const totalHeight =
      sortedRoots.length > 0
        ? sortedRoots.length * nodeHeight + (sortedRoots.length - 1) * spacing
        : 0;

    return {
      positions,
      connectors: [],
      bounds: {
        width: bounds.width,
        height: totalHeight,
      },
    };
  }
}

/**
 * Stacked List - Overlapping card style
 */
export class StackedListLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (dominated by sorting)
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
    const nodeHeight = 80;
    const overlapAmount = 20;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    sortedRoots.forEach((id, index) => {
      positions.set(id, {
        x: index * 10, // Slight horizontal offset for stacking effect
        y: index * (nodeHeight - overlapAmount),
        width: bounds.width - sortedRoots.length * 10,
        height: nodeHeight,
        rotation: 0,
      });
    });

    const totalHeight =
      sortedRoots.length > 0
        ? nodeHeight + (sortedRoots.length - 1) * (nodeHeight - overlapAmount)
        : 0;

    return {
      positions,
      connectors: [],
      bounds: {
        width: bounds.width,
        height: totalHeight,
      },
    };
  }
}

/**
 * Horizontal Bullet List - Horizontal arrangement with bullets
 */
export class HorizontalBulletListLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (dominated by sorting)
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
    const spacing = 20;
    const nodeWidth = count > 0 ? (bounds.width - (count - 1) * spacing) / count : bounds.width;
    const nodeHeight = bounds.height;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    sortedRoots.forEach((id, index) => {
      positions.set(id, {
        x: index * (nodeWidth + spacing),
        y: 0,
        width: nodeWidth,
        height: nodeHeight,
        rotation: 0,
      });
    });

    return {
      positions,
      connectors: [],
      bounds,
    };
  }
}

/**
 * Square Accent List - Items with square accent markers
 */
export class SquareAccentListLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (dominated by sorting)
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
    const nodeHeight = 50;
    const spacing = 20;
    const accentSize = 20;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    sortedRoots.forEach((id, index) => {
      positions.set(id, {
        x: accentSize + 15,
        y: index * (nodeHeight + spacing),
        width: bounds.width - accentSize - 15,
        height: nodeHeight,
        rotation: 0,
      });
    });

    const totalHeight =
      sortedRoots.length > 0
        ? sortedRoots.length * nodeHeight + (sortedRoots.length - 1) * spacing
        : 0;

    return {
      positions,
      connectors: [],
      bounds: {
        width: bounds.width,
        height: totalHeight,
      },
    };
  }
}

// =============================================================================
// Implementation Registry
// =============================================================================

/**
 * Map of layout IDs to their implementations
 */
export const listImplementations = new Map<string, ILayoutAlgorithm>([
  ['list/basic-block-list', new BasicBlockListLayout()],
  ['list/vertical-block-list', new VerticalBlockListLayout()],
  ['list/stacked-list', new StackedListLayout()],
  ['list/horizontal-bullet-list', new HorizontalBulletListLayout()],
  ['list/square-accent-list', new SquareAccentListLayout()],
]);

// =============================================================================
// Layout Registration
// =============================================================================

/**
 * Register all list layouts with the registry.
 *
 * @param registry Layout registry to register with
 */
export function registerListLayouts(registry: ILayoutRegistry): void {
  registry.register({
    id: 'list/basic-block-list',
    name: 'Basic Block List',
    description: 'Use to show non-sequential or grouped blocks of information',
    category: 'list',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 2,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'linear-vertical',
    thumbnail: '',
  });

  registry.register({
    id: 'list/vertical-block-list',
    name: 'Vertical Block List',
    description: 'Use to show groups of information or steps in a task with accent bars',
    category: 'list',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 2,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'linear-vertical',
    thumbnail: '',
  });

  registry.register({
    id: 'list/stacked-list',
    name: 'Stacked List',
    description: 'Use to show groups of information in a stacked, overlapping style',
    category: 'list',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'linear-vertical',
    thumbnail: '',
  });

  registry.register({
    id: 'list/horizontal-bullet-list',
    name: 'Horizontal Bullet List',
    description: 'Use to show non-sequential or grouped information horizontally',
    category: 'list',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 2,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'linear-horizontal',
    thumbnail: '',
  });

  registry.register({
    id: 'list/square-accent-list',
    name: 'Square Accent List',
    description: 'Use to show lists of information with square accent markers',
    category: 'list',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 2,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'linear-vertical',
    thumbnail: '',
  });
}
