/**
 * Floating Objects Contracts
 *
 * Type definitions for pictures, text boxes, shapes, and other floating objects
 * that overlay the cell grid. These objects anchor to cells but render on a
 * separate layer (z-index 5 per renderer architecture).
 *
 * Architecture Notes:
 * - Objects render on overlay layer (z-index 5) per renderer docs
 * - Requires object-interaction-machine for selection/drag/resize states
 * - Coordinator manages cross-coordination with selection-machine
 * - Hit testing determines which object (if any) is under cursor
 *
 * Cell Identity Model:
 * - CellAnchor uses CellId references, NOT row/col positions
 * - This ensures anchors survive concurrent row/col insert/delete operations
 * - Position resolution happens at render time via CellPositionLookup
 * - Same pattern as IdentityFormula refs for formulas
 */

import type { CellIdRange } from '@mog/types-core/cell-identity';
import type { CellFormat, SheetId } from '@mog/types-core/core';
import type { Equation, EquationStyle } from '../equation/types';
import type { DrawingObject } from '../ink/types';
import type { Diagram } from '../diagrams/types';
import type { OuterShadowEffect } from '../text-effects/effects';
import type { TextEffectConfig } from '../text-effects/types';
import type { CanvasObjectGroup } from './canvas-object';
import type { FloatingObjectBase, ObjectPosition, ShapeType } from './floating-object-types';

// Re-export shared floating-object base types so existing consumers of
// `floating-objects.ts` continue to work unchanged. The canonical
// definitions live in `./floating-object-types` to break import cycles
// with subtype-specific modules (`ink/types.ts`, `diagram/types.ts`).
export type {
  CellAnchor,
  FloatingObjectBase,
  FloatingObjectKind,
  ObjectAnchorType,
  ObjectPosition,
  ShapeType,
} from './floating-object-types';

// ============================================================================
// Picture Object
// ============================================================================

/**
 * Image crop settings.
 * Values are percentages (0-100) of original dimension to crop from each side.
 */
export interface PictureCrop {
  /** Percentage to crop from top (0-100) */
  top: number;
  /** Percentage to crop from right (0-100) */
  right: number;
  /** Percentage to crop from bottom (0-100) */
  bottom: number;
  /** Percentage to crop from left (0-100) */
  left: number;
}

/**
 * Image adjustment settings.
 * Values mirror Excel's picture format options.
 */
export interface PictureAdjustments {
  /** Brightness adjustment (-100 to 100, 0 = normal) */
  brightness?: number;
  /** Contrast adjustment (-100 to 100, 0 = normal) */
  contrast?: number;
  /** Transparency (0 = opaque, 100 = fully transparent) */
  transparency?: number;
}

/**
 * Border style for floating objects.
 */
export interface ObjectBorder {
  /** Border line style */
  style: 'none' | 'solid' | 'dashed' | 'dotted';
  /** Border color (CSS color string) */
  color: string;
  /** Border width in pixels */
  width: number;
}

/** Image color transform type. */
export type ImageColorType = 'automatic' | 'grayScale' | 'blackAndWhite' | 'watermark';

/**
 * Picture/image floating object.
 * Supports images from various sources with cropping and adjustments.
 */
export interface PictureObject extends FloatingObjectBase {
  type: 'picture';
  /** Image source (data URL, blob URL, or external URL) */
  src: string;
  /** Original image width in pixels (before scaling) */
  originalWidth: number;
  /** Original image height in pixels (before scaling) */
  originalHeight: number;
  /** Crop settings (percentage-based) */
  crop?: PictureCrop;
  /** Image adjustments (brightness, contrast, transparency) */
  adjustments?: PictureAdjustments;
  /** Border around the image */
  border?: ObjectBorder;
  /** Image color transform type */
  colorType?: ImageColorType;
}

// ============================================================================
// Text Box Object
// ============================================================================

