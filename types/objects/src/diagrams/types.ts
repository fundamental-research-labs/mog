/**
 * Diagram Types
 *
 * Type definitions for diagrams. Diagrams provide visual
 * representations of information like organization charts, process flows,
 * relationship diagrams, and hierarchies.
 *
 * Architecture Notes:
 * - diagramDiagram is the deserialized TypeScript view, NOT Yjs storage
 * - computedLayout is a runtime cache, NOT persisted to Yjs
 * - NodeId is a branded type for type safety
 * - Actual Yjs storage uses Y.Map and Y.Array (handled by bridge layer)
 */

// Re-export ShapeType from the shared floating-object types for cases where
// any shape is needed. Importing from `../objects/floating-object-types`
// (rather than `../objects/floating-objects`) keeps this module cycle-free.
import type { ShapeType } from '../objects/floating-object-types';
export type { ShapeType };

// =============================================================================
// Node Identity
// =============================================================================

/**
 * Unique identifier for a diagram node.
 *
 * This is a branded type for type safety - prevents accidental use of
 * arbitrary strings as NodeIds. Uses UUID v4 format.
 */
export type NodeId = string & { readonly __brand: 'DiagramNodeId' };

/**
 * Node insertion position relative to a target diagram node.
 * Used by bridges, api/worksheet/diagrams, and editor actions.
 */
export type NodePosition = 'before' | 'after' | 'above' | 'below' | 'child';

/**
 * Hierarchical movement direction for a diagram node.
 * Used by bridges, api/worksheet/diagrams, and editor actions.
 */
export type NodeMoveDirection = 'promote' | 'demote' | 'move-up' | 'move-down';

// =============================================================================
// diagram Categories
// =============================================================================

/**
 * diagram categories matching Excel.
 *
 * Each category represents a different type of visual representation:
 * - list: Sequential or grouped items
 * - process: Steps or stages in a workflow
 * - cycle: Continuous or circular processes
 * - hierarchy: Organization charts, tree structures
 * - relationship: Connections between concepts
 * - matrix: Grid-based relationships
 * - pyramid: Proportional or hierarchical layers
 * - picture: Image-centric layouts
 */
export type DiagramCategory =
  | 'list'
  | 'process'
  | 'cycle'
  | 'hierarchy'
  | 'relationship'
  | 'matrix'
  | 'pyramid'
  | 'picture';

// =============================================================================
// diagram Node
// =============================================================================

/**
 * Single node in a diagram.
 *
 * Nodes form a tree structure with parent-child relationships.
 * Each node can have optional per-node styling that overrides diagram defaults.
 */
export interface DiagramNode {
  /** Unique node identifier */
  id: NodeId;

  /** Text content displayed in the node */
  text: string;

  /** Hierarchy level (0 = root, 1 = child, 2 = grandchild, etc.) */
  level: number;

  /** Parent node ID (null for root nodes) */
  parentId: NodeId | null;

  /** Ordered child node IDs */
  childIds: NodeId[];

  /** Order among siblings (used for layout ordering) */
  siblingOrder: number;

  // --- Optional per-node styling (overrides diagram defaults) ---

  /** Fill/background color (CSS color string) */
  fillColor?: string;

  /** Border/stroke color (CSS color string) */
  borderColor?: string;

  /** Text color (CSS color string) */
  textColor?: string;

  /** Font family for node text */
  fontFamily?: string;

  /** Font size in points */
  fontSize?: number;

  /** Font weight */
  fontWeight?: 'normal' | 'bold';

  /** Font style */
  fontStyle?: 'normal' | 'italic';

  // --- Picture support (for picture layouts) ---

  /** Image URL for picture layouts */
  imageUrl?: string;

  /** How the image fits within the node bounds */
  imageFit?: 'cover' | 'contain' | 'fill';
}

// =============================================================================
// diagram Diagram
// =============================================================================

