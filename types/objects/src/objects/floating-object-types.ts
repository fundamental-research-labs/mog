/**
 * Floating Object Base Types
 *
 * Shared foundation types extracted from `floating-objects.ts` so that
 * subtype-specific type modules (e.g. `ink/types.ts`, `diagram/types.ts`)
 * can build on the floating-object vocabulary without importing back into
 * `floating-objects.ts` itself.
 *
 * Layering rule:
 * - This module depends only on universal canvas-object types and cell
 *   identity. It must NOT import from `floating-objects.ts` or any
 *   subtype-specific module (ink, diagram, text-effects, equation, …).
 * - `floating-objects.ts` re-exports these types so existing consumers
 *   continue to work unchanged.
 *
 * This separation exists to break the cycles:
 *   - objects/floating-objects.ts ↔ ink/types.ts
 *   - objects/floating-objects.ts ↔ diagram/types.ts
 */

import type { CellId } from '@mog/types-core/cell-identity';
import type { SheetId } from '@mog/types-core/core';
import type { CanvasObject, CanvasObjectType } from './canvas-object';

// ============================================================================
// Position & Sizing
// ============================================================================

/**
 * How the object anchors to the sheet.
 * Determines behavior when rows/columns are resized.
 */
export type ObjectAnchorType =
  | 'twoCell' // Anchored to two cells (moves and resizes with cells)
  | 'oneCell' // Anchored to one cell (moves but doesn't resize)
  | 'absolute'; // Absolute position (doesn't move with cells)

/**
 * Cell anchor point with pixel offset.
 * Used for precise positioning relative to cell boundaries.
 *
 * Cell Identity Model:
 * Uses CellId for stable references that survive row/col insert/delete.
 * Position is resolved at render time via CellPositionLookup.
 *
 * @example
 * // User places image at B5
 * const anchor: CellAnchor = {
 *   cellId: 'abc-123...',  // CellId of B5
 *   xOffset: 10,           // 10px from cell left edge
 *   yOffset: 5             // 5px from cell top edge
 * };
 * // After inserting row at row 3, the CellId is unchanged
 * // but resolves to position (row: 5, col: 1) → image moves down
 */
export interface CellAnchor {
  /**
   * Stable cell reference that survives row/col insert/delete.
   * Resolve to current position via CellPositionLookup.getPosition().
   */
  cellId: CellId;
  /** Horizontal offset from cell top-left in pixels */
  xOffset: number;
  /** Vertical offset from cell top-left in pixels */
  yOffset: number;
}

/**
 * Object position configuration.
 * Supports cell-anchored and absolute positioning modes.
 */
export interface ObjectPosition {
  /** Anchor type determines how object moves/resizes with cells */
  anchorType: ObjectAnchorType;
  /** Start anchor (top-left corner) - required for all anchor types */
  from: CellAnchor;
  /** End anchor (bottom-right corner) - only for twoCell anchor */
  to?: CellAnchor;
  /** Absolute X position in pixels (only for absolute anchor) */
  x?: number;
  /** Absolute Y position in pixels (only for absolute anchor) */
  y?: number;
  /** Width in pixels (for oneCell and absolute anchors) */
  width?: number;
  /** Height in pixels (for oneCell and absolute anchors) */
  height?: number;
  /** Rotation angle in degrees (0-360) */
  rotation?: number;
  /** Flip horizontally (mirror along vertical axis) */
  flipH?: boolean;
  /** Flip vertically (mirror along horizontal axis) */
  flipV?: boolean;
}

// ============================================================================
// Common Object Properties
// ============================================================================

/**
 * Object type discriminator.
 * Used for type narrowing in union types.
 *
 * Extends CanvasObjectType (which is `string`) with a specific union for
 * spreadsheet object types. This ensures backward compatibility: any code
 * expecting FloatingObjectKind still gets the specific union, while
 * CanvasObjectType-based code accepts it as a string.
 *
 * Storage-layer discriminant for floating objects. Mirrors Rust FloatingObjectKind.
 * See also FloatingObjectType in api/types.ts (API-layer superset that adds 'text-effects').
 *
 * Note: 'slicer' is defined here for the FloatingObjectKind union,
 * but the full SlicerConfig type is in contracts/src/slicers.ts
 * because slicers have significant additional properties.
 */
export type FloatingObjectKind =
  | 'shape'
  | 'connector'
  | 'picture'
  | 'textbox'
  | 'chart'
  | 'camera'
  | 'equation'
  | 'diagram'
  | 'drawing'
  | 'oleObject'
  | 'formControl'
  | 'slicer';

