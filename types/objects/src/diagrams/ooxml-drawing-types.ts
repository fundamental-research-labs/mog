/**
 * OOXML Diagram Drawing Cache Types
 *
 * Type definitions for the pre-rendered Diagram drawing cache (drawing#.xml)
 * as defined in the Microsoft Office Drawing extension namespace.
 *
 * The drawing cache is a Microsoft extension to OOXML that stores the
 * **pre-rendered** shape positions and properties as computed by Excel's
 * layout engine. This serves two critical purposes:
 *
 * 1. **Fallback rendering**: Applications that don't implement the full layout
 *    engine can display the pre-rendered shapes instead of computing layout.
 * 2. **Fidelity preservation**: When round-tripping through applications that
 *    don't support all layout features, the cached shapes preserve the original
 *    appearance.
 *
 * The drawing#.xml file uses the `dsp:` namespace (Drawing Shapes) and contains
 * a shape tree with fully resolved positions, fills, lines, and text bodies.
 *
 * XML namespace: `dsp` (http://schemas.microsoft.com/office/drawing/2008/diagram)
 * File: `diagrams/drawing#.xml` within the XLSX package
 *
 * @see Microsoft Office Drawing Extensions
 * @see [MS-ODRAWXML] Section 2.3 (Diagram Drawing)
 */

import type {
  DmlColorValue,
  DmlEffectProperties,
  DmlFillProperties,
  DmlLineProperties,
  DmlShapeProperties,
  DmlShapeTransform,
  ModelId,
  RichText,
} from './ooxml-data-model-types';

// =============================================================================
// Diagram Shape
// =============================================================================

/**
 * A pre-rendered shape in the drawing cache.
 *
 * Each DiagramShape represents a fully resolved shape from the layout engine's
 * output, with absolute positions (in EMUs), resolved fills and lines, and
 * complete text bodies. These shapes map back to data model points via modelId.
 *
 * Corresponds to `dsp:sp` elements within the `dsp:spTree`.
 *
 * @see [MS-ODRAWXML] Section 2.3.4 (dsp:sp)
 */
export interface DiagramShape {
  /**
   * Model ID linking this shape back to a data model point.
   * Used to correlate cached shapes with their source data nodes.
   * May be undefined for purely decorative shapes (backgrounds, connectors
   * without data model representation).
   */
  modelId?: ModelId;

  /**
   * Full shape properties with resolved transform.
   *
   * The key difference from data model spPr is that the xfrm (transform)
   * contains ABSOLUTE positions resolved by the layout engine, not relative
   * offsets. Positions and sizes are in EMUs (English Metric Units).
   *
   * Includes:
   * - xfrm: Absolute position (offset) and size (extent) in EMUs
   * - presetGeometry: The resolved shape type
   * - fill: Fully resolved fill (scheme colors already mapped to hex)
   * - line: Fully resolved line/stroke properties
   * - effectList: Resolved effects
   */
  shapeProperties?: DiagramCachedShapeProperties;

  /**
   * Text body with resolved content and formatting.
   *
   * Contains the full rich text content that should be rendered within
   * this shape, including body properties and paragraphs with runs.
   */
  textBody?: RichText;

  /**
   * Shape style reference.
   * References a style from the document's theme.
   */
  style?: DiagramCachedShapeStyle;

  /**
   * Non-visual drawing properties.
   * Contains the shape name and other non-visual metadata.
   */
  nvSpPr?: NonVisualShapeProperties;
}

/**
 * Shape properties specific to the drawing cache.
 *
 * Extends the base DmlShapeProperties with additional fields that are
 * present in the pre-rendered cache but not in the data model.
 *
 * @see [MS-ODRAWXML] Section 2.3.4.1 (dsp:spPr)
 */
export interface DiagramCachedShapeProperties extends DmlShapeProperties {
  /**
   * Resolved 2D transform with absolute coordinates.
   *
   * In the drawing cache, the transform contains:
   * - offset.x / offset.y: Absolute position in EMUs from the diagram origin
   * - extent.cx / extent.cy: Size in EMUs
   * - rotation: Rotation angle in 60,000ths of a degree
   * - flipH / flipV: Horizontal/vertical flip flags
   *
   * This differs from data model xfrm where positions may be relative.
   */
  xfrm?: DmlShapeTransform;

