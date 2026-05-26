/**
 * Process Layouts
 *
 * Layouts for showing progression or sequential steps in a workflow.
 * Process layouts typically use connectors to show flow direction.
 *
 * Includes:
 * - BasicProcessLayout: Horizontal chevron flow
 * - StepDownProcessLayout: Descending steps
 * - BasicTimelineLayout: Linear timeline
 * - CircleAccentTimelineLayout: Timeline with circle markers
 * - BasicBendingProcessLayout: Process with bends
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
 * Basic Process - Horizontal flow with arrows
 */
export class BasicProcessLayout extends BaseLayoutAlgorithm {
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
    const nodeWidth = 100;
    const nodeHeight = 60;
    const spacing = 30;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    // Use provided router or default to direct
    const router = connectorRouter ?? new DirectConnectorRouter();

    const totalWidth = count * nodeWidth + (count - 1) * spacing;
    const startX = (bounds.width - totalWidth) / 2;
    const centerY = (bounds.height - nodeHeight) / 2;

    sortedRoots.forEach((id, index) => {
      positions.set(id, {
        x: startX + index * (nodeWidth + spacing),
        y: centerY,
        width: nodeWidth,
        height: nodeHeight,
        rotation: 0,
      });

      // Add connector to next node
      if (index < sortedRoots.length - 1) {
        const nextId = sortedRoots[index + 1];
        const path = router.route(
          { nodeId: id, side: 'right' },
          { nodeId: nextId, side: 'left' },
          positions,
          connectors.map((c) => c.path),
          { routingStyle: 'direct' },
        );

        connectors.push({
          fromId: id,
          toId: nextId,
          path,
        });
      }
    });

    return {
      positions,
      connectors,
      bounds: {
        width: bounds.width,
        height: bounds.height,
      },
    };
  }
}

/**
 * Step Down Process - Descending diagonal steps
 */
export class StepDownProcessLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (dominated by sorting)
   * @sideEffects None - pure function
   */
  compute(
    nodes: Map<NodeId, NodeHierarchyInfo>,
    rootNodeIds: NodeId[],
    _bounds: { width: number; height: number },
    _options: Record<string, unknown>,
    connectorRouter?: IConnectorRouter,
  ): LayoutResult {
    this._boundsCache.clear();

    const sortedRoots = this.getSortedChildren(rootNodeIds, nodes);
    const count = sortedRoots.length;
    const nodeWidth = 120;
    const nodeHeight = 50;
    const hSpacing = 40;
    const vSpacing = 30;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    const router = connectorRouter ?? new DirectConnectorRouter();

    sortedRoots.forEach((id, index) => {
      positions.set(id, {
        x: index * (nodeWidth / 2 + hSpacing),
        y: index * (nodeHeight + vSpacing),
        width: nodeWidth,
        height: nodeHeight,
        rotation: 0,
      });

      if (index < sortedRoots.length - 1) {
        const nextId = sortedRoots[index + 1];
        const path = router.route(
          { nodeId: id, side: 'bottom' },
          { nodeId: nextId, side: 'top' },
          positions,
          connectors.map((c) => c.path),
          { routingStyle: 'direct' },
        );

        connectors.push({
          fromId: id,
          toId: nextId,
          path,
        });
      }
    });

    const totalWidth = count > 0 ? (count - 1) * (nodeWidth / 2 + hSpacing) + nodeWidth : 0;
    const totalHeight = count > 0 ? (count - 1) * (nodeHeight + vSpacing) + nodeHeight : 0;

    return {
      positions,
      connectors,
      bounds: {
        width: totalWidth,
        height: totalHeight,
      },
    };
  }
}

/**
 * Basic Timeline - Linear horizontal timeline
 */
export class BasicTimelineLayout extends BaseLayoutAlgorithm {
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
    const nodeWidth = 100;
    const nodeHeight = 80;
    const spacing = 20;
    const timelineY = bounds.height / 2;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    const router = connectorRouter ?? new DirectConnectorRouter();

    const totalWidth = count * nodeWidth + (count - 1) * spacing;
    const startX = (bounds.width - totalWidth) / 2;

    sortedRoots.forEach((id, index) => {
      // Alternate above/below timeline
      const isAbove = index % 2 === 0;
      const y = isAbove ? timelineY - nodeHeight - 20 : timelineY + 20;

      positions.set(id, {
        x: startX + index * (nodeWidth + spacing),
        y,
        width: nodeWidth,
        height: nodeHeight,
        rotation: 0,
      });

      // Connect to next
      if (index < sortedRoots.length - 1) {
        const nextId = sortedRoots[index + 1];
        const path = router.route(
          { nodeId: id, side: 'right' },
          { nodeId: nextId, side: 'left' },
          positions,
          connectors.map((c) => c.path),
          { routingStyle: 'direct' },
        );

        connectors.push({
          fromId: id,
          toId: nextId,
          path,
        });
      }
    });

    return {
      positions,
      connectors,
      bounds,
    };
  }
}

/**
 * Circle Accent Timeline - Timeline with circle accent points
 */
export class CircleAccentTimelineLayout extends BaseLayoutAlgorithm {
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
    const nodeWidth = 120;
    const nodeHeight = 60;
    const spacing = 30;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    const router = connectorRouter ?? new DirectConnectorRouter();

    const totalWidth = count * nodeWidth + (count - 1) * spacing;
    const startX = (bounds.width - totalWidth) / 2;
    const centerY = (bounds.height - nodeHeight) / 2;

