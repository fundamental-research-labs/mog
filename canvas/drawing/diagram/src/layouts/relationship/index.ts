/**
 * Relationship Layouts
 *
 * Layouts for showing connections and relationships between concepts.
 *
 * Includes:
 * - BasicVennLayout: Overlapping circles (Venn diagram)
 * - BasicRadialLayout: Center with satellites
 * - TargetLayout: Nested concentric circles
 * - FunnelLayout: Funnel shape
 * - BalanceLayout: Balance scale arrangement
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
 * Basic Venn - Overlapping circles for 2-5 items
 */
export class BasicVennLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (max 5)
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
    const count = Math.min(sortedRoots.length, 5); // Venn limited to 5
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    if (count === 0) {
      return { positions, connectors: [], bounds };
    }

    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const circleRadius = Math.min(bounds.width, bounds.height) / 4;
    const overlapOffset = circleRadius * 0.6;

    if (count === 1) {
      positions.set(sortedRoots[0], {
        x: centerX - circleRadius,
        y: centerY - circleRadius,
        width: circleRadius * 2,
        height: circleRadius * 2,
        rotation: 0,
      });
    } else if (count === 2) {
      positions.set(sortedRoots[0], {
        x: centerX - overlapOffset - circleRadius,
        y: centerY - circleRadius,
        width: circleRadius * 2,
        height: circleRadius * 2,
        rotation: 0,
      });
      positions.set(sortedRoots[1], {
        x: centerX + overlapOffset - circleRadius,
        y: centerY - circleRadius,
        width: circleRadius * 2,
        height: circleRadius * 2,
        rotation: 0,
      });
    } else if (count === 3) {
      // Triangle arrangement
      const triangleRadius = circleRadius * 0.7;
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * 2 * Math.PI - Math.PI / 2;
        positions.set(sortedRoots[i], {
          x: centerX + triangleRadius * Math.cos(angle) - circleRadius,
          y: centerY + triangleRadius * Math.sin(angle) - circleRadius,
          width: circleRadius * 2,
          height: circleRadius * 2,
          rotation: 0,
        });
      }
    } else if (count === 4) {
      // Square arrangement
      const squareOffset = circleRadius * 0.5;
      const quadrantOffsets = [
        { x: -squareOffset, y: -squareOffset },
        { x: squareOffset, y: -squareOffset },
        { x: -squareOffset, y: squareOffset },
        { x: squareOffset, y: squareOffset },
      ];
      for (let i = 0; i < 4; i++) {
        positions.set(sortedRoots[i], {
          x: centerX + quadrantOffsets[i].x - circleRadius,
          y: centerY + quadrantOffsets[i].y - circleRadius,
          width: circleRadius * 2,
          height: circleRadius * 2,
          rotation: 0,
        });
      }
    } else if (count === 5) {
      // Pentagon arrangement with smaller circles
      const smallRadius = circleRadius * 0.8;
      const pentagonRadius = circleRadius * 0.8;
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * 2 * Math.PI - Math.PI / 2;
        positions.set(sortedRoots[i], {
          x: centerX + pentagonRadius * Math.cos(angle) - smallRadius,
          y: centerY + pentagonRadius * Math.sin(angle) - smallRadius,
          width: smallRadius * 2,
          height: smallRadius * 2,
          rotation: 0,
        });
      }
    }

    return { positions, connectors: [], bounds };
  }
}

/**
 * Basic Radial - Center node with satellite nodes
 */
export class BasicRadialLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes
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

    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    const router = connectorRouter ?? new DirectConnectorRouter();

    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const centerSize = 80;
    const satelliteSize = 60;
    const radius = Math.min(bounds.width, bounds.height) / 2 - satelliteSize;

    // Center node
    const centerId = rootNodeIds[0];
    if (!centerId) {
      return { positions, connectors, bounds };
    }

    positions.set(centerId, {
      x: centerX - centerSize / 2,
      y: centerY - centerSize / 2,
      width: centerSize,
      height: centerSize,
      rotation: 0,
    });

    // Satellite nodes (children of center)
    const node = nodes.get(centerId);
    if (node) {
      const children = this.getSortedChildren(node.childIds as NodeId[], nodes);
      children.forEach((childId, index) => {
        const angle = (index / children.length) * 2 * Math.PI - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle) - satelliteSize / 2;
        const y = centerY + radius * Math.sin(angle) - satelliteSize / 2;

        positions.set(childId, {
          x,
          y,
          width: satelliteSize,
          height: satelliteSize,
          rotation: 0,
        });

        const path = router.route(
          { nodeId: centerId, side: 'center' },
          { nodeId: childId, side: 'center' },
          positions,
          connectors.map((c) => c.path),
          { routingStyle: 'direct' },
        );

        connectors.push({
          fromId: centerId,
          toId: childId,
          path,
        });
      });
    }

    return { positions, connectors, bounds };
  }
}

/**
 * Target Layout - Nested concentric circles
 */
export class TargetLayout extends BaseLayoutAlgorithm {
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
    const centerY = bounds.height / 2;
    const maxRadius = Math.min(bounds.width, bounds.height) / 2 - 10;

    // Concentric circles, innermost first
    sortedRoots.forEach((id, index) => {
      const radius = maxRadius * ((count - index) / count);
      positions.set(id, {
        x: centerX - radius,
        y: centerY - radius,
        width: radius * 2,
        height: radius * 2,
        rotation: 0,
      });
    });