/**
 * Fill type for shapes, text boxes, and connectors.
 * Matches the Rust `FillType` enum in `domain-types`.
 */
export type FillType = 'solid' | 'gradient' | 'pattern' | 'pictureAndTexture' | 'none';

/**
 * Gradient direction type.
 * Matches the Rust `GradientType` enum in `domain-types`.
 */
export type GradientType = 'linear' | 'radial';

/**
 * A single color stop in a gradient.
 * Matches the Rust `GradientStop` struct in `domain-types`.
 */
export interface GradientStop {
  /** Position of the stop (0.0 to 1.0) */
  offset: number;
  /** CSS color string */
  color: string;
}

/**
 * Gradient fill configuration.
 * Matches the Rust `GradientFill` struct in `domain-types`.
 */
export interface GradientFill {
  /** Gradient type */
  type: GradientType;
  /** Gradient color stops */
  stops: GradientStop[];
  /** Gradient angle in degrees (for linear gradients) */
  angle?: number;
}

/** Pattern fill definition. */
export interface PatternFill {
  preset: string;
  foregroundColor?: string;
  backgroundColor?: string;
}

/** Tile settings for picture/texture fills. */
export interface TileSettings {
  tx?: number;
  ty?: number;
  sx?: number;
  sy?: number;
  flip?: string;
  algn?: string;
}

/** Picture/texture fill definition. */
export interface BlipFill {
  src: string;
  stretch?: boolean;
  tile?: TileSettings;
}

/**
 * Fill configuration for shapes and text boxes.
 * Matches the Rust `ObjectFill` struct in `domain-types`.
 */
export interface ObjectFill {
  /** Fill type */
  type: FillType;
  /** Solid fill color (CSS color string) */
  color?: string;
  /** Gradient configuration */
  gradient?: GradientFill;
  /** Fill transparency (0 = opaque, 1 = fully transparent). */
  transparency?: number;
  /** Pattern fill configuration (for type='pattern') */
  pattern?: PatternFill;
  /** Picture/texture fill configuration (for type='pictureAndTexture') */
  blip?: BlipFill;
}

/**
 * Text box border with optional corner radius.
 */
export interface TextBoxBorder extends ObjectBorder {
  /** Corner radius in pixels (for rounded corners) */
  radius?: number;
}

/**
 * Text margins within a text box or shape.
 */
export interface TextMargins {
  /** Top margin in pixels */
  top: number;
  /** Right margin in pixels */
  right: number;
  /** Bottom margin in pixels */
  bottom: number;
  /** Left margin in pixels */
  left: number;
}

/**
 * Text box floating object.
 * A rectangular container for rich text content.
 */
export interface TextBoxObject extends FloatingObjectBase {
  type: 'textbox';
  /** Text content and formatting — shared model with ShapeData. */
  text?: ShapeText;
  /** Fill color/gradient for the text box background */
  fill?: ObjectFill;
  /** Border around the text box */
  border?: TextBoxBorder;
  /** Optional text-effect configuration for styled text effects */
  textEffects?: TextEffectConfig;
}

// ============================================================================
// Shape Object
// ============================================================================

// `ShapeType` lives in `./floating-object-types` and is re-exported at the
// top of this file so it can be referenced by subtype-specific modules
// (e.g. `diagram/types.ts`) without creating an import cycle.

/** Arrowhead/line-end type for connector endpoints. Maps to ST_LineEndType (ECMA-376, dml-main.xsd). Canonical source; re-exported by drawing-canvas scene/types. */
export type LineEndType = 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow';

/** Arrowhead/line-end size for connector endpoints. Maps to ST_LineEndLength/ST_LineEndWidth (ECMA-376, dml-main.xsd). Canonical source; re-exported by drawing-canvas scene/types. */
export type LineEndSize = 'sm' | 'med' | 'lg';

/**
 * Detailed line dash pattern.
 * Matches OOXML line dash styles and Rust `LineDash` enum.
 * Uses the same 11 variants as OOXML ST_PresetLineDashVal.
 */
