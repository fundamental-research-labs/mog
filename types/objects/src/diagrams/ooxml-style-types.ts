/**
 * OOXML Diagram Style Label Type Definitions
 *
 * Defines the type system for Diagram's 3-file style resolution mechanism:
 *
 * 1. **Layout Definition** (`layout#.xml`) assigns `styleLbl` attributes to layout nodes
 * 2. **Colors Definition** (`colors#.xml`) maps style label names to color lists
 * 3. **Style Definition** (`quickStyle#.xml`) maps style label names to shape styles
 *
 * When rendering a Diagram shape:
 * - The layout node's `styleLbl` attribute (e.g., "node1", "sibTrans2D1") is looked up
 *   in both the colors definition and the style definition
 * - The colors definition provides fill, line, effect, and text colors
 * - The style definition provides shape style references (line, fill, effect, font indices)
 * - Together they fully resolve the visual appearance of every shape
 *
 * @see ECMA-376 Section 21.4.7 - Colors Definition
 * @see ECMA-376 Section 21.4.8 - Style Definition
 * @see https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2007/dd439445(v=office.12)
 */

import type { Scene3D, Shape3D } from '../drawing/three-d';

// =============================================================================
// Style Label Names
// =============================================================================

/**
 * All 60+ known OOXML style label names.
 *
 * Style labels are assigned to layout nodes in layout definitions and are used
 * to look up colors and styles from the colors/style definition files.
 *
 * The naming convention follows OOXML patterns:
 * - `node0-4`: Primary content nodes (0 = default/base, 1-4 = accent levels)
 * - `asst0-4`: Assistant nodes (org charts)
 * - `fgAcc0-4`: Foreground accent shapes
 * - `bgAcc1`: Background accent shapes
 * - `sibTrans*`: Sibling transition connectors (between same-level nodes)
 * - `parChTrans*`: Parent-child transition connectors
 * - `bgShp/fgShp`: Background/foreground decorative shapes
 * - `*ImgPlace*`: Image placeholder shapes
 * - `*FollowNode*`: Shapes that inherit color from their associated node
 *
 * @see ECMA-376 Section 21.4.7.3 - ST_StyleLblName
 */