    return { positions, connectors: [], bounds };
  }
}

/**
 * Funnel Layout - Funnel/inverted pyramid shape
 */
export class FunnelLayout extends BaseLayoutAlgorithm {
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
    const minWidth = bounds.width * 0.3; // Bottom of funnel
    const maxWidth = bounds.width; // Top of funnel

    sortedRoots.forEach((id, index) => {
      // Width decreases as we go down (index 0 = top, widest)
      const widthRatio = (count - index) / count;
      const segmentWidth = minWidth + (maxWidth - minWidth) * widthRatio;
      const x = (bounds.width - segmentWidth) / 2;
      const y = index * segmentHeight;

      positions.set(id, {
        x,
        y,
        width: segmentWidth,
        height: segmentHeight - 5,
        rotation: 0,
      });
    });

    return { positions, connectors: [], bounds };
  }
}

/**
 * Balance Layout - Balance scale with center and two sides
 */
export class BalanceLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes
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

    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    const router = connectorRouter ?? new DirectConnectorRouter();

    const centerX = bounds.width / 2;
    const centerNodeWidth = 100;
    const centerNodeHeight = 60;
    const sideNodeWidth = 80;
    const sideNodeHeight = 50;
    const armOffset = bounds.width / 4;

    // Center node (pivot point)
    const centerId = rootNodeIds[0];
    if (!centerId) {
      return { positions, connectors, bounds };
    }

    positions.set(centerId, {
      x: centerX - centerNodeWidth / 2,
      y: bounds.height / 4,
      width: centerNodeWidth,
      height: centerNodeHeight,
      rotation: 0,
    });

    const node = nodes.get(centerId);
    if (node) {
      const children = this.getSortedChildren(node.childIds as NodeId[], nodes);
      const leftChildren: NodeId[] = [];
      const rightChildren: NodeId[] = [];

      // Split children into left and right
      children.forEach((childId, index) => {
        if (index % 2 === 0) {
          leftChildren.push(childId);
        } else {
          rightChildren.push(childId);
        }
      });

      // Position left children
      leftChildren.forEach((childId, index) => {
        const y = bounds.height / 2 + index * (sideNodeHeight + 10);
        positions.set(childId, {
          x: centerX - armOffset - sideNodeWidth / 2,
          y,
          width: sideNodeWidth,
          height: sideNodeHeight,
          rotation: 0,
        });

        const path = router.route(
          { nodeId: centerId, side: 'left' },
          { nodeId: childId, side: 'top' },
          positions,
          connectors.map((c) => c.path),
          { routingStyle: 'direct' },
        );

        connectors.push({
          fromId: centerId,
          toId: childId,
          path,
        });
      });

      // Position right children
      rightChildren.forEach((childId, index) => {
        const y = bounds.height / 2 + index * (sideNodeHeight + 10);
        positions.set(childId, {
          x: centerX + armOffset - sideNodeWidth / 2,
          y,
          width: sideNodeWidth,
          height: sideNodeHeight,
          rotation: 0,
        });

        const path = router.route(
          { nodeId: centerId, side: 'right' },
          { nodeId: childId, side: 'top' },
          positions,
          connectors.map((c) => c.path),
          { routingStyle: 'direct' },
        );

        connectors.push({
          fromId: centerId,
          toId: childId,
          path,
        });
      });
    }

    return { positions, connectors, bounds };
  }
}

// =============================================================================
// Implementation Registry
// =============================================================================

export const relationshipImplementations = new Map<string, ILayoutAlgorithm>([
  ['relationship/basic-venn', new BasicVennLayout()],
  ['relationship/basic-radial', new BasicRadialLayout()],
  ['relationship/target', new TargetLayout()],
  ['relationship/funnel', new FunnelLayout()],
  ['relationship/balance', new BalanceLayout()],
]);

// =============================================================================
// Layout Registration
// =============================================================================

export function registerRelationshipLayouts(registry: ILayoutRegistry): void {
  registry.register({
    id: 'relationship/basic-venn',
    name: 'Basic Venn',
    description: 'Use to show overlapping or interconnected relationships',
    category: 'relationship',
    minNodes: 2,
    maxNodes: 5,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'ellipse',
    defaultConnectorType: 'none',
    algorithm: 'venn',
    thumbnail: '',
  });

  registry.register({
    id: 'relationship/basic-radial',
    name: 'Basic Radial',
    description: 'Use to show relationships to a central idea',
    category: 'relationship',
    minNodes: 2,
    maxNodes: null,
    maxLevels: 2,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'ellipse',
    defaultConnectorType: 'straight',
    algorithm: 'radial',
    thumbnail: '',
  });

  registry.register({
    id: 'relationship/target',
    name: 'Target',
    description: 'Use to show containment or layered relationships',
    category: 'relationship',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'ellipse',
    defaultConnectorType: 'none',
    algorithm: 'target',
    thumbnail: '',
  });

  registry.register({
    id: 'relationship/funnel',
    name: 'Funnel',
    description: 'Use to show filtering or narrowing relationships',
    category: 'relationship',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'trapezoid',
    defaultConnectorType: 'none',
    algorithm: 'funnel',
    thumbnail: '',
  });

  registry.register({
    id: 'relationship/balance',
    name: 'Balance',
    description: 'Use to show balance or comparison between ideas',
    category: 'relationship',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 2,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'straight',
    algorithm: 'balance',
    thumbnail: '',
  });
}
