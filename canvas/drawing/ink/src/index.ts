/**
 * @mog/ink-engine
 *
 * Standalone drawing/inking engine.
 * Handles stroke creation, smoothing, simplification, spatial indexing,
 * intersection tests, eraser operations, and pressure-to-width mapping.
 *
 * Depends on @mog/geometry + @mog-sdk/contracts.
 * Pure computation: no DOM, no Canvas, no React, no Yjs.
 */

// ── Stroke Module ───────────────────────────────────────────────────────────
export {
  createStroke,
  simplifyStroke,
  smoothStroke,
  strokeBoundingBox,
  strokeToPath,
  strokeToPolyline,
} from './stroke';
export type { Stroke, StrokePoint } from './types';

// ── Spatial Index Module ────────────────────────────────────────────────────
export { createSpatialIndex } from './spatial-index';
export type { SpatialEntry, SpatialIndex } from './spatial-index';

// ── Intersection Module ─────────────────────────────────────────────────────
export {
  boxesOverlap,
  clipSegmentToRect,
  pointNearStroke,
  pointToSegmentDistSq,
  segmentCircleIntersection,
  segmentsIntersect,
  strokeIntersectsRect,
  strokeLineIntersections,
  strokesIntersect,
} from './intersection';

// ── Eraser Module ───────────────────────────────────────────────────────────
export { eraseFromStroke, pointErase, strokeErase } from './eraser';

// ── Pressure Module ─────────────────────────────────────────────────────────
export {
  applyPressureProfile,
  curvePressureToWidth,
  defaultPressureToWidth,
  linearPressureToWidth,
} from './pressure';

// ── Drawing Object Output Module ──────────────────────────────────────────
export { strokeToDrawingObject } from './drawing-object-output';

// ── Diagnostics Module ──────────────────────────────────────────────────────
export { validateSpatialIndex, validateStroke } from './diagnostics';
export type { DiagnosticIssue, DiagnosticResult } from './diagnostics';
