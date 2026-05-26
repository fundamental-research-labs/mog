/**
 * Matrix Layouts
 *
 * Layouts for showing relationships in quadrants or grid arrangements.
 * Matrix layouts typically have a 2x2 structure with optional center.
 *
 * Includes:
 * - BasicMatrixLayout: Simple 2x2 grid
 * - TitledMatrixLayout: 2x2 with title areas
 * - GridMatrixLayout: Expandable grid
 * - CycleMatrixLayout: 2x2 with cycle connections
 * - ConvergingMatrixLayout: 4 corners converging to center
 */

import type {
  ILayoutAlgorithm,
  ILayoutRegistry,
  LayoutResult,
  NodeId,
} from '@mog-sdk/contracts/diagram';
import { BaseLayoutAlgorithm, type NodeHierarchyInfo } from '../base-layout';
import { DirectConnectorRouter, type IConnectorRouter } from '../connector-router';

// =============================================================================
// Layout Implementations
// =============================================================================

/**
 * Basic Matrix - Simple 2x2 grid
 */
export class BasicMatrixLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (max 4)
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
    const count = Math.min(sortedRoots.length, 4); // Matrix limited to 4
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    if (count === 0) {
      return { positions, connectors: [], bounds };
    }

    const gap = 10;
    const cellWidth = (bounds.width - gap) / 2;
    const cellHeight = (bounds.height - gap) / 2;

    // 2x2 grid positions
    const gridPositions = [
      { x: 0, y: 0 },
      { x: cellWidth + gap, y: 0 },
      { x: 0, y: cellHeight + gap },
      { x: cellWidth + gap, y: cellHeight + gap },
    ];

    sortedRoots.slice(0, 4).forEach((id, index) => {
      const pos = gridPositions[index];
      positions.set(id, {
        x: pos.x,
        y: pos.y,
        width: cellWidth,
        height: cellHeight,
        rotation: 0,
      });
    });

    return { positions, connectors: [], bounds };
  }
}

/**
 * Titled Matrix - 2x2 with title bars
 */
export class TitledMatrixLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (max 4)
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
    const count = Math.min(sortedRoots.length, 4);
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    if (count === 0) {
      return { positions, connectors: [], bounds };
    }

    const gap = 15;
    const titleHeight = 30;
    const cellWidth = (bounds.width - gap) / 2;
    const cellHeight = (bounds.height - gap - titleHeight) / 2;

    const gridPositions = [
      { x: 0, y: titleHeight },
      { x: cellWidth + gap, y: titleHeight },
      { x: 0, y: titleHeight + cellHeight + gap },
      { x: cellWidth + gap, y: titleHeight + cellHeight + gap },
    ];

    sortedRoots.slice(0, 4).forEach((id, index) => {
      const pos = gridPositions[index];
      positions.set(id, {
        x: pos.x,
        y: pos.y,
        width: cellWidth,
        height: cellHeight,
        rotation: 0,
      });
    });

    return { positions, connectors: [], bounds };
  }
}

/**
 * Grid Matrix - Flexible grid layout
 */
export class GridMatrixLayout extends BaseLayoutAlgorithm {
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

    // Calculate grid dimensions (try to make it as square as possible)
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const gap = 10;
    const cellWidth = (bounds.width - (cols - 1) * gap) / cols;
    const cellHeight = (bounds.height - (rows - 1) * gap) / rows;

    sortedRoots.forEach((id, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);

      positions.set(id, {
        x: col * (cellWidth + gap),
        y: row * (cellHeight + gap),
        width: cellWidth,
        height: cellHeight,
        rotation: 0,
      });
    });

    return { positions, connectors: [], bounds };
  }
}

/**
 * Cycle Matrix - 2x2 with circular flow
 */
export class CycleMatrixLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (max 4)
   * @sideEffects None - pure function
   */
  compute(
    nodes: Map<NodeId, NodeHierarchyInfo>,
    rootNodeIds: NodeId[],
    bounds: { width: number; height: number },
    _options: Record<string, unknown>,
    connectorRouter?: IConnectorRouter,
  ): LayoutResult {
    this._boundsCache.clear();

    const sortedRoots = this.getSortedChildren(rootNodeIds, nodes);
    const count = Math.min(sortedRoots.length, 4);
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    if (count === 0) {
      return { positions, connectors, bounds };
    }

    const router = connectorRouter ?? new DirectConnectorRouter();

    const gap = 30;
    const cellWidth = (bounds.width - gap) / 2;
    const cellHeight = (bounds.height - gap) / 2;

    // Position in clockwise order for cycle: top-left, top-right, bottom-right, bottom-left
    const gridPositions = [
      { x: 0, y: 0 },
      { x: cellWidth + gap, y: 0 },
      { x: cellWidth + gap, y: cellHeight + gap },
      { x: 0, y: cellHeight + gap },
    ];

    sortedRoots.slice(0, 4).forEach((id, index) => {
      const pos = gridPositions[index];
      positions.set(id, {
        x: pos.x,
        y: pos.y,
        width: cellWidth,
        height: cellHeight,
        rotation: 0,
      });
    });

    // Add cycle connectors if we have 4 nodes
    if (count === 4) {
      const cycleOrder = [0, 1, 2, 3, 0]; // Clockwise cycle
      const connectionSides: Array<{
        from: 'right' | 'bottom' | 'left' | 'top';
        to: 'left' | 'top' | 'right' | 'bottom';
      }> = [
        { from: 'right', to: 'left' },
        { from: 'bottom', to: 'top' },
        { from: 'left', to: 'right' },
        { from: 'top', to: 'bottom' },
      ];

      for (let i = 0; i < 4; i++) {
        const fromId = sortedRoots[cycleOrder[i]];
        const toId = sortedRoots[cycleOrder[i + 1]];
        const sides = connectionSides[i];

        const path = router.route(
          { nodeId: fromId, side: sides.from },
          { nodeId: toId, side: sides.to },
          positions,
          connectors.map((c) => c.path),
          { routingStyle: 'direct' },
        );

        connectors.push({
          fromId,
          toId,
          path,
        });
      }
    }

    return { positions, connectors, bounds };
  }
}

