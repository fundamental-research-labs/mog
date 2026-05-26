/**
 * Diagram Layout Types
 *
 * Type definitions for Diagram layout algorithms and registry.
 * Layouts define how nodes are positioned and connected within a diagram.
 *
 * Architecture Notes:
 * - DiagramLayoutDefinition describes layout metadata and constraints
 * - ILayoutRegistry interface is types-only; implementation lives in engine
 * - ILayoutAlgorithm defines the contract for layout computation
 * - LayoutResult uses NodeId branded type for type safety
 */

import type { ConnectorType, NodeId, DiagramCategory, DiagramShapeType } from './types';

// =============================================================================
// Layout Definition
// =============================================================================

/**
 * Layout definition - describes how to render a Diagram type.
 *
 * Each layout definition specifies:
 * - Metadata (name, description, thumbnail for gallery)
 * - Constraints (min/max nodes, hierarchy depth, feature support)
 * - Defaults (shape type, connector type)
 * - Algorithm to use for positioning
 */
export interface DiagramLayoutDefinition {
  /** Unique layout identifier (e.g., 'hierarchy/org-chart', 'process/basic-process') */
  id: string;

  /** Display name shown in the gallery */
  name: string;

  /** Description for gallery tooltip/help text */
  description: string;

  /** Category this layout belongs to */
  category: DiagramCategory;

  // --- Constraints ---

  /** Minimum number of nodes required for this layout */
  minNodes: number;

  /** Maximum number of nodes allowed (null = unlimited) */
  maxNodes: number | null;

  /** Maximum hierarchy depth (levels) supported */
  maxLevels: number;

  /** Whether nodes can have children (hierarchical structure) */
  supportsChildren: boolean;

  /** Whether layout supports picture placeholders in nodes */
  supportsPictures: boolean;

  // --- Defaults ---

  /** Default shape type for nodes in this layout */
  defaultShapeType: DiagramShapeType;

  /** Default connector type between nodes */
  defaultConnectorType: ConnectorType;

  // --- Algorithm ---

  /** Layout algorithm to use for positioning */
  algorithm: LayoutAlgorithm;

  // --- Gallery ---

  /** Thumbnail image for the layout gallery (base64 data URL or asset URL) */
  thumbnail: string;
}

// =============================================================================
// Layout Algorithms
// =============================================================================

/**
 * Available layout algorithms.
 *
 * Each algorithm positions nodes according to different patterns:
 *
 * LINEAR ALGORITHMS:
 * - 'linear-horizontal': Nodes in a horizontal row
 * - 'linear-vertical': Nodes in a vertical column
 * - 'snake': Nodes snake horizontally then wrap to next row
 *
 * TREE ALGORITHMS:
 * - 'tree-horizontal': Tree with horizontal parent-child flow
 * - 'tree-vertical': Tree with vertical parent-child flow
 *
 * CIRCULAR ALGORITHMS:
 * - 'radial': Nodes radiate outward from center
 * - 'circular': Nodes arranged in a circle
 *
 * GRID ALGORITHMS:
 * - 'grid': Nodes arranged in a matrix/grid
 *
 * SPECIALIZED ALGORITHMS:
 * - 'pyramid': Triangular/pyramid arrangement
 * - 'funnel': Funnel shape (wide at top, narrow at bottom)
 * - 'venn': Overlapping circles (Venn diagram)
 * - 'target': Concentric circles (target/bullseye)
 * - 'gear': Interlocking gear shapes
 * - 'balance': Balance scale arrangement
 *
 * CUSTOM:
 * - 'custom': Custom positioning logic (for unique layouts)
 */
export type LayoutAlgorithm =
  | 'linear-horizontal'
  | 'linear-vertical'
  | 'snake'
  | 'tree-horizontal'
  | 'tree-vertical'
  | 'radial'
  | 'circular'
  | 'grid'
  | 'pyramid'
  | 'funnel'
  | 'venn'
  | 'target'
  | 'gear'
  | 'balance'
  | 'custom';

// =============================================================================
// Layout Registry Interface
// =============================================================================

/**
 * Interface for layout registry.
 *
 * NOTE: This is a type definition only. The actual registry with all
 * 42+ layout definitions is implemented in engine/src/diagram/registry.ts.
 *
 * The registry is responsible for:
 * - Storing all available layout definitions
 * - Providing lookup by ID or category
 * - Allowing registration of custom layouts
 */
export interface ILayoutRegistry {
  /** Map of all registered layouts by ID */
  layouts: Map<string, DiagramLayoutDefinition>;

  /**
   * Get all layouts in a specific category.
   * @param category The category to filter by
   * @returns Array of layout definitions in that category
   */
  getByCategory(category: DiagramCategory): DiagramLayoutDefinition[];

  /**
   * Get a layout by its ID.
   * @param id The layout ID to look up
   * @returns The layout definition, or undefined if not found
   */
  getById(id: string): DiagramLayoutDefinition | undefined;

  /**
   * Register a new layout (for custom layouts).
   * @param layout The layout definition to register
   */
  register(layout: DiagramLayoutDefinition): void;
}

// =============================================================================
// Layout Algorithm Interface
// =============================================================================

/**
 * Layout algorithm interface - implemented per layout type.
 *
 * Each algorithm takes the diagram structure and computes positions
 * for all nodes and connectors.
 *
 * NOTE: Uses NodeId branded type for type safety. The bridge ensures
 * all node IDs are valid NodeIds before passing to layout algorithms.
 */
export interface ILayoutAlgorithm {
  /**
   * Compute positions for all nodes.
   *
   * @param nodes Map of NodeId to node hierarchy info (level, parent, children, order)
   * @param rootNodeIds Ordered array of root node IDs
   * @param bounds Available space for layout (width and height in pixels)
   * @param options Layout-specific options (varies by algorithm)
   * @returns Computed positions and connector paths
   */
  compute(
    nodes: Map<
      NodeId,
      {
        level: number;
        parentId: NodeId | null;
        childIds: NodeId[];
        siblingOrder: number;
      }
    >,
    rootNodeIds: NodeId[],
    bounds: { width: number; height: number },
    options: Record<string, unknown>,
  ): LayoutResult;
}

// =============================================================================
// Layout Result
// =============================================================================

/**
 * Result of a layout computation.
 *
 * Contains all positioning information needed to render the diagram.
 */
export interface LayoutResult {
  /**
   * Computed positions for each node.
   * Maps NodeId to position/size/rotation.
   */
  positions: Map<
    NodeId,
    {
      /** X position in pixels (relative to diagram origin) */
      x: number;
      /** Y position in pixels (relative to diagram origin) */
      y: number;
      /** Width in pixels */
      width: number;
      /** Height in pixels */
      height: number;
      /** Rotation angle in degrees */
      rotation: number;
    }
  >;

  /**
   * Computed connector paths between nodes.
   */
  connectors: Array<{
    /** Source node ID */
    fromId: NodeId;
    /** Target node ID */
    toId: NodeId;
    /** Path data for rendering */
    path: {
      type: 'line' | 'bezier' | 'polyline';
      points: Array<{ x: number; y: number }>;
    };
  }>;

  /**
   * Overall bounds of the computed layout.
   * May differ from input bounds if content doesn't fill space.
   */
  bounds: { width: number; height: number };
}
