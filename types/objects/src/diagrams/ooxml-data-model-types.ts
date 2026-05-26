/**
 * OOXML Diagram Data Model Types
 *
 * Type definitions for the Diagram data model (data#.xml) as defined in
 * ECMA-376 Part 1, Section 21.4 (DrawingML - Diagrams).
 *
 * The data model represents the logical content of a Diagram diagram:
 * - Points: individual nodes with text, properties, and shape overrides
 * - Connections: parent-child, presentation, and sibling relationships
 * - Rich text: formatted text with paragraphs, runs, and styling
 * - Property sets: per-point metadata (placeholders, custom text, etc.)
 *
 * NOTE ON NAMING: Color types in this file use the `Dml` prefix (DrawingML) to
 * distinguish them from the simpler style-label color types in ooxml-style-types.ts.
 * The `Dml*` types are the full DrawingML color model supporting scheme, srgb,
 * system, and preset colors. The style-types `SchemeColor` is style-label-specific.
 *
 * XML namespace: `dgm` (http://schemas.openxmlformats.org/drawingml/2006/diagram)
 * File: `diagrams/data#.xml` within the XLSX package
 *
 * @see ECMA-376 Part 1, Section 21.4.2 (Diagram Data)
 * @see ECMA-376 Part 1, Section 21.4.2.19 (dgm:dataModel)
 */

// =============================================================================
// Branded Types
// =============================================================================

/**
 * Unique identifier for a data model point.
 *
 * In OOXML, this is the `modelId` attribute on `dgm:pt` and `dgm:cxn` elements.
 * Values are typically small integers represented as strings (e.g., "0", "1", "2")
 * but can be any unique string. Using a branded type prevents accidental use
 * of arbitrary strings as model identifiers.
 *
 * @see ECMA-376 Part 1, Section 21.4.7.41 (ST_ModelId)
 */
export type ModelId = string & { readonly __brand: 'OoxmlModelId' };

// =============================================================================
// Point Type Enum
// =============================================================================

/**
 * Type of a data model point.
 *
 * Determines the role of a point in the diagram's data hierarchy.
 * Maps to OOXML `ST_PtType` (dgm:pt/@type attribute).
 *
 * @see ECMA-376 Part 1, Section 21.4.7.50 (ST_PtType)
 */
export const PointType = {
  /** Document root point. Every data model has exactly one doc point. */
  doc: 'doc',

  /**
   * Normal content node. The default type for user-visible nodes.
   * Alias: in many contexts "node" and "norm" are interchangeable;
   * the spec uses "node" as the default when type is omitted.
   */
  node: 'node',

  /** Normalized node. A content node that participates in normalization. */
  norm: 'norm',

  /** Non-normalized node. A content node excluded from normalization. */
  nonNorm: 'nonNorm',

  /** Assistant node. Used in org charts for assistant positions. */
  asst: 'asst',

  /** Non-assistant node. Explicitly marked as not an assistant. */
  nonAsst: 'nonAsst',

  /** Parent transition. A connector/transition shape between parent and child. */
  parTrans: 'parTrans',

  /** Presentation point. A layout-generated point (not part of the user's data). */
  pres: 'pres',

  /** Sibling transition. A connector/transition shape between siblings. */
  sibTrans: 'sibTrans',
} as const;

/** Union type of all valid point type values. */
export type PointTypeValue = (typeof PointType)[keyof typeof PointType];

// =============================================================================
// Connection Type Enum
// =============================================================================

/**
 * Type of a data model connection.
 *
 * Connections define relationships between points. Maps to OOXML
 * `ST_CxnType` (dgm:cxn/@type attribute).
 *
 * @see ECMA-376 Part 1, Section 21.4.7.15 (ST_CxnType)
 */
export const ConnectionType = {
  /** Parent-of relationship. Defines the tree hierarchy of data nodes. */
  parOf: 'parOf',

  /** Presentation-of relationship. Maps data points to layout presentation nodes. */
  presOf: 'presOf',

  /** Presentation-parent-of relationship. Defines hierarchy among presentation nodes. */
  presParOf: 'presParOf',

  /** Unknown relationship. Fallback for unrecognized connection types. */
  unknownRelationship: 'unknownRelationship',
} as const;

/** Union type of all valid connection type values. */
export type ConnectionTypeValue = (typeof ConnectionType)[keyof typeof ConnectionType];