/**
 * Converging Matrix - 4 corners converging to center
 */
export class ConvergingMatrixLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (max 5)
   * @sideEffects None - pure function
   */
  compute(
    nodes: Map<NodeId, NodeHierarchyInfo>,
    rootNodeIds: NodeId[],
    bounds: { width: number; height: number },
    _options: Record<string, unknown>,
    connectorRouter?: IConnectorRouter,
  ): LayoutResult {
    this._boundsCache.clear();

    const sortedRoots = this.getSortedChildren(rootNodeIds, nodes);
    const count = Math.min(sortedRoots.length, 5);
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    if (count === 0) {
      return { positions, connectors, bounds };
    }

    const router = connectorRouter ?? new DirectConnectorRouter();

    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const cornerSize = 70;
    const centerSize = 80;
    const margin = 20;

    // Center node (first node or 5th if we have 5)
    const centerNodeIndex = count === 5 ? 4 : 0;
    const centerId = sortedRoots[centerNodeIndex];

    positions.set(centerId, {
      x: centerX - centerSize / 2,
      y: centerY - centerSize / 2,
      width: centerSize,
      height: centerSize,
      rotation: 0,
    });

    // Corner positions
    const cornerPositions = [
      { x: margin, y: margin }, // top-left
      { x: bounds.width - cornerSize - margin, y: margin }, // top-right
      { x: margin, y: bounds.height - cornerSize - margin }, // bottom-left
      { x: bounds.width - cornerSize - margin, y: bounds.height - cornerSize - margin }, // bottom-right
    ];

    // Place corner nodes (skip the center node if count < 5)
    let cornerIndex = 0;
    sortedRoots.forEach((id, index) => {
      if (index === centerNodeIndex) return;
      if (cornerIndex >= 4) return;

      const pos = cornerPositions[cornerIndex];
      positions.set(id, {
        x: pos.x,
        y: pos.y,
        width: cornerSize,
        height: cornerSize,
        rotation: 0,
      });

      // Add connector to center
      const path = router.route(
        { nodeId: id, side: 'center' },
        { nodeId: centerId, side: 'center' },
        positions,
        connectors.map((c) => c.path),
        { routingStyle: 'direct' },
      );

      connectors.push({
        fromId: id,
        toId: centerId,
        path,
      });

      cornerIndex++;
    });

    return { positions, connectors, bounds };
  }
}

// =============================================================================
// Implementation Registry
// =============================================================================

export const matrixImplementations = new Map<string, ILayoutAlgorithm>([
  ['matrix/basic-matrix', new BasicMatrixLayout()],
  ['matrix/titled-matrix', new TitledMatrixLayout()],
  ['matrix/grid-matrix', new GridMatrixLayout()],
  ['matrix/cycle-matrix', new CycleMatrixLayout()],
  ['matrix/converging-matrix', new ConvergingMatrixLayout()],
]);

// =============================================================================
// Layout Registration
// =============================================================================

export function registerMatrixLayouts(registry: ILayoutRegistry): void {
  registry.register({
    id: 'matrix/basic-matrix',
    name: 'Basic Matrix',
    description: 'Use to show the relationship of components to a whole in quadrants',
    category: 'matrix',
    minNodes: 1,
    maxNodes: 4,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'grid',
    thumbnail: '',
  });

  registry.register({
    id: 'matrix/titled-matrix',
    name: 'Titled Matrix',
    description: 'Use to show relationship of components with titles',
    category: 'matrix',
    minNodes: 1,
    maxNodes: 4,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'grid',
    thumbnail: '',
  });

  registry.register({
    id: 'matrix/grid-matrix',
    name: 'Grid Matrix',
    description: 'Use to show items in a flexible grid arrangement',
    category: 'matrix',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'grid',
    thumbnail: '',
  });

  registry.register({
    id: 'matrix/cycle-matrix',
    name: 'Cycle Matrix',
    description: 'Use to show a cyclical relationship in a 2x2 grid',
    category: 'matrix',
    minNodes: 1,
    maxNodes: 4,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'straight',
    algorithm: 'grid',
    thumbnail: '',
  });

  registry.register({
    id: 'matrix/converging-matrix',
    name: 'Converging Matrix',
    description: 'Use to show items converging to a central idea',
    category: 'matrix',
    minNodes: 1,
    maxNodes: 5,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'straight',
    algorithm: 'grid',
    thumbnail: '',
  });
}
