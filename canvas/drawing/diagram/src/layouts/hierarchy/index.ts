/**
 * Hierarchy Layouts
 *
 * Layouts for showing hierarchical information like organization charts
 * and tree structures.
 *
 * Includes:
 * - OrganizationChartLayout: Standard org chart
 * - NameAndTitleOrgChartLayout: Org chart with name/title fields
 * - HorizontalOrgChartLayout: Left-to-right hierarchy
 * - HierarchyListLayout: Tree with indentation
 * - TableHierarchyLayout: Table-style hierarchy
 */

import type {
  ILayoutAlgorithm,
  ILayoutRegistry,
  LayoutResult,
  NodeId,
} from '@mog-sdk/contracts/diagram';
import { BaseLayoutAlgorithm, type NodeHierarchyInfo } from '../base-layout';
import { OrthogonalConnectorRouter, type IConnectorRouter } from '../connector-router';

// =============================================================================
// Layout Implementations
// =============================================================================

/**
 * Organization Chart - Standard vertical tree hierarchy
 */
export class OrganizationChartLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n) for n nodes in tree (with memoization)
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

    const router = connectorRouter ?? new OrthogonalConnectorRouter();

    const nodeWidth = 120;
    const nodeHeight = 50;
    const hSpacing = 20;
    const vSpacing = 40;

    const rootId = rootNodeIds[0];
    if (!rootId) {
      return { positions, connectors, bounds };
    }

    // Recursive layout function
    const layoutNode = (
      nodeId: NodeId,
      x: number,
      y: number,
      _availableWidth: number,
    ): { width: number } => {
      const node = nodes.get(nodeId);
      if (!node) return { width: 0 };

      const children = this.getSortedChildren(node.childIds as NodeId[], nodes);

      if (children.length === 0) {
        positions.set(nodeId, {
          x: x,
          y,
          width: nodeWidth,
          height: nodeHeight,
          rotation: 0,
        });
        return { width: nodeWidth };
      }

      // Calculate child widths first
      const childWidths: number[] = [];
      let totalChildWidth = 0;

      children.forEach((childId) => {
        const childBounds = this.computeTreeBounds(
          childId,
          nodes,
          nodeWidth,
          nodeHeight,
          hSpacing,
          vSpacing,
        );
        childWidths.push(childBounds.width);
        totalChildWidth += childBounds.width;
      });

      totalChildWidth += (children.length - 1) * hSpacing;

      // Position this node centered above children
      const myWidth = Math.max(nodeWidth, totalChildWidth);
      const nodeX = x + (myWidth - nodeWidth) / 2;

      positions.set(nodeId, {
        x: nodeX,
        y,
        width: nodeWidth,
        height: nodeHeight,
        rotation: 0,
      });

      // Position children
      let childX = x + (myWidth - totalChildWidth) / 2;
      children.forEach((childId, index) => {
        layoutNode(childId, childX, y + nodeHeight + vSpacing, childWidths[index]);

        // Add connector using router
        const path = router.route(
          { nodeId, side: 'bottom' },
          { nodeId: childId, side: 'top' },
          positions,
          connectors.map((c) => c.path),
          { routingStyle: 'orthogonal' },
        );

        connectors.push({
          fromId: nodeId,
          toId: childId,
          path,
        });

        childX += childWidths[index] + hSpacing;
      });

      return { width: myWidth };
    };

    const treeBounds = this.computeTreeBounds(
      rootId,
      nodes,
      nodeWidth,
      nodeHeight,
      hSpacing,
      vSpacing,
    );

    layoutNode(rootId, (bounds.width - treeBounds.width) / 2, 20, treeBounds.width);

    return {
      positions,
      connectors,
      bounds: {
        width: Math.max(treeBounds.width, bounds.width),
        height: treeBounds.height + 40,
      },
    };
  }
}

/**
 * Name and Title Org Chart - Org chart with larger nodes for name/title
 */
export class NameAndTitleOrgChartLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n) for n nodes in tree
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

    const router = connectorRouter ?? new OrthogonalConnectorRouter();

    const nodeWidth = 150;
    const nodeHeight = 70;
    const hSpacing = 25;
    const vSpacing = 50;

    const rootId = rootNodeIds[0];
    if (!rootId) {
      return { positions, connectors, bounds };
    }

    const layoutNode = (nodeId: NodeId, x: number, y: number): { width: number } => {
      const node = nodes.get(nodeId);
      if (!node) return { width: 0 };

      const children = this.getSortedChildren(node.childIds as NodeId[], nodes);

      if (children.length === 0) {
        positions.set(nodeId, {
          x,
          y,
          width: nodeWidth,
          height: nodeHeight,
          rotation: 0,
        });
        return { width: nodeWidth };
      }

      const childWidths: number[] = [];
      let totalChildWidth = 0;

      children.forEach((childId) => {
        const childBounds = this.computeTreeBounds(
          childId,
          nodes,
          nodeWidth,
          nodeHeight,
          hSpacing,
          vSpacing,
        );
        childWidths.push(childBounds.width);
        totalChildWidth += childBounds.width;
      });

      totalChildWidth += (children.length - 1) * hSpacing;

      const myWidth = Math.max(nodeWidth, totalChildWidth);
      const nodeX = x + (myWidth - nodeWidth) / 2;

      positions.set(nodeId, {
        x: nodeX,
        y,
        width: nodeWidth,
        height: nodeHeight,
        rotation: 0,
      });

      let childX = x + (myWidth - totalChildWidth) / 2;
      children.forEach((childId, index) => {
        layoutNode(childId, childX, y + nodeHeight + vSpacing);

        const path = router.route(
          { nodeId, side: 'bottom' },
          { nodeId: childId, side: 'top' },
          positions,
          connectors.map((c) => c.path),
          { routingStyle: 'orthogonal' },
        );

        connectors.push({
          fromId: nodeId,
          toId: childId,
          path,
        });

        childX += childWidths[index] + hSpacing;
      });

      return { width: myWidth };
    };

    const treeBounds = this.computeTreeBounds(
      rootId,
      nodes,
      nodeWidth,
      nodeHeight,
      hSpacing,
      vSpacing,
    );

    layoutNode(rootId, (bounds.width - treeBounds.width) / 2, 20);

    return {
      positions,
      connectors,
      bounds: {
        width: Math.max(treeBounds.width, bounds.width),
        height: treeBounds.height + 40,
      },
    };
  }
}

/**
 * Horizontal Org Chart - Left to right hierarchy
 */
export class HorizontalOrgChartLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n) for n nodes in tree
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

    const router = connectorRouter ?? new OrthogonalConnectorRouter();

    const nodeWidth = 100;
    const nodeHeight = 40;
    const hSpacing = 50;
    const vSpacing = 15;

    const rootId = rootNodeIds[0];
    if (!rootId) {
      return { positions, connectors, bounds };
    }

    // For horizontal layout, compute vertical bounds instead
    const computeVerticalBounds = (nodeId: NodeId): number => {
      const node = nodes.get(nodeId);
      if (!node || node.childIds.length === 0) return nodeHeight;

      let totalHeight = 0;
      node.childIds.forEach((childId, idx) => {
        totalHeight += computeVerticalBounds(childId as NodeId);
        if (idx < node.childIds.length - 1) totalHeight += vSpacing;
      });

      return Math.max(nodeHeight, totalHeight);
    };

    const layoutNode = (nodeId: NodeId, x: number, y: number, availableHeight: number): void => {
      const node = nodes.get(nodeId);
      if (!node) return;

      const children = this.getSortedChildren(node.childIds as NodeId[], nodes);

      if (children.length === 0) {
        positions.set(nodeId, {
          x,
          y: y + (availableHeight - nodeHeight) / 2,
          width: nodeWidth,
          height: nodeHeight,
          rotation: 0,
        });
        return;
      }

      // Calculate child heights
      const childHeights: number[] = [];
      let totalChildHeight = 0;

      children.forEach((childId) => {
        const childHeight = computeVerticalBounds(childId);
        childHeights.push(childHeight);
        totalChildHeight += childHeight;
      });

      totalChildHeight += (children.length - 1) * vSpacing;

      // Position this node centered beside children
      positions.set(nodeId, {
        x,
        y: y + (totalChildHeight - nodeHeight) / 2,
        width: nodeWidth,
        height: nodeHeight,
        rotation: 0,
      });

      // Position children
      let childY = y;
      children.forEach((childId, index) => {
        layoutNode(childId, x + nodeWidth + hSpacing, childY, childHeights[index]);

        const path = router.route(
          { nodeId, side: 'right' },
          { nodeId: childId, side: 'left' },
          positions,
          connectors.map((c) => c.path),
          { routingStyle: 'orthogonal' },
        );

        connectors.push({
          fromId: nodeId,
          toId: childId,
          path,
        });

        childY += childHeights[index] + vSpacing;
      });
    };

    const totalHeight = computeVerticalBounds(rootId);
    layoutNode(rootId, 20, (bounds.height - totalHeight) / 2, totalHeight);

    return {
      positions,
      connectors,
      bounds,
    };
  }
}

/**
 * Hierarchy List - Indented list style hierarchy
 */