/**
 * diagram model (deserialized TypeScript view).
 *
 * IMPORTANT: This interface represents the runtime/API view of the data.
 * Actual Yjs storage uses Y.Map and Y.Array types as defined in
 * DIAGRAM_DIAGRAM_SCHEMA. The bridge handles conversion between formats.
 *
 * NOTE: computedLayout is NOT part of this interface because it's a
 * runtime cache managed by the bridge, not persisted data.
 *
 * COPY SEMANTICS:
 * When copying a diagramDiagram, the bridge must:
 * 1. Generate new NodeIds for all nodes (using createNodeId())
 * 2. Build oldId -> newId mapping
 * 3. Deep-copy node data (text, styling, level, siblingOrder)
 * 4. Remap parentId and childIds references using mapping
 * 5. Update rootNodeIds array with new IDs
 * 6. Preserve tree structure with new identity
 */
export interface Diagram {
  /** Layout ID (e.g., 'hierarchy/org-chart', 'process/basic-process') */
  layoutId: string;

  /** Category of the diagram */
  category: DiagramCategory;

  /** Map of all nodes by their ID */
  nodes: Map<NodeId, DiagramNode>;

  /** Top-level (root) node IDs in display order */
  rootNodeIds: NodeId[];

  /** Quick style ID (e.g., 'subtle-effect', 'moderate-effect') */
  quickStyleId: string;

  /** Color theme ID (e.g., 'colorful-1', 'accent-1') */
  colorThemeId: string;

  /** Layout-specific options (varies by layout type) */
  layoutOptions: Record<string, unknown>;
}

// =============================================================================
// diagram Shape Types
// =============================================================================

/**
 * diagram-specific shape types.
 *
 * This is a subset of the full ShapeType union from floating-objects.ts
 * that diagram layouts commonly use. The names match exactly with the
 * ShapeType definitions to ensure compatibility.
 */
export type DiagramShapeType =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'diamond'
  | 'hexagon'
  | 'chevron'
  | 'rightArrow'
  | 'pentagon'
  | 'trapezoid'
  | 'parallelogram'
  | 'plus'
  | 'star5'
  | 'cloud'
  | 'wedgeRectCallout';

// =============================================================================
// Computed Layout (Runtime Cache)
// =============================================================================

/**
 * Computed layout result (runtime cache, NOT persisted to Yjs).
 *
 * This is calculated by layout algorithms and cached by the bridge.
 * Invalidated whenever the diagram structure or styling changes.
 *
 * Layout computation is expensive, so this cache avoids recalculating
 * positions on every render.
 */
export interface ComputedLayout {
  /** Computed shape positions and styles for each node */
  shapes: ComputedShape[];

  /** Computed connector paths between nodes */
  connectors: ComputedConnector[];

  /** Overall bounds of the rendered diagram */
  bounds: { width: number; height: number };

  /** Version number, incremented on each layout change */
  version: number;
}

/**
 * Computed shape position and style for a single node.
 *
 * Contains all information needed to render a node's shape.
 */
export interface ComputedShape {
  /** The node this shape represents */
  nodeId: NodeId;

  /** Shape type to render */
  shapeType: DiagramShapeType;

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

  /** Fill color (CSS color string) */
  fill: string;

  /** Stroke/border color (CSS color string) */
  stroke: string;

  /** Stroke width in pixels */
  strokeWidth: number;

  /** Text content to display */
  text: string;

  /** Text styling */
  textStyle: TextStyle;

  /** Visual effects (shadow, glow, etc.) */
  effects: ShapeEffects;
}

// =============================================================================
// Connectors
// =============================================================================

/**
 * Type of connector line between nodes.
 */
export type ConnectorType = 'straight' | 'elbow' | 'curved' | 'none';

/**
 * Path data for rendering a connector.
 */
export interface ConnectorPath {
  /** Path type */
  type: 'line' | 'bezier' | 'polyline';

  /** Points along the path */
  points: Array<{ x: number; y: number }>;

