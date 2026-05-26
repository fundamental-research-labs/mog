/**
 * Diagnostic validators for ink engine types.
 *
 * Validate strokes and spatial indices for common issues:
 * NaN coordinates, empty points, pressure range, bounds consistency,
 * zero-length strokes, duplicate IDs, orphaned entries.
 */
import type { SpatialIndex } from './spatial-index';
import { strokeBoundingBox } from './stroke';
import type { Stroke } from './types';

// =============================================================================
// Types
// =============================================================================

export interface DiagnosticIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface DiagnosticResult {
  valid: boolean;
  issues: DiagnosticIssue[];
}

// =============================================================================
// Stroke Validation
// =============================================================================

/**
 * Validate a stroke for common issues.
 *
 * Checks performed:
 * - NaN/non-finite coordinates
 * - Empty points array
 * - Pressure values out of [0, 1] range
 * - Bounds consistency (stored bounds match computed bounds)
 * - Zero-length stroke (all points at same position)
 * - Negative width or opacity
 * - Empty color string
 */
export function validateStroke(stroke: Stroke): DiagnosticResult {
  const issues: DiagnosticIssue[] = [];

  // Check for empty points
  if (stroke.points.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'STROKE_EMPTY',
      message: 'Stroke has no points',
    });
    return { valid: issues.every((i) => i.severity !== 'error'), issues };
  }

  // Check for NaN/non-finite coordinates
  let hasNaNPoints = false;
  for (let i = 0; i < stroke.points.length; i++) {
    const p = stroke.points[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      issues.push({
        severity: 'error',
        code: 'STROKE_NAN_COORDINATE',
        message: `Point ${i} has non-finite coordinate: (${p.x}, ${p.y})`,
      });
      hasNaNPoints = true;
    }
    if (!Number.isFinite(p.pressure)) {
      issues.push({
        severity: 'error',
        code: 'STROKE_NAN_PRESSURE',
        message: `Point ${i} has non-finite pressure: ${p.pressure}`,
      });
    }
    if (!Number.isFinite(p.timestamp)) {
      issues.push({
        severity: 'error',
        code: 'STROKE_NAN_TIMESTAMP',
        message: `Point ${i} has non-finite timestamp: ${p.timestamp}`,
      });
    }
  }

  // Check pressure range
  for (let i = 0; i < stroke.points.length; i++) {
    const p = stroke.points[i];
    if (Number.isFinite(p.pressure) && (p.pressure < 0 || p.pressure > 1)) {
      issues.push({
        severity: 'warning',
        code: 'STROKE_PRESSURE_OUT_OF_RANGE',
        message: `Point ${i} has pressure out of [0, 1] range: ${p.pressure}`,
      });
    }
  }

  // Check for zero-length stroke (all points at same position)
  if (stroke.points.length > 1) {
    const first = stroke.points[0];
    const allSamePosition = stroke.points.every(
      (p) => Math.abs(p.x - first.x) < 1e-10 && Math.abs(p.y - first.y) < 1e-10,
    );
    if (allSamePosition) {
      issues.push({
        severity: 'info',
        code: 'STROKE_ZERO_LENGTH',
        message: 'All points are at the same position (zero-length stroke)',
      });
    }
  }

  // Check width
  if (!Number.isFinite(stroke.width) || stroke.width <= 0) {
    issues.push({
      severity: 'error',
      code: 'STROKE_INVALID_WIDTH',
      message: `Stroke has invalid width: ${stroke.width}`,
    });
  }

  // Check opacity
  if (!Number.isFinite(stroke.opacity) || stroke.opacity < 0 || stroke.opacity > 1) {
    issues.push({
      severity: 'warning',
      code: 'STROKE_OPACITY_OUT_OF_RANGE',
      message: `Stroke has opacity out of [0, 1] range: ${stroke.opacity}`,
    });
  }

  // Check color
  if (!stroke.color || stroke.color.trim() === '') {
    issues.push({
      severity: 'warning',
      code: 'STROKE_EMPTY_COLOR',
      message: 'Stroke has empty color string',
    });
  }

  // Check bounds consistency
  if (!hasNaNPoints) {
    const computed = strokeBoundingBox(stroke.points, stroke.width);
    const b = stroke.bounds;
    const eps = 1e-6;
    if (
      Math.abs(b.x - computed.x) > eps ||
      Math.abs(b.y - computed.y) > eps ||
      Math.abs(b.width - computed.width) > eps ||
      Math.abs(b.height - computed.height) > eps
    ) {
      issues.push({
        severity: 'error',
        code: 'STROKE_BOUNDS_MISMATCH',
        message: `Stored bounds (${b.x}, ${b.y}, ${b.width}, ${b.height}) differ from computed (${computed.x}, ${computed.y}, ${computed.width}, ${computed.height})`,
      });
    }
  }

  // Check empty ID
  if (!stroke.id || stroke.id.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'STROKE_EMPTY_ID',
      message: 'Stroke has empty ID',
    });
  }

  return { valid: issues.every((i) => i.severity !== 'error'), issues };
}

// =============================================================================
// Spatial Index Validation
// =============================================================================

/**
 * Validate a spatial index for common issues.
 *
 * Checks performed:
 * - Empty index (info)
 * - Bounds consistency (all entries have valid bounds)
 * - Duplicate IDs (should not occur)
 */
export function validateSpatialIndex<T>(index: SpatialIndex<T>): DiagnosticResult {
  const issues: DiagnosticIssue[] = [];

  if (index.size() === 0) {
    issues.push({
      severity: 'info',
      code: 'INDEX_EMPTY',
      message: 'Spatial index is empty',
    });
    return { valid: true, issues };
  }

  const allEntries = index.all();
  const seenIds = new Set<string>();

  for (const entry of allEntries) {
    // Check for duplicate IDs
    if (seenIds.has(entry.id)) {
      issues.push({
        severity: 'error',
        code: 'INDEX_DUPLICATE_ID',
        message: `Duplicate ID in spatial index: ${entry.id}`,
      });
    }
    seenIds.add(entry.id);

    // Check bounds validity
    const b = entry.bounds;
    if (
      !Number.isFinite(b.x) ||
      !Number.isFinite(b.y) ||
      !Number.isFinite(b.width) ||
      !Number.isFinite(b.height)
    ) {
      issues.push({
        severity: 'error',
        code: 'INDEX_NAN_BOUNDS',
        message: `Entry ${entry.id} has non-finite bounds`,
      });
    }

    if (b.width < 0 || b.height < 0) {
      issues.push({
        severity: 'error',
        code: 'INDEX_NEGATIVE_BOUNDS',
        message: `Entry ${entry.id} has negative bounds dimensions: (${b.width}, ${b.height})`,
      });
    }
  }

  return { valid: issues.every((i) => i.severity !== 'error'), issues };
}