export type LineDash =
  | 'solid'
  | 'dot'
  | 'dash'
  | 'dashDot'
  | 'lgDash'
  | 'lgDashDot'
  | 'lgDashDotDot'
  | 'sysDash'
  | 'sysDot'
  | 'sysDashDot'
  | 'sysDashDotDot';

/**
 * Shape outline/stroke configuration.
 */
export interface ShapeOutline {
  /** Outline style */
  style: 'none' | 'solid' | 'dashed' | 'dotted';
  /** Outline color (CSS color string) */
  color: string;
  /** Outline width in pixels */
  width: number;
  /** Head (start) arrowhead configuration */
  headEnd?: { type: LineEndType; width?: LineEndSize; length?: LineEndSize };
  /** Tail (end) arrowhead configuration */
  tailEnd?: { type: LineEndType; width?: LineEndSize; length?: LineEndSize };
  /** Detailed dash pattern (overrides coarse `style` when set). Matches OOXML dash styles. */
  dash?: LineDash;
  /** Outline transparency (0 = opaque, 1 = fully transparent). */
  transparency?: number;
  /** Compound line style (e.g., double, thickThin). */
  compound?: CompoundLineStyle;
  /** Whether the outline is visible. */
  visible?: boolean;
}

/** How text auto-sizes within its container. */
export type TextAutoSize =
  | { type: 'none' }
  | { type: 'textToFitShape'; fontScale?: number; lineSpacingReduction?: number }
  | { type: 'shapeToFitText' };

/** Text orientation within a shape. */
export type TextOrientation =
  | 'horizontal'
  | 'vertical'
  | 'vertical270'
  | 'textEffectsVertical'
  | 'eastAsianVertical'
  | 'mongolianVertical';

/** Text reading order / directionality. */
export type TextReadingOrder = 'leftToRight' | 'rightToLeft';

/** Text overflow behavior. */
export type TextOverflow = 'overflow' | 'clip' | 'ellipsis';

/** Compound line style. */
export type CompoundLineStyle = 'single' | 'double' | 'thickThin' | 'thinThick' | 'triple';

/**
 * Text content inside a shape.
 */
/** A run of text with optional per-run formatting. */
export interface TextRun {
  text: string;
  format?: CellFormat;
}

export interface ShapeText {
  /** Text content */
  content: string;
  /** Text formatting */
  format?: CellFormat;
  /** Rich text runs for per-run formatting. When present, authoritative over content+format. */
  runs?: TextRun[];
  /** Vertical alignment of text within shape */
  verticalAlign?: 'top' | 'middle' | 'bottom' | 'justified' | 'distributed';
  /** Horizontal alignment of text within shape */
  horizontalAlign?: 'left' | 'center' | 'right' | 'justify' | 'distributed';
  /** Text margins within the container */
  margins?: TextMargins;
  /** Auto-size behavior */
  autoSize?: TextAutoSize;
  /** Text orientation */
  orientation?: TextOrientation;
  /** Reading order / directionality */
  readingOrder?: TextReadingOrder;
  /** Horizontal overflow behavior */
  horizontalOverflow?: TextOverflow;
  /** Vertical overflow behavior */
  verticalOverflow?: TextOverflow;
}

/**
 * Shape floating object.
 * A geometric shape with optional fill, outline, and text.
 */
export interface ShapeObject extends FloatingObjectBase {
  type: 'shape';
  /** Type of shape to render */
  shapeType: ShapeType;
  /** Fill configuration */
  fill?: ObjectFill;
  /** Outline/stroke configuration */
  outline?: ShapeOutline;
  /** Text content inside the shape */
  text?: ShapeText;
  /** Shadow effect (outer shadow / drop shadow) */
  shadow?: OuterShadowEffect;
  /**
   * Shape-specific adjustments.
   * Keys depend on shape type (e.g., 'cornerRadius' for roundRect,
   * 'arrowHeadSize' for arrows, 'starPoints' for stars).
   */
  adjustments?: Record<string, number>;
}