// Ensure FloatingObjectKind is assignable to CanvasObjectType (compile-time check)
const _typeCheck: CanvasObjectType = '' as FloatingObjectKind;
void _typeCheck;

/**
 * Base interface for all floating objects.
 * Contains common properties shared by all object types.
 *
 * Extends CanvasObject<ObjectPosition> to inherit universal canvas object
 * properties. The spreadsheet anchor type is ObjectPosition (cell-based).
 *
 * Transition note: `sheetId` is kept for backward compatibility during
 * migration. It aliases `containerId` from CanvasObject. Both fields should
 * be set to the same value. `sheetId` will be removed in a future phase.
 */
export interface FloatingObjectBase extends CanvasObject<ObjectPosition> {
  /** Object type discriminator (narrows CanvasObject.type to spreadsheet types) */
  type: FloatingObjectKind;
  /** Sheet containing the object (spreadsheet-specific alias for containerId) */
  sheetId: SheetId;
  /**
   * Container scope (inherited from CanvasObject).
   * For spreadsheets, this is the same as sheetId.
   * Set both sheetId and containerId to the same value during the transition.
   */
  containerId: string;
  /**
   * Position and sizing configuration.
   * This is the spreadsheet-specific name for the anchor from CanvasObject.
   * Both `position` and `anchor` should reference the same ObjectPosition.
   */
  position: ObjectPosition;
  /**
   * App-specific anchor (inherited from CanvasObject<ObjectPosition>).
   * For spreadsheets, this is the same as `position`.
   */
  anchor: ObjectPosition;
  /** Accessibility title (distinct from altText description) */
  altTextTitle?: string;
  /** User-visible display name (may differ from internal name) */
  displayName?: string;
  /** Whether to preserve aspect ratio when resizing */
  lockAspectRatio?: boolean;
  /** Import-time validity/renderability status for preserved degraded objects. */
  importStatus?: ImportObjectStatus;
}

export type ImportRecoverability =
  | 'fullySupported'
  | 'repaired'
  | 'partiallySupported'
  | 'preservedNotRenderable'
  | 'preservedNotEditable'
  | 'unsupportedPreserved'
  | 'unsupportedDropped'
  | 'malformedDropped'
  | 'securityDisabled';

export type ImportRenderability = 'renderable' | 'placeholder' | 'notRenderable';

export type ImportEditability = 'editable' | 'partiallyEditable' | 'notEditable';

export interface ImportDiagnosticRef {
  id?: string;
  part?: string;
  relationshipId?: string;
  relationshipTarget?: string;
  sheetIndex?: number;
  sheetName?: string;
  row?: number;
  col?: number;
  cellRef?: string;
  sourceRange?: string;
  featureKind?: string;
  objectId?: string;
  objectName?: string;
  relatedParts?: string[];
}

export interface ImportObjectStatus {
  source: 'xlsx' | 'csv' | 'native' | 'unknown';
  featureKind: string;
  recoverability: ImportRecoverability;
  renderability: ImportRenderability;
  editability: ImportEditability;
  diagnostics?: ImportDiagnosticRef[];
  reference?: ImportDiagnosticRef;
}

// ============================================================================
// Shape Type
// ============================================================================

/**
 * Available shape types.
 * Matches common common spreadsheet shape categories.
 *
 * Extracted here (rather than in `floating-objects.ts`) so that diagram
 * and other subtype modules can reference a subset without creating a
 * cycle back into `floating-objects.ts`.
 */
