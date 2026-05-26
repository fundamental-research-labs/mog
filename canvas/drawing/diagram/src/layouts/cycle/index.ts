/**
 * Cycle Layouts
 *
 * Layouts for showing continuous or circular processes.
 * Cycle layouts arrange nodes in circular patterns with connectors
 * forming a closed loop.
 *
 * Includes:
 * - BasicCycleLayout: Simple circular arrangement
 * - TextCycleLayout: Circle with text-focused nodes
 * - BlockCycleLayout: Block-style circular
 * - ContinuousCycleLayout: Continuous flowing cycle
 * - NondirectionalCycleLayout: No arrows (bidirectional)
 */

import type {
  ILayoutAlgorithm,
  ILayoutRegistry,
  LayoutResult,
  NodeId,
} from '@mog-sdk/contracts/diagram';
import { BaseLayoutAlgorithm, type NodeHierarchyInfo } from '../base-layout';
import { BezierConnectorRouter, type IConnectorRouter } from '../connector-router';

// =============================================================================
// Layout Implementations
// =============================================================================

/**
 * Basic Cycle - Circular arrangement with curved connectors
 */
export class BasicCycleLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (dominated by sorting)
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
    const count = sortedRoots.length;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    if (count === 0) {
      return { positions, connectors, bounds };
    }

    const router = connectorRouter ?? new BezierConnectorRouter();

    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const nodeSize = 60;
    const radius = Math.min(bounds.width, bounds.height) / 2 - nodeSize;

    sortedRoots.forEach((id, index) => {
      // Position nodes in a circle, starting from top (-PI/2)
      const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle) - nodeSize / 2;
      const y = centerY + radius * Math.sin(angle) - nodeSize / 2;

      positions.set(id, {
        x,
        y,
        width: nodeSize,
        height: nodeSize,
        rotation: 0,
      });
    });

    // Add connectors forming a closed loop
    sortedRoots.forEach((id, index) => {
      const nextIndex = (index + 1) % count;
      const nextId = sortedRoots[nextIndex];

      const path = router.route(
        { nodeId: id, side: 'center' },
        { nodeId: nextId, side: 'center' },
        positions,
        connectors.map((c) => c.path),
        { routingStyle: 'organic' },
      );

      connectors.push({
        fromId: id,
        toId: nextId,
        path,
      });
    });

    return { positions, connectors, bounds };
  }
}

/**
 * Text Cycle - Cycle optimized for text display
 */
export class TextCycleLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (dominated by sorting)
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
    const count = sortedRoots.length;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    if (count === 0) {
      return { positions, connectors, bounds };
    }

    const router = connectorRouter ?? new BezierConnectorRouter();

    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const nodeWidth = 100;
    const nodeHeight = 50;
    const radius = Math.min(bounds.width, bounds.height) / 2 - Math.max(nodeWidth, nodeHeight);

    sortedRoots.forEach((id, index) => {
      const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle) - nodeWidth / 2;
      const y = centerY + radius * Math.sin(angle) - nodeHeight / 2;

      positions.set(id, {
        x,
        y,
        width: nodeWidth,
        height: nodeHeight,
        rotation: 0,
      });
    });

    sortedRoots.forEach((id, index) => {
      const nextIndex = (index + 1) % count;
      const nextId = sortedRoots[nextIndex];

      const path = router.route(
        { nodeId: id, side: 'center' },
        { nodeId: nextId, side: 'center' },
        positions,
        connectors.map((c) => c.path),
        { routingStyle: 'organic' },
      );

      connectors.push({
        fromId: id,
        toId: nextId,
        path,
      });
    });

    return { positions, connectors, bounds };
  }
}

/**
 * Block Cycle - Block-style nodes in a cycle
 */
export class BlockCycleLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (dominated by sorting)
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
    const count = sortedRoots.length;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    if (count === 0) {
      return { positions, connectors, bounds };
    }

    const router = connectorRouter ?? new BezierConnectorRouter();

    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const nodeSize = 70;
    const radius = Math.min(bounds.width, bounds.height) / 2 - nodeSize;

    sortedRoots.forEach((id, index) => {
      const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle) - nodeSize / 2;
      const y = centerY + radius * Math.sin(angle) - nodeSize / 2;

      positions.set(id, {
        x,
        y,
        width: nodeSize,
        height: nodeSize,
        rotation: 0,
      });
    });

    sortedRoots.forEach((id, index) => {
      const nextIndex = (index + 1) % count;
      const nextId = sortedRoots[nextIndex];

      const path = router.route(
        { nodeId: id, side: 'center' },
        { nodeId: nextId, side: 'center' },
        positions,
        connectors.map((c) => c.path),
        { routingStyle: 'organic' },
      );

      connectors.push({
        fromId: id,
        toId: nextId,
        path,
      });
    });

    return { positions, connectors, bounds };
  }
}

