/**
 * Diagram Layout Preview Generator
 *
 * Generates SVG preview thumbnails for Diagram layouts using the actual
 * layout algorithms and rendering system.
 *
 * This ensures previews accurately represent how the layout will look,
 * rather than showing generic category icons.
 */

import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type {
  ComputedLayout,
  NodeId,
  DiagramLayoutDefinition,
  DiagramShapeType,
} from '@mog-sdk/contracts/diagram';

import { renderDrawingObjectToSVG } from '@mog/drawing-engine';
import { BoundedCache } from '@mog/geometry';

import { computeLayout, getLayoutImplementation } from '../layouts';
import { layoutToDrawingObjects } from '../output';
import { generateNodeColors, getColorTheme } from '../styles';

// =============================================================================
// Types
// =============================================================================

export interface PreviewOptions {
  /** Width of the preview SVG in pixels */
  width?: number;
  /** Height of the preview SVG in pixels */
  height?: number;
  /** Number of sample nodes to show (default: 3-4 depending on layout) */
  nodeCount?: number;
  /** Quick style ID to use (default: 'subtle-effect') */
  quickStyleId?: string;
  /** Color theme ID to use (default: 'colorful-1') */
  colorThemeId?: string;
}

// =============================================================================
// Sample Data Generation
// =============================================================================

/**
 * Create sample node data for preview rendering.
 *
 * Generates a simple tree structure appropriate for the layout type.
 */
function createSampleNodes(
  layout: DiagramLayoutDefinition,
  count: number,
): {
  nodes: Map<
    NodeId,
    { level: number; parentId: NodeId | null; childIds: NodeId[]; siblingOrder: number }
  >;
  rootNodeIds: NodeId[];
  nodeTexts: Map<NodeId, string>;
} {
  const nodes = new Map<
    NodeId,
    { level: number; parentId: NodeId | null; childIds: NodeId[]; siblingOrder: number }
  >();
  const rootNodeIds: NodeId[] = [];
  const nodeTexts = new Map<NodeId, string>();

  // Determine structure based on layout category and maxLevels
  const isHierarchical = layout.maxLevels > 1 && layout.supportsChildren;

  if (isHierarchical && count >= 3) {
    // Create hierarchical structure: 1 root with children
    const rootId = `preview-node-0` as NodeId;
    const childIds: NodeId[] = [];

    for (let i = 1; i < count; i++) {
      const childId = `preview-node-${i}` as NodeId;
      childIds.push(childId);
      nodes.set(childId, {
        level: 1,
        parentId: rootId,
        childIds: [],
        siblingOrder: i - 1,
      });
      nodeTexts.set(childId, '');
    }

    nodes.set(rootId, {
      level: 0,
      parentId: null,
      childIds,
      siblingOrder: 0,
    });
    rootNodeIds.push(rootId);
    nodeTexts.set(rootId, '');
  } else {
    // Create flat structure: all nodes at same level
    for (let i = 0; i < count; i++) {
      const nodeId = `preview-node-${i}` as NodeId;
      nodes.set(nodeId, {
        level: 0,
        parentId: null,
        childIds: [],
        siblingOrder: i,
      });
      rootNodeIds.push(nodeId);
      nodeTexts.set(nodeId, '');
    }
  }

  return { nodes, rootNodeIds, nodeTexts };
}

/**
 * Convert layout algorithm result to ComputedLayout for preview rendering.
 */
function toComputedLayout(
  layoutResult: ReturnType<typeof computeLayout>,
  nodeTexts: Map<NodeId, string>,
  layout: DiagramLayoutDefinition,
  nodeColors: Map<string, string>,
): ComputedLayout | null {
  if (!layoutResult) return null;

  const { positions, connectors, bounds } = layoutResult;

  // Default stroke color
  const strokeColor = '#666666';

  // Convert positions to ComputedShape array
  const shapes: ComputedLayout['shapes'] = [];
  for (const [nodeId, pos] of positions) {
    shapes.push({
      nodeId,
      shapeType: layout.defaultShapeType as DiagramShapeType,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
      rotation: pos.rotation,
      fill: nodeColors.get(nodeId) ?? '#4A90D9',
      stroke: strokeColor,
      strokeWidth: 1,
      text: nodeTexts.get(nodeId) ?? '',
      textStyle: {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: Math.max(8, Math.min(12, pos.height / 4)),
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#ffffff',
        align: 'center',
        verticalAlign: 'middle',
      },
      effects: {},
    });
  }

  // Convert connectors
  const computedConnectors = connectors.map((c) => ({
    fromNodeId: c.fromId,
    toNodeId: c.toId,
    connectorType: layout.defaultConnectorType,
    path: c.path,
    stroke: strokeColor,
    strokeWidth: 1,
    arrowEnd:
      layout.defaultConnectorType !== 'none'
        ? { type: 'triangle' as const, size: 'small' as const }
        : undefined,
  }));

  return {
    shapes,
    connectors: computedConnectors,
    bounds,
    version: 1,
  };
}