export type ShapeType =
  // Basic shapes
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'rtTriangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'parallelogram'
  | 'trapezoid'
  | 'nonIsoscelesTrapezoid'
  | 'heptagon'
  | 'decagon'
  | 'dodecagon'
  | 'teardrop'
  | 'pie'
  | 'pieWedge'
  | 'blockArc'
  | 'donut'
  | 'noSmoking'
  | 'plaque'
  // Rectangle variants (rounded/snipped)
  | 'round1Rect'
  | 'round2SameRect'
  | 'round2DiagRect'
  | 'snip1Rect'
  | 'snip2SameRect'
  | 'snip2DiagRect'
  | 'snipRoundRect'
  // Arrows
  | 'rightArrow'
  | 'leftArrow'
  | 'upArrow'
  | 'downArrow'
  | 'leftRightArrow'
  | 'upDownArrow'
  | 'quadArrow'
  | 'chevron'
  // Arrow Callouts
  | 'leftArrowCallout'
  | 'rightArrowCallout'
  | 'upArrowCallout'
  | 'downArrowCallout'
  | 'leftRightArrowCallout'
  | 'upDownArrowCallout'
  | 'quadArrowCallout'
  // Curved/Special Arrows
  | 'bentArrow'
  | 'uturnArrow'
  | 'circularArrow'
  | 'leftCircularArrow'
  | 'leftRightCircularArrow'
  | 'curvedRightArrow'
  | 'curvedLeftArrow'
  | 'curvedUpArrow'
  | 'curvedDownArrow'
  | 'swooshArrow'
  // Stars and banners
  | 'star4'
  | 'star5'
  | 'star6'
  | 'star7'
  | 'star8'
  | 'star10'
  | 'star12'
  | 'star16'
  | 'star24'
  | 'star32'
  | 'ribbon'
  | 'ribbon2'
  | 'ellipseRibbon'
  | 'ellipseRibbon2'
  | 'leftRightRibbon'
  | 'banner'
  // Callouts
  | 'wedgeRectCallout'
  | 'wedgeRoundRectCallout'
  | 'wedgeEllipseCallout'
  | 'cloud'
  | 'callout1'
  | 'callout2'
  | 'callout3'
  | 'borderCallout1'
  | 'borderCallout2'
  | 'borderCallout3'
  | 'accentCallout1'
  | 'accentCallout2'
  | 'accentCallout3'
  | 'accentBorderCallout1'
  | 'accentBorderCallout2'
  | 'accentBorderCallout3'
  // Lines and connectors
  | 'line'
  | 'lineArrow'
  | 'lineDoubleArrow'
  | 'curve'
  | 'arc'
  | 'connector'
  | 'bentConnector2'
  | 'bentConnector3'
  | 'bentConnector4'
  | 'bentConnector5'
  | 'curvedConnector2'
  | 'curvedConnector3'
  | 'curvedConnector4'
  | 'curvedConnector5'
  // Flowchart shapes
  | 'flowChartProcess'
  | 'flowChartDecision'
  | 'flowChartInputOutput'
  | 'flowChartPredefinedProcess'
  | 'flowChartInternalStorage'
  | 'flowChartDocument'
  | 'flowChartMultidocument'
  | 'flowChartTerminator'
  | 'flowChartPreparation'
  | 'flowChartManualInput'
  | 'flowChartManualOperation'
  | 'flowChartConnector'
  | 'flowChartPunchedCard'
  | 'flowChartPunchedTape'
  | 'flowChartSummingJunction'
  | 'flowChartOr'
  | 'flowChartCollate'
  | 'flowChartSort'
  | 'flowChartExtract'
  | 'flowChartMerge'
  | 'flowChartOfflineStorage'
  | 'flowChartOnlineStorage'
  | 'flowChartMagneticTape'
  | 'flowChartMagneticDisk'
  | 'flowChartMagneticDrum'
  | 'flowChartDisplay'
  | 'flowChartDelay'
  | 'flowChartAlternateProcess'
  | 'flowChartOffpageConnector'
  // Decorative symbols
  | 'heart'
  | 'lightningBolt'
  | 'sun'
  | 'moon'
  | 'smileyFace'
  | 'foldedCorner'
  | 'bevel'
  | 'frame'
  | 'halfFrame'
  | 'corner'
  | 'diagStripe'
  | 'chord'
  | 'can'
  | 'cube'
  | 'plus'
  | 'cross'
  | 'irregularSeal1'
  | 'irregularSeal2'
  | 'homePlate'
  | 'funnel'
  | 'verticalScroll'
  | 'horizontalScroll'
  // Action Buttons
  | 'actionButtonBlank'
  | 'actionButtonHome'
  | 'actionButtonHelp'
  | 'actionButtonInformation'
  | 'actionButtonForwardNext'
  | 'actionButtonBackPrevious'
  | 'actionButtonEnd'
  | 'actionButtonBeginning'
  | 'actionButtonReturn'
  | 'actionButtonDocument'
  | 'actionButtonSound'
  | 'actionButtonMovie'
  // Brackets and Braces
  | 'leftBracket'
  | 'rightBracket'
  | 'leftBrace'
  | 'rightBrace'
  | 'bracketPair'
  | 'bracePair'
  // Math shapes
  | 'mathPlus'
  | 'mathMinus'
  | 'mathMultiply'
  | 'mathDivide'
  | 'mathEqual'
  | 'mathNotEqual'
  // Miscellaneous
  | 'gear6'
  | 'gear9'
  | 'cornerTabs'
  | 'squareTabs'
  | 'plaqueTabs'
  | 'chartX'
  | 'chartStar'
  | 'chartPlus';