  /**
   * Custom geometry path data.
   * Present when the shape uses a custom geometry rather than a preset.
   * Contains the path commands (moveTo, lineTo, cubicBezTo, close, etc.).
   */
  customGeometry?: CustomGeometry;
}

/**
 * Custom geometry definition for non-preset shapes.
 *
 * Contains path data and optional adjustment values for shapes
 * that don't use a preset geometry.
 *
 * @see ECMA-376 Part 1, Section 20.1.9.1 (a:custGeom)
 */
export interface CustomGeometry {
  /** Adjustment value definitions. */
  avLst?: Record<string, number>;

  /** Guide definitions for computing geometry. */
  gdLst?: GeometryGuide[];

  /** Connection sites on the shape. */
  cxnLst?: GeometryConnectionSite[];

  /** The path list defining the shape outline(s). */
  pathLst: GeometryPath[];
}

/**
 * A geometry guide (computed value used in path definitions).
 *
 * @see ECMA-376 Part 1, Section 20.1.9.11 (a:gd)
 */
export interface GeometryGuide {
  /** Guide name (referenced by path commands). */
  name: string;

  /** Formula string for computing the guide value. */
  formula: string;
}

/**
 * A connection site on a custom geometry shape.
 *
 * @see ECMA-376 Part 1, Section 20.1.9.9 (a:cxn)
 */
export interface GeometryConnectionSite {
  /** Angle of the connection site in 60,000ths of a degree. */
  angle: string;

  /** X coordinate position. */
  x: string;

  /** Y coordinate position. */
  y: string;
}

/**
 * A single geometry path.
 *
 * @see ECMA-376 Part 1, Section 20.1.9.15 (a:path)
 */
export interface GeometryPath {
  /** Path width in EMUs. */
  w?: number;

  /** Path height in EMUs. */
  h?: number;

  /** Fill mode for this path. */
  fill?: 'none' | 'norm' | 'lighten' | 'lightenLess' | 'darken' | 'darkenLess';

  /** Whether this path has a stroke. */
  stroke?: boolean;

  /** Ordered list of path commands. */
  commands: GeometryPathCommand[];
}

/**
 * A single command in a geometry path.
 *
 * @see ECMA-376 Part 1, Section 20.1.9 (Geometry Path Commands)
 */
export type GeometryPathCommand =
  | { type: 'moveTo'; x: string; y: string }
  | { type: 'lineTo'; x: string; y: string }
  | { type: 'cubicBezTo'; x1: string; y1: string; x2: string; y2: string; x3: string; y3: string }
  | { type: 'quadBezTo'; x1: string; y1: string; x2: string; y2: string }
  | { type: 'arcTo'; wR: string; hR: string; stAng: string; swAng: string }
  | { type: 'close' };

// =============================================================================
// Shape Style Reference (Drawing Cache)
// =============================================================================

/**
 * Shape style reference from the drawing cache.
 *
 * References line, fill, effect, and font styles from the document theme.
 * Named `DiagramCachedShapeStyle` to distinguish from the `StyleReference`
 * in ooxml-style-types.ts which represents style label style references.
 *
 * @see ECMA-376 Part 1, Section 21.3.2.24 (a:style)
 */
export interface DiagramCachedShapeStyle {
  /** Line style reference (index into theme's ln format scheme). */
  lnRef?: DiagramThemeRef;

  /** Fill style reference (index into theme's fill format scheme). */
  fillRef?: DiagramThemeRef;

  /** Effect style reference (index into theme's effect format scheme). */
  effectRef?: DiagramThemeRef;

  /** Font style reference (index into theme's font scheme). */
  fontRef?: DiagramFontRef;
}

/**
 * A theme style reference with an index and optional color override.
 *
 * @see ECMA-376 Part 1, Section 20.1.4.2 (Style References)
 */
export interface DiagramThemeRef {
  /** Index into the theme's format scheme (0 = none, 1-999 = themed). */
  idx: number;

  /** Optional color override. */
  color?: DmlColorValue;
}

/**
 * A font style reference with a theme index and optional color override.
 *
 * @see ECMA-376 Part 1, Section 20.1.4.1.17 (a:fontRef)
 */