export type OoxmlStyleLabelName =
  // ---------------------------------------------------------------------------
  // Node labels (primary content shapes)
  // node0 is the default/base style, node1-4 provide accent variations
  // ---------------------------------------------------------------------------
  | 'node0'
  | 'node1'
  | 'node2'
  | 'node3'
  | 'node4'

  // ---------------------------------------------------------------------------
  // Assistant labels (used in org chart layouts for assistant nodes)
  // asst0 is the default/base, asst1-4 provide accent variations
  // ---------------------------------------------------------------------------
  | 'asst0'
  | 'asst1'
  | 'asst2'
  | 'asst3'
  | 'asst4'

  // ---------------------------------------------------------------------------
  // Foreground accent labels (accent shapes drawn on top)
  // fgAcc0 is the default, fgAcc1-4 provide accent variations
  // ---------------------------------------------------------------------------
  | 'fgAcc0'
  | 'fgAcc1'
  | 'fgAcc2'
  | 'fgAcc3'
  | 'fgAcc4'

  // ---------------------------------------------------------------------------
  // Background accent labels
  // ---------------------------------------------------------------------------
  | 'bgAcc1'

  // ---------------------------------------------------------------------------
  // Connector foreground accent
  // ---------------------------------------------------------------------------
  | 'conFgAcc1'

  // ---------------------------------------------------------------------------
  // Aligned labels (shapes that are aligned/positioned relative to nodes)
  // ---------------------------------------------------------------------------
  | 'alignNode1'
  | 'vennNode1'
  | 'lnNode1'

  // ---------------------------------------------------------------------------
  // Aligned accent labels
  // alignAcc1: standard aligned accent
  // trAlignAcc1: transparent aligned accent
  // solidAlignAcc1: solid (opaque) aligned accent
  // ---------------------------------------------------------------------------
  | 'alignAcc1'
  | 'trAlignAcc1'
  | 'solidAlignAcc1'

  // ---------------------------------------------------------------------------
  // Solid accent labels (fully opaque accent shapes)
  // ---------------------------------------------------------------------------
  | 'solidFgAcc1'
  | 'solidBgAcc1'

  // ---------------------------------------------------------------------------
  // Follow-node labels (shapes that inherit color from their parent node)
  // ---------------------------------------------------------------------------
  | 'alignAccFollowNode1'
  | 'fgAccFollowNode1'
  | 'bgAccFollowNode1'

  // ---------------------------------------------------------------------------
  // Image placeholder labels (for picture-type layouts)
  // ---------------------------------------------------------------------------
  | 'fgImgPlace1'
  | 'alignImgPlace1'
  | 'bgImgPlace1'

  // ---------------------------------------------------------------------------
  // Sibling transition labels (connectors between same-level nodes)
  // sibTrans2D1: 2D sibling transition (e.g., arrow shape)
  // fgSibTrans2D1: foreground sibling transition
  // bgSibTrans2D1: background sibling transition
  // sibTrans1D1: 1D sibling transition (e.g., line connector)
  // callout: callout/annotation shape
  // ---------------------------------------------------------------------------
  | 'sibTrans2D1'
  | 'fgSibTrans2D1'
  | 'bgSibTrans2D1'
  | 'sibTrans1D1'
  | 'callout'

  // ---------------------------------------------------------------------------
  // Parent-child transition labels (connectors between parent and child nodes)
  // 2D transitions are shaped connectors (e.g., arrow/chevron between levels)
  // 1D transitions are line connectors
  // Variants 1-4 allow different styles at different hierarchy depths
  // ---------------------------------------------------------------------------
  | 'parChTrans2D1'
  | 'parChTrans2D2'
  | 'parChTrans2D3'
  | 'parChTrans2D4'
  | 'parChTrans1D1'
  | 'parChTrans1D2'
  | 'parChTrans1D3'
  | 'parChTrans1D4'

  // ---------------------------------------------------------------------------
  // Background shape labels (decorative shapes behind content)
  // bgShp: standard background shape
  // dkBgShp: dark background shape
  // trBgShp: transparent background shape
  // ---------------------------------------------------------------------------
  | 'bgShp'
  | 'dkBgShp'
  | 'trBgShp'

  // ---------------------------------------------------------------------------
  // Foreground shape labels (decorative shapes in front of content)
  // ---------------------------------------------------------------------------
  | 'fgShp'

  // ---------------------------------------------------------------------------
  // Reversed text label (text drawn with inverted/contrasting colors)
  // ---------------------------------------------------------------------------
  | 'revTx';

/**
 * Array of all known style label names for iteration and validation.
 *
 * @see OoxmlStyleLabelName for the union type
 */
export const OOXML_STYLE_LABEL_NAMES: readonly OoxmlStyleLabelName[] = [
  // Node labels
  'node0',
  'node1',
  'node2',
  'node3',
  'node4',

  // Assistant labels
  'asst0',
  'asst1',
  'asst2',
  'asst3',
  'asst4',

  // Foreground accent labels
  'fgAcc0',
  'fgAcc1',
  'fgAcc2',
  'fgAcc3',
  'fgAcc4',

  // Background accent labels
  'bgAcc1',

  // Connector foreground accent
  'conFgAcc1',

  // Aligned labels
  'alignNode1',
  'vennNode1',
  'lnNode1',

  // Aligned accent labels
  'alignAcc1',
  'trAlignAcc1',
  'solidAlignAcc1',

  // Solid accent labels
  'solidFgAcc1',
  'solidBgAcc1',

  // Follow-node labels
  'alignAccFollowNode1',
  'fgAccFollowNode1',
  'bgAccFollowNode1',

  // Image placeholder labels
  'fgImgPlace1',
  'alignImgPlace1',
  'bgImgPlace1',

  // Sibling transition labels
  'sibTrans2D1',
  'fgSibTrans2D1',
  'bgSibTrans2D1',
  'sibTrans1D1',
  'callout',

  // Parent-child transition labels
  'parChTrans2D1',
  'parChTrans2D2',
  'parChTrans2D3',
  'parChTrans2D4',
  'parChTrans1D1',
  'parChTrans1D2',
  'parChTrans1D3',
  'parChTrans1D4',

  // Background shape labels
  'bgShp',
  'dkBgShp',
  'trBgShp',

  // Foreground shape labels
  'fgShp',

  // Reversed text
  'revTx',
] as const;