// =============================================================================
// Rich Text Types
// =============================================================================

/**
 * Rich text content for a data model point.
 *
 * Corresponds to the `dgm:t` element inside `dgm:pt`, which contains
 * DrawingML text body content (a:bodyPr + a:p paragraphs).
 *
 * @see ECMA-376 Part 1, Section 21.4.2.26 (dgm:t)
 * @see ECMA-376 Part 1, Section 21.1.2.1 (a:bodyPr)
 */
export interface RichText {
  /**
   * Body properties controlling text layout within the shape.
   * Includes anchor, overflow, rotation, columns, margins, etc.
   */
  bodyProperties: TextBodyProperties;

  /** Ordered array of paragraphs. */
  paragraphs: Paragraph[];
}

/**
 * Text body properties (a:bodyPr).
 *
 * Controls how text is laid out within the shape bounds.
 *
 * @see ECMA-376 Part 1, Section 21.1.2.1.1 (a:bodyPr)
 */
export interface TextBodyProperties {
  /** Vertical anchor for text within the shape. */
  anchor?: 't' | 'ctr' | 'b' | 'just' | 'dist';

  /** Horizontal overflow behavior. */
  horzOverflow?: 'overflow' | 'clip';

  /** Vertical overflow behavior. */
  vertOverflow?: 'overflow' | 'clip' | 'ellipsis';

  /** Text wrapping mode. */
  wrap?: 'none' | 'square';

  /** Left inset (margin) in EMUs. */
  lIns?: number;

  /** Top inset (margin) in EMUs. */
  tIns?: number;

  /** Right inset (margin) in EMUs. */
  rIns?: number;

  /** Bottom inset (margin) in EMUs. */
  bIns?: number;

  /** Number of text columns. */
  numCol?: number;

  /** Spacing between columns in EMUs. */
  spcCol?: number;

  /** Rotation angle in 60,000ths of a degree. */
  rot?: number;

  /** Whether text is upright (not rotated with shape). */
  upright?: boolean;

  /** Auto-fit behavior for text sizing. */
  autoFit?: TextAutoFit;
}

/**
 * Text auto-fit configuration.
 *
 * Determines how text is sized to fit within the shape:
 * - none: No auto-fitting; text may overflow
 * - normalAutoFit: Shrink font size to fit (with optional min size)
 * - shapeAutoFit: Resize the shape to fit the text
 *
 * @see ECMA-376 Part 1, Section 21.1.2.1.2 (a:normAutofit)
 */
export type TextAutoFit =
  | { type: 'none' }
  | { type: 'normalAutoFit'; fontScale?: number; lineSpaceReduction?: number }
  | { type: 'shapeAutoFit' };

/**
 * A paragraph within rich text.
 *
 * Corresponds to the `a:p` element. Contains an array of text runs
 * and paragraph-level properties (alignment, spacing, etc.).
 *
 * @see ECMA-376 Part 1, Section 21.1.2.2.6 (a:p)
 */
export interface Paragraph {
  /** Ordered array of text runs within this paragraph. */
  runs: TextRun[];

  /** Paragraph-level properties. */
  properties?: ParagraphProperties;
}

/**
 * Paragraph properties (a:pPr).
 *
 * Controls paragraph-level formatting such as alignment, indentation,
 * and line spacing.
 *
 * @see ECMA-376 Part 1, Section 21.1.2.2.7 (a:pPr)
 */
export interface ParagraphProperties {
  /** Horizontal text alignment. */
  alignment?: 'l' | 'ctr' | 'r' | 'just' | 'justLow' | 'dist' | 'thaiDist';

  /** Indentation level (0-based). */
  level?: number;

  /** Left margin/indent in EMUs. */
  marL?: number;

  /** Right margin/indent in EMUs. */
  marR?: number;

  /** First line indent in EMUs (can be negative for hanging indent). */
  indent?: number;

  /** Line spacing. Value in hundredths of a percent (e.g., 100000 = 100%) or EMUs. */
  lineSpacing?: SpacingValue;

  /** Space before paragraph. */
  spaceBefore?: SpacingValue;

  /** Space after paragraph. */
  spaceAfter?: SpacingValue;

  /** Default text run properties for this paragraph. */
  defaultRunProperties?: TextRunProperties;

  /** Bullet/numbering properties. */
  bullet?: BulletProperties;
}