/**
 * Continuous Cycle - Flowing continuous cycle
 */
export class ContinuousCycleLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (dominated by sorting)
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
    const count = sortedRoots.length;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    if (count === 0) {
      return { positions, connectors, bounds };
    }

    const router = connectorRouter ?? new BezierConnectorRouter();

    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const nodeWidth = 80;
    const nodeHeight = 40;
    const radius = Math.min(bounds.width, bounds.height) / 2 - Math.max(nodeWidth, nodeHeight);

    sortedRoots.forEach((id, index) => {
      const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle) - nodeWidth / 2;
      const y = centerY + radius * Math.sin(angle) - nodeHeight / 2;

      // Rotate nodes to follow the circle tangent
      const rotationDeg = (angle * 180) / Math.PI + 90;

      positions.set(id, {
        x,
        y,
        width: nodeWidth,
        height: nodeHeight,
        rotation: rotationDeg,
      });
    });

    sortedRoots.forEach((id, index) => {
      const nextIndex = (index + 1) % count;
      const nextId = sortedRoots[nextIndex];

      const path = router.route(
        { nodeId: id, side: 'center' },
        { nodeId: nextId, side: 'center' },
        positions,
        connectors.map((c) => c.path),
        { routingStyle: 'organic' },
      );

      connectors.push({
        fromId: id,
        toId: nextId,
        path,
      });
    });

    return { positions, connectors, bounds };
  }
}

/**
 * Nondirectional Cycle - Cycle without directional arrows
 */
export class NondirectionalCycleLayout extends BaseLayoutAlgorithm {
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
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();

    if (count === 0) {
      return { positions, connectors: [], bounds };
    }

    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const nodeSize = 65;
    const radius = Math.min(bounds.width, bounds.height) / 2 - nodeSize;

    sortedRoots.forEach((id, index) => {
      const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle) - nodeSize / 2;
      const y = centerY + radius * Math.sin(angle) - nodeSize / 2;

      positions.set(id, {
        x,
        y,
        width: nodeSize,
        height: nodeSize,
        rotation: 0,
      });
    });

    // No connectors for nondirectional cycle - items are related but not directionally
    return { positions, connectors: [], bounds };
  }
}

// =============================================================================
// Implementation Registry
// =============================================================================

export const cycleImplementations = new Map<string, ILayoutAlgorithm>([
  ['cycle/basic-cycle', new BasicCycleLayout()],
  ['cycle/text-cycle', new TextCycleLayout()],
  ['cycle/block-cycle', new BlockCycleLayout()],
  ['cycle/continuous-cycle', new ContinuousCycleLayout()],
  ['cycle/nondirectional-cycle', new NondirectionalCycleLayout()],
]);

// =============================================================================
// Layout Registration
// =============================================================================

export function registerCycleLayouts(registry: ILayoutRegistry): void {
  registry.register({
    id: 'cycle/basic-cycle',
    name: 'Basic Cycle',
    description:
      'Use to represent a continuing sequence of stages, tasks, or events in a circular flow',
    category: 'cycle',
    minNodes: 3,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'ellipse',
    defaultConnectorType: 'curved',
    algorithm: 'circular',
    thumbnail: '',
  });

  registry.register({
    id: 'cycle/text-cycle',
    name: 'Text Cycle',
    description: 'Use to represent a continuing sequence with emphasis on text',
    category: 'cycle',
    minNodes: 3,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'curved',
    algorithm: 'circular',
    thumbnail: '',
  });

  registry.register({
    id: 'cycle/block-cycle',
    name: 'Block Cycle',
    description: 'Use to represent a continuing sequence with block-style nodes',
    category: 'cycle',
    minNodes: 3,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'curved',
    algorithm: 'circular',
    thumbnail: '',
  });

  registry.register({
    id: 'cycle/continuous-cycle',
    name: 'Continuous Cycle',
    description: 'Use to represent a continuous process or cycle',
    category: 'cycle',
    minNodes: 3,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'chevron',
    defaultConnectorType: 'curved',
    algorithm: 'circular',
    thumbnail: '',
  });

  registry.register({
    id: 'cycle/nondirectional-cycle',
    name: 'Nondirectional Cycle',
    description: 'Use to represent related items without directional flow',
    category: 'cycle',
    minNodes: 3,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'ellipse',
    defaultConnectorType: 'none',
    algorithm: 'circular',
    thumbnail: '',
  });
}
