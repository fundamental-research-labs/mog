/**
 * Shared Test Fixtures for Diagram Tests
 *
 * Factory functions to create valid Diagram objects with sensible defaults.
 * Used across gallery, styles, and output tests.
 */

import type {
  ComputedConnector,
  ComputedLayout,
  ComputedShape,
  NodeId,
  Diagram,
  DiagramNode,
} from '@mog-sdk/contracts/diagram';
import { createNodeId } from '../../src/models';

// =============================================================================
// Diagram Factories
// =============================================================================

/**
 * Create a simple test diagram with configurable node count.
 *
 * Produces a flat diagram (all nodes at root level) with layout 'process/basic-process'.
 *
 * @param nodeCount Number of root-level nodes to create (default: 3)
 * @returns A valid Diagram with the specified number of nodes
 */
export function createTestDiagram(nodeCount: number = 3): Diagram {
  const nodes = new Map<NodeId, DiagramNode>();
  const rootNodeIds: NodeId[] = [];

  for (let i = 0; i < nodeCount; i++) {
    const node = createTestNode({
      text: `Node ${i + 1}`,
      level: 0,
      parentId: null,
      siblingOrder: i,
    });
    nodes.set(node.id, node);
    rootNodeIds.push(node.id);
  }

  return {
    layoutId: 'process/basic-process',
    category: 'process',
    nodes,
    rootNodeIds,
    quickStyleId: 'subtle-effect',
    colorThemeId: 'colorful-1',
    layoutOptions: {},
  };
}

// =============================================================================
// Node Factories
// =============================================================================

/**
 * Create a single test node with overridable defaults.
 *
 * Default values:
 * - id: generated via createNodeId()
 * - text: 'Test'
 * - level: 0
 * - parentId: null
 * - childIds: []
 * - siblingOrder: 0
 *
 * @param overrides Partial node properties to override defaults
 * @returns A valid DiagramNode
 */
export function createTestNode(overrides?: Partial<DiagramNode>): DiagramNode {
  return {
    id: createNodeId(),
    text: 'Test',
    level: 0,
    parentId: null,
    childIds: [],
    siblingOrder: 0,
    ...overrides,
  };
}

// =============================================================================
// Computed Layout Factories
// =============================================================================

/**
 * Create a test ComputedLayout for rendering tests.
 *
 * Produces a layout with shapes arranged horizontally and connectors between them.
 *
 * @param shapeCount Number of shapes to create (default: 3)
 * @returns A valid ComputedLayout with shapes and connectors
 */
export function createTestComputedLayout(shapeCount: number = 3): ComputedLayout {
  const shapes: ComputedShape[] = [];
  const connectors: ComputedConnector[] = [];

  // Create shapes arranged horizontally
  const shapeWidth = 100;
  const shapeHeight = 60;
  const gap = 40;

  for (let i = 0; i < shapeCount; i++) {
    shapes.push(
      createTestComputedShape({
        nodeId: `test-node-${i}` as NodeId,
        x: i * (shapeWidth + gap),
        y: 0,
        width: shapeWidth,
        height: shapeHeight,
        text: `Shape ${i + 1}`,
      }),
    );
  }

  // Create connectors between adjacent shapes
  for (let i = 0; i < shapeCount - 1; i++) {
    const fromShape = shapes[i];
    const toShape = shapes[i + 1];
    connectors.push({
      fromNodeId: fromShape.nodeId,
      toNodeId: toShape.nodeId,
      connectorType: 'straight',
      path: {
        type: 'line',
        points: [
          { x: fromShape.x + fromShape.width, y: fromShape.y + fromShape.height / 2 },
          { x: toShape.x, y: toShape.y + toShape.height / 2 },
        ],
      },
      stroke: '#666666',
      strokeWidth: 1,
      arrowEnd: { type: 'triangle', size: 'small' },
    });
  }

  // Calculate bounds
  const totalWidth = shapeCount * shapeWidth + (shapeCount - 1) * gap;
  const totalHeight = shapeHeight;

  return {
    shapes,
    connectors,
    bounds: { width: totalWidth, height: totalHeight },
    version: 1,
  };
}

/**
 * Create a single test ComputedShape with overridable defaults.
 *
 * Default values:
 * - nodeId: 'test-node-0' (as NodeId)
 * - shapeType: 'rect'
 * - x: 0, y: 0, width: 100, height: 60
 * - rotation: 0
 * - fill: '#4A90D9'
 * - stroke: '#333333'
 * - strokeWidth: 1
 * - text: 'Test'
 * - textStyle: standard centered white text
 * - effects: empty
 *
 * @param overrides Partial shape properties to override defaults
 * @returns A valid ComputedShape
 */
export function createTestComputedShape(overrides?: Partial<ComputedShape>): ComputedShape {
  return {
    nodeId: 'test-node-0' as NodeId,
    shapeType: 'rect',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    rotation: 0,
    fill: '#4A90D9',
    stroke: '#333333',
    strokeWidth: 1,
    text: 'Test',
    textStyle: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 12,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#ffffff',
      align: 'center',
      verticalAlign: 'middle',
    },
    effects: {},
    ...overrides,
  };
}
