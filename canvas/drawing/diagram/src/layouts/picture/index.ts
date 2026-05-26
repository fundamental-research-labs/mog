/**
 * Picture Layouts
 *
 * Layouts optimized for displaying images with captions or labels.
 *
 * Includes:
 * - AlternatingPictureBlocksLayout: Alternating left/right picture blocks
 * - PictureCaptionListLayout: Pictures with captions below
 * - PictureGridLayout: Grid of pictures
 * - CirclePictureListLayout: Circular picture frames
 * - BentUpPictureLayout: Pictures with angled arrangement
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
 * Alternating Picture Blocks - Pictures alternate left/right
 */
export class AlternatingPictureBlocksLayout extends BaseLayoutAlgorithm {
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

    const blockHeight = 100;
    const vSpacing = 20;
    const pictureWidth = bounds.width * 0.4;
    const textWidth = bounds.width * 0.55;
    const gap = bounds.width * 0.05;

    sortedRoots.forEach((id, index) => {
      const isLeft = index % 2 === 0;
      const y = index * (blockHeight + vSpacing);

      // For alternating layout, the picture area determines position
      // Text area is on the opposite side
      positions.set(id, {
        x: isLeft ? 0 : gap + textWidth,
        y,
        width: pictureWidth,
        height: blockHeight,
        rotation: 0,
      });
    });

    const totalHeight = count * blockHeight + (count - 1) * vSpacing;

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
 * Picture Caption List - Pictures with captions below
 */
export class PictureCaptionListLayout extends BaseLayoutAlgorithm {
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

    // Horizontal arrangement
    const spacing = 15;
    const itemWidth = (bounds.width - (count - 1) * spacing) / count;
    const pictureHeight = bounds.height * 0.7;

    sortedRoots.forEach((id, index) => {
      positions.set(id, {
        x: index * (itemWidth + spacing),
        y: 0,
        width: itemWidth,
        height: pictureHeight,
        rotation: 0,
      });
    });

    return { positions, connectors: [], bounds };
  }
}

/**
 * Picture Grid - Grid arrangement of pictures
 */
export class PictureGridLayout extends BaseLayoutAlgorithm {
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

    // Calculate grid dimensions
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
 * Circle Picture List - Circular picture frames
 */
export class CirclePictureListLayout extends BaseLayoutAlgorithm {
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

    // Horizontal arrangement of circles
    const spacing = 20;
    const maxDiameter = Math.min(
      (bounds.width - (count - 1) * spacing) / count,
      bounds.height * 0.7,
    );
    const diameter = Math.min(maxDiameter, 100);
    const totalWidth = count * diameter + (count - 1) * spacing;
    const startX = (bounds.width - totalWidth) / 2;
    const centerY = bounds.height / 2 - diameter / 2;

    sortedRoots.forEach((id, index) => {
      positions.set(id, {
        x: startX + index * (diameter + spacing),
        y: centerY,
        width: diameter,
        height: diameter,
        rotation: 0,
      });
    });

    return { positions, connectors: [], bounds };
  }
}

/**
 * Bent Up Picture - Angled/tilted picture arrangement
 */
export class BentUpPictureLayout extends BaseLayoutAlgorithm {
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

    // Staggered diagonal arrangement
    const itemWidth = 100;
    const itemHeight = 80;
    const hSpacing = 30;
    const vOffset = 20; // Vertical offset for each item

    const totalWidth = count * itemWidth + (count - 1) * hSpacing;
    const startX = (bounds.width - totalWidth) / 2;
    const startY = bounds.height / 4;

    sortedRoots.forEach((id, index) => {
      // Create a wave-like pattern
      const yOffset = index % 2 === 0 ? 0 : vOffset;

      positions.set(id, {
        x: startX + index * (itemWidth + hSpacing),
        y: startY + yOffset,
        width: itemWidth,
        height: itemHeight,
        rotation: index % 2 === 0 ? -5 : 5, // Slight alternating tilt
      });
    });

    return { positions, connectors: [], bounds };
  }
}

// =============================================================================
// Implementation Registry
// =============================================================================

export const pictureImplementations = new Map<string, ILayoutAlgorithm>([
  ['picture/alternating-picture-blocks', new AlternatingPictureBlocksLayout()],
  ['picture/picture-caption-list', new PictureCaptionListLayout()],
  ['picture/picture-grid', new PictureGridLayout()],
  ['picture/circle-picture-list', new CirclePictureListLayout()],
  ['picture/bent-up-picture', new BentUpPictureLayout()],
]);

// =============================================================================
// Layout Registration
// =============================================================================

export function registerPictureLayouts(registry: ILayoutRegistry): void {
  registry.register({
    id: 'picture/alternating-picture-blocks',
    name: 'Alternating Picture Blocks',
    description: 'Use to show pictures alternating with text blocks',
    category: 'picture',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: true,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'linear-vertical',
    thumbnail: '',
  });

  registry.register({
    id: 'picture/picture-caption-list',
    name: 'Picture Caption List',
    description: 'Use to show pictures with captions below',
    category: 'picture',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: true,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'linear-horizontal',
    thumbnail: '',
  });

  registry.register({
    id: 'picture/picture-grid',
    name: 'Picture Grid',
    description: 'Use to show pictures in a grid layout',
    category: 'picture',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: true,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'grid',
    thumbnail: '',
  });

  registry.register({
    id: 'picture/circle-picture-list',
    name: 'Circle Picture List',
    description: 'Use to show pictures in circular frames',
    category: 'picture',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: true,
    defaultShapeType: 'ellipse',
    defaultConnectorType: 'none',
    algorithm: 'linear-horizontal',
    thumbnail: '',
  });

  registry.register({
    id: 'picture/bent-up-picture',
    name: 'Bent Up Picture',
    description: 'Use to show pictures in a dynamic angled arrangement',
    category: 'picture',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 1,
    supportsChildren: false,
    supportsPictures: true,
    defaultShapeType: 'rect',
    defaultConnectorType: 'none',
    algorithm: 'linear-horizontal',
    thumbnail: '',
  });
}
