/**
 * @mog/drawing-engine
 *
 * Standalone drawing composition engine for floating objects.
 * Manages: z-ordering, grouping, spatial queries, anchor resolution, layout operations.
 *
 * Does NOT depend on specific object engines (shape, equation, etc.) -
 * only on @mog/geometry + @mog-sdk/contracts.
 *
 * Pure computation: no DOM, no Canvas, no React, no Yjs.
 */

// Z-Order Management
export {
  bringForward,
  bringToFront,
  insertAtZIndex,
  normalizeZOrder,
  removeFromZOrder,
  sendBackward,
  sendToBack,
  sortByZOrder,
} from './z-order/z-order-manager';
export type { ZOrderedItem } from './z-order/z-order-manager';

// Grouping
export {
  createGroup,
  createGroupHierarchy,
  getGroupMembers,
  getTopLevelGroup,
  ungroup,
  validateGroupHierarchy,
} from './grouping/group-manager';
export type { GroupHierarchy, GroupInfo, GroupValidationIssue } from './grouping/group-manager';
export { computeGroupBounds, resolveSelectionTarget } from './grouping/group-operations';

// Spatial Query
export { findNearby, findOverlapping, hitTest, selectInRect } from './spatial/spatial-query';
export type { HitTestNarrowPhaseOptions, SpatialObject } from './spatial/spatial-query';

// Selection
export {
  addToSelection,
  createEmptySelection,
  getSelectionBounds,
  removeFromSelection,
  setSelection,
  toggleSelection,
} from './spatial/selection';
export type { SelectionState } from './spatial/selection';

// Anchor Types
export type {
  AbsoluteAnchor,
  Anchor,
  AnchorPoint,
  CellDimensionLookup,
  OneCellAnchor,
  TwoCellAnchor,
} from './anchor/anchor-types';

// Anchor Resolution
export {
  boundsToTwoCellAnchor,
  positionToAnchor,
  resolveAnchor,
  resolveAnchorPoint,
} from './anchor/anchor-resolver';

// Resize-With-Cells
export {
  recomputeAbsoluteBounds,
  recomputeBoundsOnCellResize,
  recomputeOneCellBounds,
} from './anchor/resize-with-cells';

// Layout: Snap
export { snapToGrid, snapToObjects } from './layout/snap';
export type { SnapGuide, SnapResult } from './layout/snap';

// Layout: Align
export { alignObjects } from './layout/align';
export type { AlignType } from './layout/align';

// Layout: Distribute
export { distributeObjects } from './layout/distribute';
export type { DistributeType } from './layout/distribute';

// Diagnostics
export { traceAnchorResolution } from './diagnostics/anchor-diagnostics';
export type { AnchorTrace, ResolutionStep } from './diagnostics/anchor-diagnostics';
export { generateDrawingSummary } from './diagnostics/reporters';
export { validateGroups, validateZOrder } from './diagnostics/validators';
export type { DiagnosticIssue } from './diagnostics/validators';

// ─── Renderer ─────────────────────────────────────────────────────────────────

// Canvas rendering
export { renderDrawingObjectToCanvas } from './renderer/canvas';

// SVG rendering
export { renderDrawingObjectToSVG } from './renderer/svg';

// Hit testing (narrow phase)
export { buildHitTestPath, isPointInDrawingObject } from './renderer/hit-test';

// Primitives (for advanced consumers)
export { fillToSVGAttributes, renderFillToCanvas } from './renderer/fills';
export { computePathBounds, pathToPath2D, replayPathToCanvas } from './renderer/path';
export { renderStrokeToCanvas, strokeToSVGAttributes } from './renderer/strokes';

// Effects
export {
  bevel3DToSVGFilter,
  bevelToSVGFilter,
  colorWithOpacity,
  compose3DEffectsToSVGFilter,
  compositeEffectsToSVGFilter,
  emuToPx,
  extrusionToSVGFilter,
  glowToSVGFilter,
  innerShadowToSVGFilter,
  materialToSVGFilter,
  outerShadowToSVGFilter,
  render3DBevelToCanvas,
  renderBevelToCanvas,
  renderExtrusionToCanvas,
  renderGlowToCanvas,
  renderInnerShadowToCanvas,
  renderMaterialToCanvas,
  renderOuterShadowToCanvas,
  renderSoftEdgeToCanvas,
} from './renderer/effects';