// ============================================================================
// Connector Object
// ============================================================================

/**
 * Connector floating object.
 * A line or connector shape that links two objects (or floats freely).
 * Connectors have optional arrowheads and connection site bindings.
 */
export interface ConnectorObject extends FloatingObjectBase {
  type: 'connector';
  /** Connector shape preset (e.g., straightConnector1, bentConnector3) */
  shapeType: ShapeType;
  /** Start connection binding (which shape and site index) */
  startConnection?: { shapeId: string; siteIndex: number };
  /** End connection binding (which shape and site index) */
  endConnection?: { shapeId: string; siteIndex: number };
  /** Fill configuration */
  fill?: ObjectFill;
  /** Outline/stroke configuration (includes arrowheads) */
  outline?: ShapeOutline;
}

// ============================================================================
// Chart Object
// ============================================================================

/**
 * Supported chart types for the ChartObject.
 * Matches the ChartType from charts package but defined here for contracts.
 */
export type ChartObjectType =
  | 'bar'
  | 'column'
  | 'line'
  | 'area'
  | 'pie'
  | 'doughnut'
  | 'scatter'
  | 'bubble'
  | 'combo'
  | 'radar'
  | 'stock'
  | 'funnel'
  | 'waterfall';

/**
 * Chart floating object.
 *
 * Integrates charts with the FloatingObjectManager to provide:
 * - Hit-testing for selection
 * - Drag/resize/z-order operations
 * - Consistent interaction model with other floating objects
 *
 * Architecture Notes:
 * - Uses Cell Identity Model with CellIdRange references (CRDT-safe)
 * - Full chart configuration lives in the Charts domain module
 * - This interface provides the FloatingObject layer for interactions
 * - Position resolution happens at render time via CellPositionLookup
 *
 * @example
 * // Chart data range A1:D10
 * const chart: ChartObject = {
 *   id: 'chart-1',
 *   type: 'chart',
 *   sheetId: 'sheet-abc',
 *   position: { anchorType: 'oneCell', from: { cellId: '...', xOffset: 0, yOffset: 0 }, width: 400, height: 300 },
 *   zIndex: 1,
 *   locked: false,
 *   printable: true,
 *   chartType: 'column',
 *   anchorMode: 'oneCell',
 *   widthCells: 8,
 *   heightCells: 15,
 *   chartConfig: { series: [], axes: {} },
 *   dataRangeIdentity: { topLeftCellId: '...', bottomRightCellId: '...' }
 * };
 */
export interface ChartObject extends FloatingObjectBase {
  type: 'chart';

  /**
   * The type of chart (bar, line, pie, etc.)
   */
  chartType: ChartObjectType;

  /**
   * How chart anchors to cells - affects resize behavior.
   * - 'oneCell': Chart moves with anchor cell, but doesn't resize with cell changes
   * - 'twoCell': Chart moves and resizes with both anchor cells
   */
  anchorMode: 'oneCell' | 'twoCell';

  /**
   * Width in cell units (for oneCell mode sizing).
   * In twoCell mode, width is determined by the anchor cell positions.
   */
  widthCells: number;

  /**
   * Height in cell units (for oneCell mode sizing).
   * In twoCell mode, height is determined by the anchor cell positions.
   */
  heightCells: number;

  /**
   * Full chart configuration (series, axes, legend, colors, etc.).
   * Stored directly on the floating object as a sub-object field, following the
   * same pattern as fill/outline/shadow on shapes.
   */
  chartConfig: Record<string, unknown>;

  /**
   * Chart data range using CellId corners (CRDT-safe).
   * Automatically expands when rows/cols inserted between corners.
   * Optional because some charts may have inline data or external sources.
   */
  dataRangeIdentity?: CellIdRange;