export class HierarchyListLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n) for n nodes
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

    const positions = new Map<
      NodeId,
      { x: number; y: number; width: number; height: number; rotation: number }
    >();
    const connectors: LayoutResult['connectors'] = [];

    const nodeHeight = 35;
    const vSpacing = 8;
    const indentWidth = 25;

    let currentY = 0;

    const layoutNode = (nodeId: NodeId, level: number): void => {
      const node = nodes.get(nodeId);
      if (!node) return;

      const indent = level * indentWidth;
      const nodeWidth = bounds.width - indent;

      positions.set(nodeId, {
        x: indent,
        y: currentY,
        width: nodeWidth,
        height: nodeHeight,
        rotation: 0,
      });

      currentY += nodeHeight + vSpacing;

      // Layout children
      const children = this.getSortedChildren(node.childIds as NodeId[], nodes);
      children.forEach((childId) => {
        layoutNode(childId, level + 1);
      });
    };

    // Layout all root nodes and their descendants
    rootNodeIds.forEach((rootId) => {
      layoutNode(rootId, 0);
    });

    return {
      positions,
      connectors,
      bounds: {
        width: bounds.width,
        height: currentY - vSpacing,
      },
    };
  }
}

/**
 * Table Hierarchy - Table/grid style hierarchy
 */
export class TableHierarchyLayout extends BaseLayoutAlgorithm {
  /**
   * @complexity O(n) for n nodes
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

    const router = connectorRouter ?? new OrthogonalConnectorRouter();

    const nodeHeight = 40;
    const vSpacing = 5;
    const levelWidth = 150;

    let currentY = 0;

    const layoutNode = (nodeId: NodeId, level: number): void => {
      const node = nodes.get(nodeId);
      if (!node) return;

      positions.set(nodeId, {
        x: level * levelWidth,
        y: currentY,
        width: levelWidth - 10,
        height: nodeHeight,
        rotation: 0,
      });

      currentY += nodeHeight + vSpacing;

      // Layout children
      const children = this.getSortedChildren(node.childIds as NodeId[], nodes);
      children.forEach((childId) => {
        layoutNode(childId, level + 1);

        // Add connector from parent row to child row
        const path = router.route(
          { nodeId, side: 'right' },
          { nodeId: childId, side: 'left' },
          positions,
          connectors.map((c) => c.path),
          { routingStyle: 'orthogonal' },
        );

        connectors.push({
          fromId: nodeId,
          toId: childId,
          path,
        });
      });
    };

    rootNodeIds.forEach((rootId) => {
      layoutNode(rootId, 0);
    });

    return {
      positions,
      connectors,
      bounds: {
        width: bounds.width,
        height: currentY - vSpacing,
      },
    };
  }
}

// =============================================================================
// Implementation Registry
// =============================================================================

export const hierarchyImplementations = new Map<string, ILayoutAlgorithm>([
  ['hierarchy/organization-chart', new OrganizationChartLayout()],
  ['hierarchy/name-and-title-org-chart', new NameAndTitleOrgChartLayout()],
  ['hierarchy/horizontal-org-chart', new HorizontalOrgChartLayout()],
  ['hierarchy/hierarchy-list', new HierarchyListLayout()],
  ['hierarchy/table-hierarchy', new TableHierarchyLayout()],
]);

// =============================================================================
// Layout Registration
// =============================================================================

export function registerHierarchyLayouts(registry: ILayoutRegistry): void {
  registry.register({
    id: 'hierarchy/organization-chart',
    name: 'Organization Chart',
    description:
      'Use to show hierarchical information or reporting relationships in an organization',
    category: 'hierarchy',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 10,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'elbow',
    algorithm: 'tree-vertical',
    thumbnail: '',
  });

  registry.register({
    id: 'hierarchy/name-and-title-org-chart',
    name: 'Name and Title Organization Chart',
    description: 'Use to show hierarchical information with larger nodes for name and title',
    category: 'hierarchy',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 10,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'elbow',
    algorithm: 'tree-vertical',
    thumbnail: '',
  });

  registry.register({
    id: 'hierarchy/horizontal-org-chart',
    name: 'Horizontal Organization Chart',
    description: 'Use to show hierarchical information with a horizontal layout',
    category: 'hierarchy',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 10,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'elbow',
    algorithm: 'tree-horizontal',
    thumbnail: '',
  });

  registry.register({
    id: 'hierarchy/hierarchy-list',
    name: 'Hierarchy List',
    description: 'Use to show hierarchical information as an indented list',
    category: 'hierarchy',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 10,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'tree-vertical',
    thumbnail: '',
  });

  registry.register({
    id: 'hierarchy/table-hierarchy',
    name: 'Table Hierarchy',
    description: 'Use to show hierarchical information in a table-like format',
    category: 'hierarchy',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 10,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'straight',
    algorithm: 'tree-horizontal',
    thumbnail: '',
  });
}