/**
 * Spacing value that can be either a percentage or an absolute value.
 *
 * @see ECMA-376 Part 1, Section 21.1.2.2.11 (a:spcPct / a:spcPts)
 */
export type SpacingValue = { type: 'percent'; value: number } | { type: 'points'; value: number };

/**
 * Bullet/numbering properties for a paragraph.
 *
 * @see ECMA-376 Part 1, Section 21.1.2.4 (Bullet Properties)
 */
export interface BulletProperties {
  /** Bullet type. */
  type: 'none' | 'char' | 'autoNum' | 'blip';

  /** Character used for char bullets. */
  char?: string;

  /** Auto-numbering type (e.g., 'arabicPeriod', 'romanUcPeriod'). */
  autoNumType?: string;

  /** Starting number for auto-numbering. */
  startAt?: number;

  /** Bullet size as percentage of text size. */
  sizePercent?: number;

  /** Bullet color override. */
  color?: DmlColorValue;

  /** Bullet font override. */
  font?: string;
}

/**
 * A single text run within a paragraph.
 *
 * Corresponds to the `a:r` element. Contains text content and
 * run-level formatting properties.
 *
 * @see ECMA-376 Part 1, Section 21.1.2.3.8 (a:r)
 */
export interface TextRun {
  /** The actual text content of this run. */
  text: string;

  /** Run-level formatting properties. */
  properties?: TextRunProperties;
}

/**
 * Text run properties (a:rPr).
 *
 * Controls character-level formatting such as font, size, color,
 * bold, italic, underline, etc.
 *
 * @see ECMA-376 Part 1, Section 21.1.2.3.9 (a:rPr)
 */
export interface TextRunProperties {
  /** Bold text. */
  bold?: boolean;

  /** Italic text. */
  italic?: boolean;

  /** Underline style. */
  underline?: TextUnderlineType;

  /** Strikethrough style. */
  strikethrough?: 'noStrike' | 'sngStrike' | 'dblStrike';

  /** Font family name (Latin script). */
  fontFamily?: string;

  /** East Asian font family name. */
  fontFamilyEastAsian?: string;

  /** Complex script font family name. */
  fontFamilyComplexScript?: string;

  /**
   * Font size in hundredths of a point.
   * For example, 1200 = 12pt.
   */
  fontSize?: number;

  /** Text color. */
  color?: DmlColorValue;

  /** Character spacing (tracking) in hundredths of a point. */
  spacing?: number;

  /** Baseline shift as a percentage (positive = superscript, negative = subscript). */
  baseline?: number;

  /** Whether text is capitalized. */
  cap?: 'none' | 'small' | 'all';

  /** Text language (BCP 47 language tag, e.g., "en-US"). */
  lang?: string;

  /** Whether the run is a hyperlink. */
  hyperlink?: HyperlinkInfo;
}

/**
 * Underline type values from DrawingML.
 *
 * @see ECMA-376 Part 1, Section 20.1.10.82 (ST_TextUnderlineType)
 */
export type TextUnderlineType =
  | 'none'
  | 'sng'
  | 'dbl'
  | 'heavy'
  | 'dotted'
  | 'dottedHeavy'
  | 'dash'
  | 'dashHeavy'
  | 'dashLong'
  | 'dashLongHeavy'
  | 'dotDash'
  | 'dotDashHeavy'
  | 'dotDotDash'
  | 'dotDotDashHeavy'
  | 'wavy'
  | 'wavyHeavy'
  | 'wavyDbl'
  | 'words';

/**
 * Hyperlink information for a text run.
 *
 * @see ECMA-376 Part 1, Section 21.1.2.3.5 (a:hlinkClick)
 */
export interface HyperlinkInfo {
  /** Target URL or relationship ID. */
  target: string;

  /** Whether to open in a new window. */
  newWindow?: boolean;

  /** Tooltip text shown on hover. */
  tooltip?: string;
}

// =============================================================================
// DrawingML Color Types (Dml prefix to avoid conflicts with style-types)
// =============================================================================

/**
 * A color value in full DrawingML.
 *
 * This is the comprehensive DrawingML color model supporting four color sources:
 * scheme (theme-relative), sRGB (hex), system (OS), and preset (named).
 * Each can have color transforms applied.
 *
 * Prefixed with `Dml` to distinguish from the simpler `SchemeColor` in
 * ooxml-style-types.ts, which represents style-label-specific scheme colors.
 *
 * @see ECMA-376 Part 1, Section 20.1.2.3 (Color Definitions)
 */