  /**
   * Series labels range using CellId corners (CRDT-safe).
   * Used to label each data series in the chart.
   */
  seriesRangeIdentity?: CellIdRange;

  /**
   * Category labels range using CellId corners (CRDT-safe).
   * Used for x-axis labels in most chart types.
   */
  categoryRangeIdentity?: CellIdRange;
}

// ============================================================================
// Equation Object
// ============================================================================

/**
 * Equation floating object.
 * Contains a mathematical equation rendered as a floating object.
 */
export interface EquationObject extends FloatingObjectBase {
  type: 'equation';
  /** The equation data */
  equation: Equation;
}

// ============================================================================
// diagram Object
// ============================================================================

/**
 * Diagram floating object.
 *
 * Diagrams provide visual representations of information like organization charts,
 * process flows, relationship diagrams, and hierarchies. The diagram data contains
 * the nodes and their relationships, while layout/styling is computed at render time.
 *
 * Architecture Notes:
 * - Diagram data (nodes, relationships) is persisted in Yjs via the bridge layer
 * - Selection state (selectedNodeIds, editingNodeId) lives in XState context, NOT here
 * - Computed layout is a runtime cache, managed by the bridge
 * - Uses existing object-interaction-machine for selection/drag/resize
 */
export interface DiagramObject extends FloatingObjectBase {
  type: 'diagram';
  /**
   * The diagram data including nodes, relationships, and styling.
   * This is the persisted data - layout is computed at runtime.
   */
  diagram: Diagram;
}

// ============================================================================
// OLE Object
// ============================================================================

/**
 * OLE (Object Linking and Embedding) floating object.
 *
 * Represents embedded or linked objects from other applications (e.g., Word
 * documents, PDF files, Visio drawings). The object may have a preview image
 * (PNG/JPEG) or display as an icon. EMF/WMF previews are not supported and
 * will have a null previewImageSrc.
 *
 * Architecture Notes:
 * - Preview image is extracted during OOXML parsing and stored as a blob URL
 * - Linked objects reference external files (isLinked); embedded objects are self-contained
 * - dvAspect determines whether the object renders as content or as an icon
 * - progId identifies the source application (e.g., "Word.Document.12", "AcroExch.Document")
 */
export interface OleObjectObject extends FloatingObjectBase {
  type: 'oleObject';
  /** OLE ProgID identifying the source application (e.g., "Word.Document.12") */
  progId: string;
  /** Display aspect: 'content' renders the object preview, 'icon' shows an application icon */
  dvAspect: 'content' | 'icon';
  /** Whether the object links to an external file */
  isLinked: boolean;
  /** Whether the object data is embedded in the workbook */
  isEmbedded: boolean;
  /** Blob URL for the preview image (PNG/JPEG), null for EMF/WMF or missing previews */
  previewImageSrc: string | null;
  /** Descriptive text for accessibility */
  altText: string;
}

// ============================================================================
// Union Type for All Floating Objects
// ============================================================================

/**
 * Union of all floating object types.
 * Use type narrowing on the 'type' discriminator to access specific properties.
 */
export type FloatingObject =
  | PictureObject
  | TextBoxObject
  | ShapeObject
  | ConnectorObject
  | ChartObject
  | DrawingObject
  | EquationObject
  | DiagramObject
  | OleObjectObject;

// ============================================================================
// Object Group
// ============================================================================

/**
 * A group of floating objects that move/resize together.
 * Groups can contain other groups for nested grouping.
 *
 * Extends CanvasObjectGroup to inherit universal group properties.
 *
 * Transition note: `sheetId` is kept for backward compatibility.
 * It aliases `containerId` from CanvasObjectGroup. Both fields should
 * be set to the same value. `sheetId` will be removed in a future phase.
 */