  /** Control points for bezier curves */
  controlPoints?: Array<{ x: number; y: number }>;
}

/**
 * Computed connector between two nodes.
 */
export interface ComputedConnector {
  /** Source node ID */
  fromNodeId: NodeId;

  /** Target node ID */
  toNodeId: NodeId;

  /** Connector type */
  connectorType: ConnectorType;

  /** Path data for rendering */
  path: ConnectorPath;

  /** Stroke color (CSS color string) */
  stroke: string;

  /** Stroke width in pixels */
  strokeWidth: number;

  /** Arrow head at start of connector */
  arrowStart?: ArrowHead;

  /** Arrow head at end of connector */
  arrowEnd?: ArrowHead;
}

/**
 * Arrow head style for connectors.
 */
export interface ArrowHead {
  /** Arrow head type */
  type: 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval' | 'open';

  /** Arrow head size */
  size: 'small' | 'medium' | 'large';
}

// =============================================================================
// Text Styling
// =============================================================================

/**
 * Text styling properties for node labels.
 */
export interface TextStyle {
  /** Font family name */
  fontFamily: string;

  /** Font size in points */
  fontSize: number;

  /** Font weight */
  fontWeight: 'normal' | 'bold';

  /** Font style */
  fontStyle: 'normal' | 'italic';

  /** Text color (CSS color string) */
  color: string;

  /** Horizontal text alignment */
  align: 'left' | 'center' | 'right';

  /** Vertical text alignment */
  verticalAlign: 'top' | 'middle' | 'bottom';
}

// =============================================================================
// Shape Effects
// =============================================================================

/**
 * Visual effects that can be applied to shapes.
 */
export interface ShapeEffects {
  /** Drop shadow effect */
  shadow?: ShadowEffect;

  /** Glow effect around the shape */
  glow?: GlowEffect;

  /** Reflection effect below the shape */
  reflection?: ReflectionEffect;

  /** 3D bevel effect */
  bevel?: BevelEffect;

  /** 3D transformation effect */
  transform3D?: Transform3DEffect;
}

/**
 * Drop shadow effect configuration.
 */
export interface ShadowEffect {
  /** Shadow color (CSS color string) */
  color: string;

  /** Blur radius in pixels */
  blur: number;

  /** Horizontal offset in pixels */
  offsetX: number;

  /** Vertical offset in pixels */
  offsetY: number;

  /** Opacity (0 = transparent, 1 = opaque) */
  opacity: number;
}

/**
 * Glow effect configuration.
 */
export interface GlowEffect {
  /** Glow color (CSS color string) */
  color: string;

  /** Glow radius in pixels */
  radius: number;

  /** Opacity (0 = transparent, 1 = opaque) */
  opacity: number;
}

/**
 * Reflection effect configuration.
 */
export interface ReflectionEffect {
  /** Blur amount for the reflection */
  blur: number;

  /** Distance from the shape to the reflection */
  distance: number;

  /** Opacity of the reflection (0 = transparent, 1 = opaque) */
  opacity: number;

  /** Size of the reflection relative to the shape (0-1) */
  size: number;
}

/**
 * 3D bevel effect configuration.
 */
export interface BevelEffect {
  /** Bevel preset type */
  type:
    | 'none'
    | 'relaxed'
    | 'circle'
    | 'slope'
    | 'cross'
    | 'angle'
    | 'soft-round'
    | 'convex'
    | 'cool-slant'
    | 'divot'
    | 'riblet'
    | 'hard-edge'
    | 'art-deco';

  /** Bevel width in pixels */
  width: number;

  /** Bevel height in pixels */
  height: number;
}

/**
 * 3D transformation effect configuration.
 */
export interface Transform3DEffect {
  /** Rotation around X axis in degrees */
  rotationX: number;

  /** Rotation around Y axis in degrees */
  rotationY: number;

  /** Rotation around Z axis in degrees */
  rotationZ: number;

  /** Perspective distance for 3D effect */
  perspective: number;
}