// =============================================================================
// Color Transform Types
// =============================================================================

/**
 * OOXML color transform type.
 *
 * Color transforms modify a base scheme color to produce derived colors.
 * They are applied in sequence to the base color value.
 *
 * @see ECMA-376 Section 20.1.2.3 - Color Transforms
 */
export type ColorTransformType =
  /** Luminance modulation - multiply luminance by val/100000 */
  | 'lumMod'
  /** Luminance offset - add val/100000 to luminance */
  | 'lumOff'
  /** Saturation modulation - multiply saturation by val/100000 */
  | 'satMod'
  /** Saturation offset - add val/100000 to saturation */
  | 'satOff'
  /** Tint - blend toward white by val/100000 */
  | 'tint'
  /** Shade - blend toward black by val/100000 */
  | 'shade'
  /** Alpha/transparency - set alpha to val/100000 */
  | 'alpha'
  /** Hue modulation - multiply hue by val/100000 */
  | 'hueMod'
  /** Hue offset - add val/100000 to hue angle */
  | 'hueOff'
  /** Complement - use the complementary (opposite) color */
  | 'comp'
  /** Inverse - invert the color */
  | 'inv'
  /** Grayscale - convert to grayscale */
  | 'gray';

/**
 * A single color transform operation.
 *
 * Transforms are applied sequentially to a base color. The `val` field
 * uses OOXML's percentage scale where 100000 = 100%.
 *
 * @example
 * // Make a color 60% as bright:
 * { type: 'lumMod', val: 60000 }
 *
 * @example
 * // Add 40% luminance offset:
 * { type: 'lumOff', val: 40000 }
 *
 * @example
 * // Complement has no value:
 * { type: 'comp' }
 *
 * @see ECMA-376 Section 20.1.2.3 - Color Transforms
 */
export interface ColorTransform {
  /** The transform operation type */
  type: ColorTransformType;

  /**
   * Transform value as OOXML percentage (0-100000 where 100000 = 100%).
   *
   * Not all transforms require a value:
   * - `comp`, `inv`, `gray` have no value (they are boolean operations)
   * - All others require a percentage value
   */
  val?: number;
}

// =============================================================================
// Scheme Color
// =============================================================================

/**
 * OOXML scheme color reference.
 *
 * Scheme colors are symbolic references to the document's theme color palette.
 * They are resolved at render time against the active theme, enabling Diagram
 * diagrams to automatically adapt when the document theme changes.
 *
 * @see ECMA-376 Section 20.1.2.3.29 - schemeClr
 */
export interface SchemeColor {
  /**
   * Scheme color name referencing a theme color slot.
   *
   * Standard values:
   * - `'dk1'`, `'dk2'` - Dark colors (typically black/dark gray)
   * - `'lt1'`, `'lt2'` - Light colors (typically white/light gray)
   * - `'accent1'` through `'accent6'` - Theme accent colors
   * - `'hlink'` - Hyperlink color
   * - `'folHlink'` - Followed hyperlink color
   * - `'tx1'`, `'tx2'` - Text colors
   * - `'bg1'`, `'bg2'` - Background colors
   */
  val: string;