export type DmlColorValue = DmlSchemeColor | DmlSrgbColor | DmlSystemColor | DmlPresetColor;

/**
 * A scheme/theme color reference with optional transforms (DrawingML).
 *
 * References a color from the document's theme color scheme
 * (e.g., accent1, dk1, lt1). Transforms modify the base color.
 *
 * @see ECMA-376 Part 1, Section 20.1.2.3.29 (a:schemeClr)
 */
export interface DmlSchemeColor {
  /** Discriminant for the DmlColorValue union. */
  type: 'scheme';

  /**
   * Theme color name.
   * Standard names: dk1, dk2, lt1, lt2, accent1-accent6, hlink, folHlink
   */
  value: string;

  /** Color transforms applied in order. */
  transforms?: DmlColorTransform[];
}

/**
 * An sRGB hex color with optional transforms (DrawingML).
 *
 * @see ECMA-376 Part 1, Section 20.1.2.3.32 (a:srgbClr)
 */
export interface DmlSrgbColor {
  /** Discriminant for the DmlColorValue union. */
  type: 'srgb';

  /** 6-digit hex color string (without '#' prefix), e.g., "FF0000". */
  value: string;

  /** Color transforms applied in order. */
  transforms?: DmlColorTransform[];
}

/**
 * A system color reference with optional transforms (DrawingML).
 *
 * References an operating system color (e.g., windowText, window).
 *
 * @see ECMA-376 Part 1, Section 20.1.2.3.33 (a:sysClr)
 */
export interface DmlSystemColor {
  /** Discriminant for the DmlColorValue union. */
  type: 'system';

  /** System color name (e.g., 'windowText', 'window', 'btnFace'). */
  value: string;

  /** Last computed color value as 6-digit hex string. */
  lastColor?: string;

  /** Color transforms applied in order. */
  transforms?: DmlColorTransform[];
}

/**
 * A preset color name with optional transforms (DrawingML).
 *
 * Uses one of the 149 named colors from the DrawingML specification.
 *
 * @see ECMA-376 Part 1, Section 20.1.2.3.22 (a:prstClr)
 */
export interface DmlPresetColor {
  /** Discriminant for the DmlColorValue union. */
  type: 'preset';

  /** Preset color name (e.g., 'red', 'blue', 'white', 'black'). */
  value: string;

  /** Color transforms applied in order. */
  transforms?: DmlColorTransform[];
}

/**
 * A color transform operation (DrawingML).
 *
 * Transforms are applied sequentially to modify a base color.
 * Values are in thousandths of a percent (e.g., 50000 = 50%).
 *
 * @see ECMA-376 Part 1, Section 20.1.2.3 (Color Transform Children)
 */
export interface DmlColorTransform {
  /**
   * Transform type.
   *
   * Full list includes all 25 DrawingML color transform operations:
   * tint, shade, satMod, satOff, lumMod, lumOff, hueMod, hueOff,
   * alpha, alphaOff, alphaMod, comp, inv, gray,
   * red, redMod, redOff, green, greenMod, greenOff,
   * blue, blueMod, blueOff, gamma, invGamma
   *
   * @see ECMA-376 Part 1, Section 20.1.2.3 (Color Transform Elements)
   */
  type: DmlColorTransformType;

  /** Transform value, typically in thousandths of a percent. */
  value?: number;
}

/**
 * All possible DrawingML color transform types.
 *
 * This is the full set of 25 color transform operations from the DrawingML spec.
 * The `ColorTransformType` in ooxml-style-types.ts is a smaller subset (13 values)
 * used specifically for style label color definitions.
 *
 * @see ECMA-376 Part 1, Section 20.1.2.3 (Color Transform Elements)
 */
export type DmlColorTransformType =
  | 'tint'
  | 'shade'
  | 'satMod'
  | 'satOff'
  | 'lumMod'
  | 'lumOff'
  | 'hueMod'
  | 'hueOff'
  | 'alpha'
  | 'alphaOff'
  | 'alphaMod'
  | 'comp'
  | 'inv'
  | 'gray'
  | 'red'
  | 'redMod'
  | 'redOff'
  | 'green'
  | 'greenMod'
  | 'greenOff'
  | 'blue'
  | 'blueMod'
  | 'blueOff'
  | 'gamma'
  | 'invGamma';