    sortedRoots.forEach((id, index) => {
      positions.set(id, {
        x: startX + index * (nodeWidth + spacing),
        y: centerY,
        width: nodeWidth,
        height: nodeHeight,
        rotation: 0,
      });

      if (index < sortedRoots.length - 1) {
        const nextId = sortedRoots[index + 1];
        const path = router.route(
          { nodeId: id, side: 'right' },
          { nodeId: nextId, side: 'left' },
          positions,
          connectors.map((c) => c.path),
          { routingStyle: 'direct' },
        );

        connectors.push({
          fromId: id,
          toId: nextId,
          path,
        });
      }
    });

    return {
      positions,
      connectors,
      bounds,
    };
  }
}

/**
 * Basic Bending Process - Process that bends/wraps
 */
export class BasicBendingProcessLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n log n) for n nodes (dominated by sorting)
   * @sideEffects None - pure function
   */
  compute(
    nodes: Map<NodeId, NodeHierarchyInfo>,
    rootNodeIds: NodeId[],
    _bounds: { width: number; height: number },
    _options: Record<string, unknown>,
    connectorRouter?: IConnectorRouter,
  ): LayoutResult {
    this._boundsCache.clear();

    const sortedRoots = this.getSortedChildren(rootNodeIds, nodes);
    const nodeWidth = 100;
    const nodeHeight = 50;
    const hSpacing = 20;
    const vSpacing = 40;
    const itemsPerRow = 3;
    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    const router = connectorRouter ?? new DirectConnectorRouter();

    sortedRoots.forEach((id, index) => {
      const row = Math.floor(index / itemsPerRow);
      const col = index % itemsPerRow;
      // Alternate direction per row (snake pattern)
      const actualCol = row % 2 === 0 ? col : itemsPerRow - 1 - col;

      positions.set(id, {
        x: actualCol * (nodeWidth + hSpacing),
        y: row * (nodeHeight + vSpacing),
        width: nodeWidth,
        height: nodeHeight,
        rotation: 0,
      });

      if (index < sortedRoots.length - 1) {
        const nextId = sortedRoots[index + 1];
        const nextRow = Math.floor((index + 1) / itemsPerRow);

        // Different connector based on whether we're changing rows
        if (nextRow === row) {
          // Same row - horizontal connector
          const side = row % 2 === 0 ? 'right' : 'left';
          const nextSide = row % 2 === 0 ? 'left' : 'right';
          const path = router.route(
            { nodeId: id, side: side as 'left' | 'right' },
            { nodeId: nextId, side: nextSide as 'left' | 'right' },
            positions,
            connectors.map((c) => c.path),
            { routingStyle: 'direct' },
          );
          connectors.push({ fromId: id, toId: nextId, path });
        } else {
          // Moving to next row - vertical connector
          const path = router.route(
            { nodeId: id, side: 'bottom' },
            { nodeId: nextId, side: 'top' },
            positions,
            connectors.map((c) => c.path),
            { routingStyle: 'direct' },
          );
          connectors.push({ fromId: id, toId: nextId, path });
        }
      }
    });

    const totalRows = Math.ceil(sortedRoots.length / itemsPerRow);
    const totalWidth = itemsPerRow * nodeWidth + (itemsPerRow - 1) * hSpacing;
    const totalHeight = totalRows * nodeHeight + (totalRows - 1) * vSpacing;

    return {
      positions,
      connectors,
      bounds: {
        width: totalWidth,
        height: totalHeight,
      },
    };
  }
}

// =============================================================================
// Implementation Registry
// =============================================================================

export const processImplementations = new Map<string, ILayoutAlgorithm>([
  ['process/basic-process', new BasicProcessLayout()],
  ['process/step-down-process', new StepDownProcessLayout()],
  ['process/basic-timeline', new BasicTimelineLayout()],
  ['process/circle-accent-timeline', new CircleAccentTimelineLayout()],
  ['process/basic-bending-process', new BasicBendingProcessLayout()],
]);

// =============================================================================
// Layout Registration
// =============================================================================

export function registerProcessLayouts(registry: ILayoutRegistry): void {
  registry.register({
    id: 'process/basic-process',
    name: 'Basic Process',
    description: 'Use to show progression or sequential steps in a task, process, or workflow',
    category: 'process',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'chevron',
    defaultConnectorType: 'none',
    algorithm: 'linear-horizontal',
    thumbnail: '',
  });

  registry.register({
    id: 'process/step-down-process',
    name: 'Step Down Process',
    description: 'Use to show a descending process with multiple steps',
    category: 'process',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'straight',
    algorithm: 'linear-vertical',
    thumbnail: '',
  });

  registry.register({
    id: 'process/basic-timeline',
    name: 'Basic Timeline',
    description: 'Use to show a sequence of events or timeline',
    category: 'process',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'straight',
    algorithm: 'linear-horizontal',
    thumbnail: '',
  });

  registry.register({
    id: 'process/circle-accent-timeline',
    name: 'Circle Accent Timeline',
    description: 'Use to show a sequence of events with circle accent markers',
    category: 'process',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'ellipse',
    defaultConnectorType: 'straight',
    algorithm: 'linear-horizontal',
    thumbnail: '',
  });

  registry.register({
    id: 'process/basic-bending-process',
    name: 'Basic Bending Process',
    description: 'Use to show progression that bends or wraps to multiple rows',
    category: 'process',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'straight',
    algorithm: 'snake',
    thumbnail: '',
  });
}