  /**
   * Optional color transforms applied sequentially to the base scheme color.
   *
   * @example
   * // accent1 at 80% luminance with 20% luminance offset:
   * { val: 'accent1', transforms: [{ type: 'lumMod', val: 80000 }, { type: 'lumOff', val: 20000 }] }
   */
  transforms?: ColorTransform[];
}

// =============================================================================
// Color List
// =============================================================================

/**
 * A list of scheme colors with a distribution method.
 *
 * Used in colors definitions to specify how colors are assigned
 * to shapes that share the same style label.
 *
 * @see ECMA-376 Section 21.4.7.5 - fillClrLst, linClrLst, etc.
 */
export interface ColorList {
  /**
   * How colors from this list are distributed across shapes:
   *
   * - `'repeat'`: Cycle through the color list. Shape N uses color[N % length].
   *   Most common method; ensures each shape gets a color even if there are more
   *   shapes than colors.
   *
   * - `'span'`: Interpolate across the list. Colors are distributed evenly
   *   across all shapes, creating a gradient-like effect.
   */
  method: 'repeat' | 'span';

  /**
   * The ordered list of scheme colors.
   *
   * For `method='repeat'`, shapes cycle through this list.
   * For `method='span'`, colors are interpolated across shapes.
   */
  colors: SchemeColor[];
}

// =============================================================================
// Style Label Colors (from colors#.xml)
// =============================================================================

/**
 * Color definitions for a single style label.
 *
 * Each style label in a colors definition maps to six color lists that
 * control different aspects of shape rendering:
 *
 * - Fill colors: Shape background
 * - Line colors: Shape border/outline
 * - Effect colors: Visual effects (shadow, glow)
 * - Text line colors: Text outline
 * - Text fill colors: Text foreground
 * - Text effect colors: Text visual effects
 *
 * @see ECMA-376 Section 21.4.7.3 - styleLbl (Colors Definition)
 */
export interface StyleLabelColors {
  /**
   * Style label name (e.g., 'node1', 'sibTrans2D1').
   * Matches the `styleLbl` attribute on layout nodes.
   */
  name: string;

  /** Fill color list for shape backgrounds */
  fillClrLst: ColorList;

  /** Line/stroke color list for shape outlines */
  linClrLst: ColorList;

  /** Effect color list for visual effects (shadow, glow, etc.) */
  effectClrLst: ColorList;

  /** Text line/outline color list */
  txLinClrLst: ColorList;

  /** Text fill color list */
  txFillClrLst: ColorList;

  /** Text effect color list */
  txEffectClrLst: ColorList;
}

// =============================================================================
// Colors Definition (colors#.xml)
// =============================================================================

/**
 * OOXML Colors Definition.
 *
 * Represents a parsed `colors#.xml` file from a Diagram diagram.
 * Each Diagram has exactly one colors definition that controls
 * how colors are assigned to shapes based on their style labels.
 *
 * The colors definition is selected by the user via the "Change Colors"
 * gallery in the Diagram Design tab.
 *
 * @see ECMA-376 Section 21.4.7 - Colors Definition
 */
export interface ColorsDef {
  /**
   * Unique identifier for this colors definition.
   *
   * @example 'urn:microsoft.com/office/officeart/2005/8/colors/accent1_2'
   */
  uniqueId: string;

  /** Display title shown in the Change Colors gallery */
  title: string;

  /** Description/tooltip text */
  desc: string;

  /**
   * Categories this colors definition belongs to.
   * Used for grouping in the gallery UI.
   *
   * @example [{ type: 'mainScheme', pri: 10100 }]
   */
  categories: Array<{ type: string; pri: number }>;

  /**
   * Map of style label names to their color definitions.
   *
   * When rendering a shape, its layout node's `styleLbl` attribute
   * is used as the key to look up colors from this map.
   */
  styleLabelMap: Map<string, StyleLabelColors>;
}

// =============================================================================
// 3D Types (imported from shared drawing module)
// =============================================================================