// =============================================================================
// Shape Properties (Simplified)
// =============================================================================

/**
 * Shape properties for a data model point (dgm:spPr).
 *
 * These are per-point DrawingML shape property overrides. When present on a
 * data model point, they override the defaults from the layout definition.
 *
 * This is a simplified representation. Full DrawingML spPr is extremely
 * complex; we capture the properties relevant to Diagram.
 *
 * @see ECMA-376 Part 1, Section 20.1.2.2.35 (a:spPr)
 */
export interface DmlShapeProperties {
  /** 2D transform: position and size. */
  xfrm?: DmlShapeTransform;

  /** Preset geometry type (e.g., "rect", "roundRect", "ellipse"). */
  presetGeometry?: string;

  /** Geometry adjustment values (shape handles). */
  adjustValues?: Record<string, number>;

  /** Fill override. */
  fill?: DmlFillProperties;

  /** Line/stroke override. */
  line?: DmlLineProperties;

  /** Effect list override. */
  effectList?: DmlEffectProperties;
}

/**
 * 2D transform for shape position and size.
 *
 * @see ECMA-376 Part 1, Section 20.1.7.6 (a:xfrm)
 */
export interface DmlShapeTransform {
  /** Offset from parent origin. */
  offset?: { x: number; y: number };

  /** Extent (width and height) in EMUs. */
  extent?: { cx: number; cy: number };

  /** Rotation angle in 60,000ths of a degree. */
  rotation?: number;

  /** Whether the shape is flipped horizontally. */
  flipH?: boolean;

  /** Whether the shape is flipped vertically. */
  flipV?: boolean;
}

/**
 * Fill properties for shapes (DrawingML).
 *
 * @see ECMA-376 Part 1, Section 20.1.8 (Fill Properties)
 */
export type DmlFillProperties =
  | { type: 'none' }
  | { type: 'solid'; color: DmlColorValue }
  | { type: 'gradient'; stops: DmlGradientStop[]; linear?: { angle: number; scaled?: boolean } }
  | {
      type: 'pattern';
      preset: string;
      foregroundColor?: DmlColorValue;
      backgroundColor?: DmlColorValue;
    }
  | { type: 'blip'; embed?: string; stretch?: boolean };

/**
 * A single stop in a gradient fill.
 *
 * @see ECMA-376 Part 1, Section 20.1.8.36 (a:gs)
 */
export interface DmlGradientStop {
  /** Position of this stop (0-100000, where 100000 = 100%). */
  position: number;

  /** Color at this stop. */
  color: DmlColorValue;
}

/**
 * Line/stroke properties (DrawingML).
 *
 * @see ECMA-376 Part 1, Section 20.1.2.2.24 (a:ln)
 */
export interface DmlLineProperties {
  /** Line width in EMUs. */
  width?: number;

  /** Line cap type. */
  cap?: 'flat' | 'rnd' | 'sq';

  /** Line compound type. */
  compound?: 'sng' | 'dbl' | 'thickThin' | 'thinThick' | 'tri';

  /** Dash style. */
  dash?:
    | 'solid'
    | 'dot'
    | 'dash'
    | 'lgDash'
    | 'dashDot'
    | 'lgDashDot'
    | 'lgDashDotDot'
    | 'sysDash'
    | 'sysDot'
    | 'sysDashDot'
    | 'sysDashDotDot';

  /** Line fill (color). */
  fill?: DmlFillProperties;

  /** Line join type. */
  join?: 'round' | 'bevel' | 'miter';

  /** Head end arrow style. */
  headEnd?: DmlArrowStyle;

  /** Tail end arrow style. */
  tailEnd?: DmlArrowStyle;
}

/**
 * Arrow style properties for line ends (DrawingML).
 *
 * @see ECMA-376 Part 1, Section 20.1.8.4 (a:headEnd / a:tailEnd)
 */
export interface DmlArrowStyle {
  /** Arrow type. */
  type?: 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow';

  /** Arrow width. */
  width?: 'sm' | 'med' | 'lg';

  /** Arrow length. */
  length?: 'sm' | 'med' | 'lg';
}

/**
 * Effect properties for shapes (DrawingML).
 *
 * @see ECMA-376 Part 1, Section 20.1.8 (Effect Properties)
 */
export interface DmlEffectProperties {
  /** Outer shadow. */
  outerShadow?: {
    blurRadius?: number;
    distance?: number;
    direction?: number;
    color?: DmlColorValue;
    alignment?: string;
    rotateWithShape?: boolean;
  };

