/**
 * Chart Interaction Utilities
 *
 * Pure functions for chart interactions including:
 * - Pick: Point-in-mark testing
 * - Tooltip: Hit test to data point lookup
 * - Brush: Rectangular selection
 * - Zoom: Pan and zoom transformations
 *
 * These utilities are framework-agnostic and can be used with any rendering system.
 * The engine/ package wires these to mouse events and other UI interactions.
 */

// =============================================================================
// Pick - Point-in-mark testing
// =============================================================================

export {
  distanceToMark,
  pickAllMarks,
  pickClosestMark,
  // Pick functions
  pickMark,
  pickMarksInRadius,
  // Geometry helpers
  pointInMark,
  signedDistanceToMark,
  // Types
  type PickResult,
} from './pick';

// =============================================================================
// Tooltip - Hit test to data point lookup
// =============================================================================

export {
  // Field extraction
  extractTooltipFields,
  findAllTooltipData,
  // Main tooltip functions
  findTooltipData,
  formatDate,
  // Formatting utilities
  formatNumber,
  formatTooltipHtml,
  formatTooltipText,
  formatValue,
  getMarkPosition,
  type ChannelSpec,
  type ChartSpec,
  // Types
  type DataRow,
  type EncodingSpec,
  type TooltipData,
  type TooltipField,
  type TooltipOptions,
} from './tooltip';

// =============================================================================
// Brush - Rectangular selection
// =============================================================================

export {
  // Selection operations
  brushSelect,
  brushSelectMarks,
  constrainBrushSelection,
  // Selection creation
  createBrushSelection,
  // Selection utilities
  expandBrushSelection,
  getBrushArea,
  getBrushCenter,
  getBrushDimensions,
  intersectBrushSelections,
  isPointInBrush,
  isValidBrushSelection,
  unionBrushSelections,
  type BrushMode,
  type BrushOptions,
  type BrushResult,
  // Types (re-export DataRow from brush to avoid conflicts)
  type BrushSelection,
} from './brush';

// =============================================================================
// Zoom - Pan and zoom transformations
// =============================================================================

export {
  centerOn,
  composeTransforms,
  constrainPan,
  // Constraint utilities
  constrainScale,
  constrainTransform,
  defaultZoomLimits,
  // Constants
  identityTransform,
  interpolateTransform,
  invertPoint,
  invertRect,
  invertTransform,
  isIdentity,
  // Pan operations
  pan,
  panTo,
  pinchScaleToScaleFactor,
  // Scale integration
  rescaleX,
  rescaleY,
  // Reset and utility operations
  resetZoom,
  // Transform application
  transformPoint,
  transformRect,
  // Wheel zoom helpers
  wheelDeltaToScaleFactor,
  // Zoom operations
  zoomAt,
  zoomBy,
  zoomTo,
  zoomToFit,
  type PanBounds,
  type Point,
  type ZoomLimits,
  // Types
  type ZoomTransform,
} from './zoom';