// Scene3D and Shape3D are defined in the shared drawing/three-d module.
// Diagram extends Shape3D with SchemeColor for extrusion/contour colors.
export type { Scene3D } from '../drawing/three-d';

/**
 * Diagram-specific 3D shape properties.
 *
 * Extends the shared Shape3D interface with Diagram's SchemeColor
 * for extrusion and contour colors (which reference theme color slots).
 *
 * @see ECMA-376 Section 20.1.5.12 - sp3d
 */
export type ShapeProperties3D = Omit<Shape3D, 'extrusionClr' | 'contourClr'> & {
  /** Extrusion color (the color of the 3D sides when extruded) */
  extrusionClr?: SchemeColor;
  /** Contour color (the color of the outline on 3D shapes) */
  contourClr?: SchemeColor;
};

// =============================================================================
// Text Properties
// =============================================================================

/**
 * Text properties for style label styling.
 *
 * Defines text formatting that can be applied through style definitions,
 * including font size, spacing, and 3D text effects.
 *
 * @see ECMA-376 Section 21.1.2.2.27 - txPr
 */
export interface TextProperties {
  /**
   * Default text run properties including font size and style.
   */
  defRPr?: {
    /** Font size in hundredths of a point (e.g., 1200 = 12pt) */
    sz?: number;
    /** Bold flag */
    b?: boolean;
    /** Italic flag */
    i?: boolean;
    /** Font family */
    latin?: string;
  };

  /**
   * Body properties including text wrapping and anchoring.
   */
  bodyPr?: {
    /** Vertical text anchor: 't' (top), 'ctr' (center), 'b' (bottom) */
    anchor?: string;
    /** Horizontal overflow: 'clip' or 'overflow' */
    horzOverflow?: string;
    /** Vertical overflow: 'clip' or 'overflow' */
    vertOverflow?: string;
  };
}

// =============================================================================
// Style Reference
// =============================================================================

/**
 * Style reference set for a shape.
 *
 * References the document theme's format scheme to resolve line, fill,
 * effect, and font styles. Each reference has an index into the theme's
 * style arrays and an optional scheme color override.
 *
 * @see ECMA-376 Section 21.4.8.3 - style
 */
export interface StyleReference {
  /**
   * Line style reference.
   * idx references a:fmtScheme/a:lnStyleLst entry (0-based).
   * idx=0 means no line; idx=1,2,3 reference subtle/moderate/intense line styles.
   */
  lnRef: {
    /** Index into the theme's line style list (0 = none) */
    idx: number;
    /** Optional scheme color override for the line */
    schemeClr?: SchemeColor;
  };

  /**
   * Fill style reference.
   * idx references a:fmtScheme/a:fillStyleLst entry (0-based).
   * idx=0 means no fill; idx=1,2,3 reference subtle/moderate/intense fills.
   * idx=1001,1002,1003 reference background fill styles.
   */
  fillRef: {
    /** Index into the theme's fill style list (0 = none) */
    idx: number;
    /** Optional scheme color override for the fill */
    schemeClr?: SchemeColor;
  };

  /**
   * Effect style reference.
   * idx references a:fmtScheme/a:effectStyleLst entry (0-based).
   * idx=0 means no effect; idx=1,2,3 reference subtle/moderate/intense effects.
   */
  effectRef: {
    /** Index into the theme's effect style list (0 = none) */
    idx: number;
    /** Optional scheme color override for the effect */
    schemeClr?: SchemeColor;
  };

  /**
   * Font style reference.
   * idx is a string ('minor', 'major', or 'none') referencing theme fonts.
   * - 'minor': Body font (typically Calibri)
   * - 'major': Heading font (typically Calibri Light)
   * - 'none': No font override
   */
  fontRef: {
    /** Font theme reference: 'minor' (body), 'major' (heading), or 'none' */
    idx: string;
    /** Optional scheme color override for the font color */
    schemeClr?: SchemeColor;
  };
}