  /** Inner shadow. */
  innerShadow?: {
    blurRadius?: number;
    distance?: number;
    direction?: number;
    color?: DmlColorValue;
  };

  /** Glow effect. */
  glow?: {
    radius?: number;
    color?: DmlColorValue;
  };

  /** Soft edge effect. */
  softEdge?: {
    radius?: number;
  };

  /** Reflection effect. */
  reflection?: {
    blurRadius?: number;
    startOpacity?: number;
    startPosition?: number;
    endOpacity?: number;
    endPosition?: number;
    distance?: number;
    direction?: number;
    fadeDirection?: number;
    alignment?: string;
    rotateWithShape?: boolean;
  };
}

// =============================================================================
// Property Set (dgm:prSet)
// =============================================================================

/**
 * Property set for a data model point (dgm:prSet).
 *
 * Contains per-point metadata that controls how the point is treated
 * by the layout engine and renderers.
 *
 * @see ECMA-376 Part 1, Section 21.4.2.24 (dgm:prSet)
 */
export interface PointPropertySet {
  /**
   * Whether this point is a placeholder.
   * When true, the point renders as a placeholder shape.
   */
  phldr?: boolean;

  /**
   * Placeholder text override.
   * Displayed when the point is a placeholder.
   */
  phldrT?: string;

  /**
   * Custom text flag.
   * When true, the point's text has been customized by the user.
   */
  custT?: boolean;

  /** Custom angle for the point (in degrees). */
  custAng?: number;

  /** Whether the point is flipped vertically. */
  custFlipVert?: boolean;

  /** Whether the point is flipped horizontally. */
  custFlipHor?: boolean;

  /** Custom size X (width) as a percentage. */
  custSzX?: number;

  /** Custom size Y (height) as a percentage. */
  custSzY?: number;

  /** Custom radial scale radius as a percentage. */
  custRadScaleRad?: number;

  /** Custom radial scale increment as a percentage. */
  custRadScaleInc?: number;

  /** Custom linear factor X as a percentage. */
  custLinFactX?: number;

  /** Custom linear factor Y as a percentage. */
  custLinFactY?: number;

  /** Custom linear factor neighbor X as a percentage. */
  custLinFactNeighborX?: number;

  /** Custom linear factor neighbor Y as a percentage. */
  custLinFactNeighborY?: number;

  /** Custom scale X percentage (100 = 100%). */
  custScaleX?: number;

  /** Custom scale Y percentage (100 = 100%). */
  custScaleY?: number;

  /**
   * Associated presentation point ID.
   * Links this data point to its presentation mapping.
   */
  presAssocID?: ModelId;

  /**
   * Presentation name.
   * The name of the layout node that this point maps to.
   */
  presName?: string;

  /**
   * Presentation style label.
   * The style label used for this point's rendering.
   */
  presStyleLbl?: string;

  /**
   * Presentation style index.
   * Index into the color cycling within the style label.
   */
  presStyleIdx?: number;

  /**
   * Presentation style count.
   * Total number of items in the style label's color cycle.
   */
  presStyleCnt?: number;

  /**
   * Layout type ID (URI).
   * Identifies which layout definition this point was created for.
   */
  loTypeId?: string;

  /**
   * Layout category ID.
   * The category of the layout definition.
   */
  loCatId?: string;

  /**
   * Quick style type ID (URI).
   * Identifies the quick style applied to this point.
   */
  qsTypeId?: string;

  /**
   * Quick style category ID.
   * The category of the quick style.
   */
  qsCatId?: string;

  /**
   * Color transform type ID (URI).
   * Identifies the color definition applied to this point.
   */
  csTypeId?: string;

  /**
   * Color transform category ID.
   * The category of the color definition.
   */
  csCatId?: string;

  /** Whether coherent 3D is disabled. */
  coherent3DOff?: boolean;

  /** Index signature for additional/unknown properties. */
  [key: string]: unknown;
}

// =============================================================================
// Data Model Point
// =============================================================================

/**
 * A single point in the data model (dgm:pt).
 *
 * Points represent the nodes/items in a Diagram diagram. Each point has:
 * - A unique modelId
 * - A type indicating its role (doc, node, assistant, transition, etc.)
 * - Optional rich text content
 * - Optional shape property overrides
 * - Optional property set metadata
 *
 * @see ECMA-376 Part 1, Section 21.4.2.22 (dgm:pt)
 */