export interface DiagramFontRef {
  /** Font style index: "major", "minor", or "none". */
  idx: 'major' | 'minor' | 'none';

  /** Optional color override. */
  color?: DmlColorValue;
}

// =============================================================================
// Non-Visual Shape Properties
// =============================================================================

/**
 * Non-visual properties for a diagram shape.
 *
 * Contains metadata about the shape that doesn't affect visual rendering,
 * such as the shape name and ID.
 *
 * @see [MS-ODRAWXML] Section 2.3.4.2 (dsp:nvSpPr)
 */
export interface NonVisualShapeProperties {
  /** Shape name (e.g., "Rectangle 1", "Connector 3"). */
  name?: string;

  /** Numeric shape ID within the drawing. */
  id?: number;

  /** Whether the shape is hidden. */
  hidden?: boolean;

  /** Title/alt text for accessibility. */
  title?: string;

  /** Description/alt text for accessibility. */
  descr?: string;
}

// =============================================================================
// Group Shape
// =============================================================================

/**
 * A group of shapes in the drawing cache.
 *
 * Groups contain multiple child shapes that are transformed together.
 * Used for composite layout nodes that contain multiple visual elements.
 *
 * Corresponds to `dsp:grpSp` elements.
 *
 * @see [MS-ODRAWXML] Section 2.3.3 (dsp:grpSp)
 */
export interface DiagramGroupShape {
  /** Group shape properties (transform for the group as a whole). */
  groupShapeProperties?: DiagramGroupShapeProperties;

  /** Non-visual properties for the group. */
  nvGrpSpPr?: NonVisualShapeProperties;

  /** Child shapes within this group. */
  shapes: Array<DiagramShape | DiagramGroupShape>;
}

/**
 * Properties for a group shape, including the group transform.
 *
 * @see ECMA-376 Part 1, Section 20.1.2.2.22 (a:grpSpPr)
 */
export interface DiagramGroupShapeProperties {
  /** Transform for the group as a whole. */
  xfrm?: DiagramGroupTransform;

  /** Fill applied to the group. */
  fill?: DmlFillProperties;

  /** Line/stroke applied to the group. */
  line?: DmlLineProperties;

  /** Effects applied to the group. */
  effectList?: DmlEffectProperties;
}

/**
 * 2D transform for a group shape.
 *
 * Includes both the child offset (position within parent) and the
 * child extent (logical coordinate space for child elements).
 *
 * @see ECMA-376 Part 1, Section 20.1.7.5 (a:xfrm for groups)
 */
export interface DiagramGroupTransform {
  /** Group position offset from parent origin. */
  offset?: { x: number; y: number };

  /** Group size (extent) in EMUs. */
  extent?: { cx: number; cy: number };

  /** Child coordinate origin offset. */
  childOffset?: { x: number; y: number };

  /** Child coordinate extent (logical coordinate space). */
  childExtent?: { cx: number; cy: number };

  /** Rotation angle in 60,000ths of a degree. */
  rotation?: number;

  /** Whether the group is flipped horizontally. */
  flipH?: boolean;

  /** Whether the group is flipped vertically. */
  flipV?: boolean;
}

// =============================================================================
// Diagram Drawing (Top-Level)
// =============================================================================

/**
 * Complete pre-rendered diagram drawing (dsp:drawing).
 *
 * The top-level container for a drawing#.xml file. Contains a shape tree
 * with all shapes fully positioned and styled by the original layout engine.
 *
 * This is used as a fallback rendering source:
 * - When the layout engine doesn't support a particular layout feature
 * - When preserving fidelity during OOXML round-trips
 * - When generating XLSX files for Excel compatibility (Excel expects drawing#.xml)
 *
 * @see [MS-ODRAWXML] Section 2.3.1 (dsp:drawing)
 */
export interface DiagramDrawing {
  /**
   * The shape tree containing all pre-rendered shapes.
   *
   * Shapes are stored in z-order (back-to-front). Each shape has absolute
   * positions in EMUs, resolved fills/strokes, and complete text bodies.
   *
   * May contain both individual shapes and group shapes.
   */
  shapeTree: Array<DiagramShape | DiagramGroupShape>;
}