export interface FloatingObjectGroup extends CanvasObjectGroup {
  /** Sheet containing the group (spreadsheet-specific alias for containerId) */
  sheetId: SheetId;
  /**
   * Container scope (inherited from CanvasObjectGroup).
   * For spreadsheets, this is the same as sheetId.
   */
  containerId: string;
  /** Bounding box position for the group */
  position: ObjectPosition;
  /** Whether the group is locked (non-optional override of CanvasObjectGroup.locked) */
  locked: boolean;
}

// ============================================================================
// Hit Testing (for interaction handling)
// ============================================================================

/**
 * Regions of an object that can be hit-tested.
 * Used to determine cursor and interaction behavior.
 */
export type ObjectHitRegion =
  | 'body' // Main object area (for dragging)
  | 'border' // Object border (for dragging)
  | 'resize-nw' // Northwest resize handle
  | 'resize-n' // North resize handle
  | 'resize-ne' // Northeast resize handle
  | 'resize-e' // East resize handle
  | 'resize-se' // Southeast resize handle
  | 'resize-s' // South resize handle
  | 'resize-sw' // Southwest resize handle
  | 'resize-w' // West resize handle
  | 'rotation' // Rotation handle
  // text effects-specific regions
  | 'warp-adjust'; // Yellow diamond handle for adjusting warp intensity

/**
 * Result of hit-testing a point against floating objects.
 * Used by coordinator to route events to object-interaction-machine.
 */
export interface ObjectHitTestResult {
  /** ID of the object that was hit */
  objectId: string;
  /** Which region of the object was hit */
  region: ObjectHitRegion;
  /** Whether this is a group */
  isGroup: boolean;
}

// ============================================================================
// Object Interaction States (for state machine)
// ============================================================================

/**
 * States for the object-interaction-machine.
 * Defines all possible interaction modes with floating objects.
 *
 * State transitions:
 * - idle → selected (click on object)
 * - selected → operating (mouse down on body/handle triggers START_DRAG/START_RESIZE/START_ROTATE)
 * - selected → editingText (double-click on textbox/shape with text)
 * - selected → textEffectsEditing (double-click on text-effect object)
 * - selected → adjustingWarp (drag warp-adjust handle on text effects)
 * - selected → idle (click outside or Escape)
 * - operating → selected (COMPLETE_OPERATION/CANCEL_OPERATION)
 * - editingText → selected (click outside text or Escape)
 * - textEffectsEditing → selected (STOP_EDITING or click outside)
 * - adjustingWarp → selected (POINTER_UP or ESCAPE)
 */
export type ObjectInteractionState =
  | 'idle' // No object selected, normal cell interaction
  | 'selected' // Object has selection handles visible
  | 'multiSelected' // Multiple objects selected
  | 'operating' // Unified operation state for drag/resize/rotate
  | 'editingText' // Editing text inside textbox/shape
  // Insert mode
  | 'inserting' // Drag-to-insert a new shape on canvas
  // text effects-specific states
  | 'textEffectsEditing' // Editing text-effect text inline
  | 'adjustingWarp'; // Adjusting text effects warp via handle drag

/**
 * Context for the object-interaction-machine.
 * Maintained by the coordinator.
 */
export interface ObjectInteractionContext {
  /** Currently selected object IDs (empty if idle) */
  selectedIds: string[];
  /** Active resize handle (if resizing) */
  activeHandle?: ObjectHitRegion;
}

// ============================================================================
// Manager Interface
// ============================================================================

/**
 * Options for creating a picture object.
 */
export interface CreatePictureOptions {
  /** Optional name for the object */
  name?: string;
  /** Alt text for accessibility */
  altText?: string;
  /** Whether object is locked */
  locked?: boolean;
  /** Whether object appears in print */
  printable?: boolean;
  /** Initial crop settings */
  crop?: PictureCrop;
  /** Initial adjustments */
  adjustments?: PictureAdjustments;
  /** Border configuration */
  border?: ObjectBorder;
}

/**
 * Options for creating a text box object.
 */