export interface DataModelPoint {
  /** Unique identifier for this point within the data model. */
  modelId: ModelId;

  /**
   * Type of this point.
   * Defaults to 'node' if not specified in the XML.
   */
  type: PointTypeValue;

  /**
   * Rich text content displayed in this point's shape.
   * May be undefined for structural points (doc, transitions).
   */
  text?: RichText;

  /**
   * Property set with per-point metadata.
   * Controls placeholder behavior, presentation mapping, style overrides, etc.
   */
  properties?: PointPropertySet;

  /**
   * Shape property overrides (dgm:spPr).
   * When present, these override the shape properties from the layout definition.
   */
  shapeProperties?: DmlShapeProperties;

  /**
   * Connection ID used for transitions.
   * For parTrans and sibTrans points, this links to the connection they represent.
   */
  cxnId?: ModelId;
}

// =============================================================================
// Data Model Connection
// =============================================================================

/**
 * A connection between two points in the data model (dgm:cxn).
 *
 * Connections define relationships:
 * - parOf: Parent-child hierarchy (the data tree structure)
 * - presOf: Data point -> presentation node mapping
 * - presParOf: Presentation node hierarchy
 *
 * @see ECMA-376 Part 1, Section 21.4.2.7 (dgm:cxn)
 */
export interface DataModelConnection {
  /** Unique identifier for this connection. */
  modelId: ModelId;

  /** Type of relationship this connection represents. */
  type: ConnectionTypeValue;

  /** Source point ID (the "from" side of the relationship). */
  srcId: ModelId;

  /** Destination point ID (the "to" side of the relationship). */
  destId: ModelId;

  /**
   * Source ordering index.
   * Determines the order of outgoing connections from the source point.
   */
  srcOrd: number;

  /**
   * Destination ordering index.
   * Determines the order of incoming connections at the destination point.
   */
  destOrd: number;

  /**
   * Parent transition point ID.
   * For parOf connections, this optionally references the transition point
   * that sits between parent and child.
   */
  parTransId?: ModelId;

  /**
   * Sibling transition point ID.
   * For parOf connections, this optionally references the sibling transition
   * point that sits between this child and the next sibling.
   */
  sibTransId?: ModelId;

  /**
   * Presentation ID.
   * For presOf connections, identifies the presentation element.
   */
  presId?: string;
}

// =============================================================================
// Background & Whole Document Formatting
// =============================================================================

/**
 * Background formatting for the entire diagram (dgm:bg).
 *
 * @see ECMA-376 Part 1, Section 21.4.2.1 (dgm:bg)
 */
export interface DiagramBackground {
  /** Fill properties for the diagram background. */
  fill?: DmlFillProperties;

  /** Effect properties for the diagram background. */
  effectList?: DmlEffectProperties;
}

/**
 * Whole-document formatting applied to all shapes in the diagram (dgm:whole).
 *
 * @see ECMA-376 Part 1, Section 21.4.2.28 (dgm:whole)
 */
export interface DiagramWhole {
  /** Line/stroke properties applied to all shapes. */
  line?: DmlLineProperties;

  /** Effect properties applied to all shapes. */
  effectList?: DmlEffectProperties;
}

// =============================================================================
// Data Model (Top-Level)
// =============================================================================

/**
 * Complete Diagram data model (dgm:dataModel).
 *
 * The top-level container for all data in a Diagram diagram's data#.xml file.
 * Contains the point list, connection list, and optional background/whole formatting.
 *
 * The data model defines the LOGICAL content of the diagram:
 * - Points are the nodes (content items)
 * - Connections define the tree structure and presentation mappings
 * - The layout engine reads this data model and produces visual output
 *
 * @see ECMA-376 Part 1, Section 21.4.2.19 (dgm:dataModel)
 */
export interface DataModel {
  /**
   * All points in the data model.
   * Includes doc point, content nodes, assistant nodes, and transition nodes.
   */
  points: DataModelPoint[];

  /**
   * All connections between points.
   * Defines parent-child hierarchy, presentation mappings, etc.
   */
  connections: DataModelConnection[];

  /**
   * Optional background formatting for the entire diagram.
   */
  background?: DiagramBackground;

  /**
   * Optional whole-document formatting applied to all shapes.
   */
  whole?: DiagramWhole;
}