// =============================================================================
// Preview Generation
// =============================================================================

/**
 * Generate an SVG preview for a Diagram layout.
 *
 * Uses the actual layout algorithm and rendering system to create
 * an accurate preview of how the layout will look.
 *
 * @param layout Layout definition to preview
 * @param options Preview options
 * @returns SVG string, or null if preview generation fails
 */
export function generateLayoutPreviewSVG(
  layout: DiagramLayoutDefinition,
  options: PreviewOptions = {},
): string | null {
  const {
    width = 80,
    height = 80,
    nodeCount = getDefaultNodeCount(layout),
    quickStyleId: _quickStyleId = 'subtle-effect',
    colorThemeId = 'colorful-1',
  } = options;

  // Check if layout implementation exists
  const implementation = getLayoutImplementation(layout.id);
  if (!implementation) {
    return null;
  }

  // Create sample node data
  const { nodes, rootNodeIds, nodeTexts } = createSampleNodes(layout, nodeCount);

  // Compute layout
  const layoutResult = computeLayout(
    layout.id,
    nodes,
    rootNodeIds,
    { width: width * 2, height: height * 2 }, // Larger bounds for computation
    {},
  );

  if (!layoutResult) {
    return null;
  }

  // Generate colors for nodes - need to convert to the expected format
  const nodeInfoArray = Array.from(nodes.entries()).map(([id, info]) => ({
    id: id as string,
    level: info.level,
  }));

  const colorTheme = getColorTheme(colorThemeId);

  // Use colorTheme if valid, otherwise generate simple colors
  let nodeColors: Map<string, string>;
  if (colorTheme) {
    nodeColors = generateNodeColors(colorTheme, nodeInfoArray);
  } else {
    // Fallback colors
    const defaultColors = ['#4A90D9', '#50B83C', '#F5A623', '#9B59B6', '#E74C3C'];
    nodeColors = new Map<string, string>();
    nodeInfoArray.forEach((node, index) => {
      nodeColors.set(node.id, defaultColors[index % defaultColors.length]);
    });
  }

  // Convert to ComputedLayout
  const computedLayout = toComputedLayout(layoutResult, nodeTexts, layout, nodeColors);

  if (!computedLayout) {
    return null;
  }

  // Convert ComputedLayout to DrawingObjects via the unified output pipeline
  const drawingObjects = layoutToDrawingObjects(computedLayout);

  // Create a container DrawingObject with children for batch rendering
  const container: DrawingObject = {
    geometry: { segments: [], closed: false },
    children: drawingObjects,
  };

  // Render to SVG via drawing-engine
  const svg = renderDrawingObjectToSVG(container, { width, height });

  return svg;
}

/**
 * Get the default number of nodes for a layout preview.
 */
function getDefaultNodeCount(layout: DiagramLayoutDefinition): number {
  // Use maxNodes if specified, otherwise default based on category
  if (layout.maxNodes !== null && layout.maxNodes <= 5) {
    return Math.min(layout.maxNodes, 4);
  }

  // Category-specific defaults
  switch (layout.category) {
    case 'hierarchy':
      return 4; // 1 root + 3 children
    case 'cycle':
      return 4; // Good for circular layouts
    case 'matrix':
      return 4; // 2x2 grid
    case 'pyramid':
      return 3; // 3 layers
    case 'relationship':
      return 3; // Venn/radial works well with 3
    default:
      return 3; // List/process default
  }
}

// =============================================================================
// Preview Cache
// =============================================================================

const previewCache = new BoundedCache<string, string>(200);

/**
 * Get a cached preview SVG, generating it if not already cached.
 *
 * @param layout Layout definition
 * @param options Preview options
 * @returns SVG string, or null if generation fails
 */
export function getCachedPreviewSVG(
  layout: DiagramLayoutDefinition,
  options: PreviewOptions = {},
): string | null {
  const cacheKey = `${layout.id}-${options.width ?? 80}-${options.height ?? 80}-${options.nodeCount ?? 'default'}-${options.quickStyleId ?? 'subtle-effect'}-${options.colorThemeId ?? 'colorful-1'}`;

  if (previewCache.has(cacheKey)) {
    return previewCache.get(cacheKey)!;
  }

  const svg = generateLayoutPreviewSVG(layout, options);

  if (svg) {
    previewCache.set(cacheKey, svg);
  }

  return svg;
}

/**
 * Clear the preview cache.
 */
export function clearPreviewCache(): void {
  previewCache.clear();
}