export interface CreateTextBoxOptions {
  /** Optional name for the object */
  name?: string;
  /** Alt text for accessibility */
  altText?: string;
  /** Whether object is locked */
  locked?: boolean;
  /** Whether object appears in print */
  printable?: boolean;
  /** Fill configuration */
  fill?: ObjectFill;
  /** Border configuration */
  border?: TextBoxBorder;
  /** Optional text-effect configuration for styled text effects */
  textEffects?: TextEffectConfig;
  /** Text configuration (content, format, margins, alignment) — shared model with ShapeData */
  text?: ShapeText;
}

/**
 * Options for creating a text-effect object (text box with text-effect configuration).
 * Extends CreateTextBoxOptions with the required text-effect configuration.
 */
export interface CreateTextEffectOptions extends Omit<CreateTextBoxOptions, 'textEffects'> {
  /** Initial text-effect configuration (required for text-effect objects) */
  textEffects: TextEffectConfig;
}

/**
 * Options for creating a shape object.
 */
export interface CreateShapeOptions {
  /** Optional name for the object */
  name?: string;
  /** Alt text for accessibility */
  altText?: string;
  /** Whether object is locked */
  locked?: boolean;
  /** Whether object appears in print */
  printable?: boolean;
  /** Fill configuration */
  fill?: ObjectFill;
  /** Outline configuration */
  outline?: ShapeOutline;
  /** Initial text content */
  text?: ShapeText;
  /** Shadow effect (outer shadow / drop shadow) */
  shadow?: OuterShadowEffect;
  /** Shape-specific adjustments */
  adjustments?: Record<string, number>;
}

/**
 * Options for creating a chart as a floating object.
 *
 * This is used by the FloatingObjectManager's createChart method to create
 * a ChartObject that integrates with the unified floating object system.
 * The chart-specific configuration is managed by the Charts domain module.
 */
export interface CreateChartAsFloatingObjectOptions {
  /** Optional name for the chart object */
  name?: string;
  /** Alt text for accessibility */
  altText?: string;
  /** Whether chart is locked (can't be moved/resized) */
  locked?: boolean;
  /** Whether chart appears in print output */
  printable?: boolean;
  /** How chart anchors to cells */
  anchorMode?: 'oneCell' | 'twoCell';
  /** Width in cell units (for oneCell mode) */
  widthCells?: number;
  /** Height in cell units (for oneCell mode) */
  heightCells?: number;
  /** Initial data range using CellId corners */
  dataRangeIdentity?: CellIdRange;
  /** Initial series labels range using CellId corners */
  seriesRangeIdentity?: CellIdRange;
  /** Initial category labels range using CellId corners */
  categoryRangeIdentity?: CellIdRange;
}

/**
 * Options for creating an equation object.
 */
export interface CreateEquationOptions {
  /** Optional name for the object */
  name?: string;
  /** Alt text for accessibility */
  altText?: string;
  /** Whether object is locked */
  locked?: boolean;
  /** Whether object appears in print */
  printable?: boolean;
  /** LaTeX string for the equation (if not using omml) */
  latex?: string;
  /** OMML XML string (if not using latex) */
  omml?: string;
  /** Equation style overrides */
  style?: Partial<EquationStyle>;
}

/**
 * Options for creating a diagram object.
 *
 * Based on the pattern from CreatePictureOptions and CreateChartAsFloatingObjectOptions.
 * The layoutId is required to determine the diagram type (hierarchy, process, etc.).
 */
export interface CreateDiagramOptions {
  /** Optional name for the object */
  name?: string;
  /** Alt text for accessibility */
  altText?: string;
  /** Whether object is locked */
  locked?: boolean;
  /** Whether object appears in print */
  printable?: boolean;
  /** Quick style ID (e.g., 'subtle-effect', 'moderate-effect') */
  quickStyleId?: string;
  /** Color theme ID (e.g., 'colorful-1', 'accent-1') */
  colorThemeId?: string;
  /** Initial nodes to populate the diagram with */
  initialNodes?: Array<{ text: string; level: number }>;
}