// =============================================================================
// Style Label Style (from quickStyle#.xml)
// =============================================================================

/**
 * Style definitions for a single style label.
 *
 * Each style label in a style definition maps to shape style properties
 * including theme style references, optional 3D properties, and text formatting.
 *
 * @see ECMA-376 Section 21.4.8.2 - styleLbl (Style Definition)
 */
export interface StyleLabelStyle {
  /**
   * Style label name (e.g., 'node1', 'sibTrans2D1').
   * Matches the `styleLbl` attribute on layout nodes.
   */
  name: string;

  /**
   * Per-label 3D scene override.
   * If present, overrides the style definition's top-level scene3d.
   */
  scene3d?: Scene3D;

  /**
   * Per-label 3D shape properties.
   * Defines bevel, extrusion, and contour effects for this label's shapes.
   */
  sp3d?: ShapeProperties3D;

  /**
   * Per-label text property overrides.
   * Defines text formatting specific to this style label.
   */
  txPr?: TextProperties;

  /**
   * Shape style references into the document theme.
   * Provides line, fill, effect, and font references that are resolved
   * against the theme's format scheme at render time.
   */
  style: StyleReference;
}

// =============================================================================
// Style Definition (quickStyle#.xml)
// =============================================================================

/**
 * OOXML Style Definition.
 *
 * Represents a parsed `quickStyle#.xml` file from a Diagram diagram.
 * Each Diagram has exactly one style definition that controls the
 * shape styles (line weight, fill intensity, effects, fonts) based
 * on style labels.
 *
 * The style definition is selected by the user via the "Diagram Styles"
 * gallery in the Diagram Design tab.
 *
 * Style definitions work in conjunction with colors definitions:
 * - Colors definition provides the actual colors (from theme scheme colors)
 * - Style definition provides the style intensity (subtle/moderate/intense)
 *   via theme format scheme indices
 *
 * @see ECMA-376 Section 21.4.8 - Style Definition
 */
export interface StyleDef {
  /**
   * Unique identifier for this style definition.
   *
   * @example 'urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1'
   */
  uniqueId: string;

  /** Display title shown in the Diagram Styles gallery */
  title: string;

  /** Description/tooltip text */
  desc: string;

  /**
   * Categories this style definition belongs to.
   * Used for grouping in the gallery UI.
   *
   * @example [{ type: 'simple', pri: 10100 }]
   */
  categories: Array<{ type: string; pri: number }>;

  /**
   * Top-level 3D scene settings for this style.
   * Applies to all shapes unless overridden at the style label level.
   * Only present for 3D quick styles.
   */
  scene3d?: Scene3D;

  /**
   * Map of style label names to their style definitions.
   *
   * When rendering a shape, its layout node's `styleLbl` attribute
   * is used as the key to look up style properties from this map.
   */
  styleLabelMap: Map<string, StyleLabelStyle>;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * A fully resolved style for a single shape, combining colors and style definitions.
 *
 * This is the output of the style label resolution process. It contains
 * all the information needed to render a shape's visual appearance.
 */
export interface ResolvedShapeStyle {
  /** The style label name that was resolved */
  styleLbl: string;

  // --- Colors (from ColorsDef) ---

  /** Resolved fill color (hex or CSS color) */
  fillColor: string;

  /** Resolved line/stroke color */
  lineColor: string;

  /** Resolved effect color */
  effectColor: string;

  /** Resolved text fill color */
  textFillColor: string;

  /** Resolved text line color */
  textLineColor: string;

  /** Resolved text effect color */
  textEffectColor: string;

  // --- Style (from StyleDef) ---

  /** Resolved style reference */
  style: StyleReference;

  /** Optional 3D scene settings */
  scene3d?: Scene3D;

  /** Optional 3D shape properties */
  sp3d?: ShapeProperties3D;

  /** Optional text property overrides */
  txPr?: TextProperties;
}
