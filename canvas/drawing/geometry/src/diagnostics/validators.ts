/**
 * Diagnostic validators for geometry primitives.
 *
 * Detect NaN, degenerate paths, singular matrices, and other issues
 * that could cause rendering or computation problems.
 */
import type { AffineTransform, BoundingBox, Path } from '@mog-sdk/contracts/geometry';
import { determinant } from '../matrix';

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

// ─── Path Validation ─────────────────────────────────────────────────────────

/** Validate a path for common issues. */
export function validatePath(path: Path): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (path.segments.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'PATH_EMPTY',
      message: 'Path has no segments',
    });
    return { valid: issues.every((i) => i.severity !== 'error'), issues };
  }

  // Check for NaN in coordinates
  for (let i = 0; i < path.segments.length; i++) {
    const seg = path.segments[i];
    switch (seg.type) {
      case 'M':
      case 'L':
        if (!isFinite(seg.x) || !isFinite(seg.y)) {
          issues.push({
            severity: 'error',
            code: 'PATH_NAN_COORDINATE',
            message: `Segment ${i} (${seg.type}) has non-finite coordinate: (${seg.x}, ${seg.y})`,
          });
        }
        break;
      case 'C':
        if (
          !isFinite(seg.x1) ||
          !isFinite(seg.y1) ||
          !isFinite(seg.x2) ||
          !isFinite(seg.y2) ||
          !isFinite(seg.x) ||
          !isFinite(seg.y)
        ) {
          issues.push({
            severity: 'error',
            code: 'PATH_NAN_COORDINATE',
            message: `Segment ${i} (C) has non-finite coordinate`,
          });
        }
        break;
      case 'Q':
        if (!isFinite(seg.x1) || !isFinite(seg.y1) || !isFinite(seg.x) || !isFinite(seg.y)) {
          issues.push({
            severity: 'error',
            code: 'PATH_NAN_COORDINATE',
            message: `Segment ${i} (Q) has non-finite coordinate`,
          });
        }
        break;
    }
  }

  // Check that path starts with a MoveTo
  if (path.segments[0].type !== 'M') {
    issues.push({
      severity: 'warning',
      code: 'PATH_NO_MOVETO',
      message: 'Path does not begin with a MoveTo command',
    });
  }

  // Check for zero-length line segments
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < path.segments.length; i++) {
    const seg = path.segments[i];
    if (seg.type === 'M') {
      prevX = seg.x;
      prevY = seg.y;
    } else if (seg.type === 'L') {
      const dx = seg.x - prevX;
      const dy = seg.y - prevY;
      if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) {
        issues.push({
          severity: 'info',
          code: 'PATH_ZERO_LENGTH_SEGMENT',
          message: `Segment ${i} (L) has zero length`,
        });
      }
      prevX = seg.x;
      prevY = seg.y;
    } else if (seg.type === 'C') {
      prevX = seg.x;
      prevY = seg.y;
    } else if (seg.type === 'Q') {
      prevX = seg.x;
      prevY = seg.y;
    }
  }

  // Check for closed flag consistency
  const hasCloseCmd = path.segments.some((s) => s.type === 'Z');
  if (path.closed && !hasCloseCmd) {
    issues.push({
      severity: 'info',
      code: 'PATH_CLOSED_NO_Z',
      message: 'Path is marked closed but has no Z command',
    });
  }

  return { valid: issues.every((i) => i.severity !== 'error'), issues };
}

// ─── Transform Validation ────────────────────────────────────────────────────

/** Validate an affine transform for common issues. */
export function validateTransform(matrix: AffineTransform): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Check for NaN
  const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty];
  for (let i = 0; i < values.length; i++) {
    if (!isFinite(values[i])) {
      const names = ['a', 'b', 'c', 'd', 'tx', 'ty'];
      issues.push({
        severity: 'error',
        code: 'TRANSFORM_NAN',
        message: `Transform component '${names[i]}' is non-finite: ${values[i]}`,
      });
    }
  }

  // Check for singular matrix
  const det = determinant(matrix);
  if (Math.abs(det) < 1e-12) {
    issues.push({
      severity: 'error',
      code: 'TRANSFORM_SINGULAR',
      message: `Transform matrix is singular (determinant = ${det})`,
    });
  }

  // Check for extreme values
  const EXTREME_THRESHOLD = 1e6;
  for (let i = 0; i < values.length; i++) {
    if (Math.abs(values[i]) > EXTREME_THRESHOLD) {
      const names = ['a', 'b', 'c', 'd', 'tx', 'ty'];
      issues.push({
        severity: 'warning',
        code: 'TRANSFORM_EXTREME',
        message: `Transform component '${names[i]}' has extreme value: ${values[i]}`,
      });
    }
  }

  return { valid: issues.every((i) => i.severity !== 'error'), issues };
}

// ─── Bounding Box Validation ─────────────────────────────────────────────────

/** Validate a bounding box for common issues. */
export function validateBoundingBox(box: BoundingBox): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Check for NaN
  if (!isFinite(box.x) || !isFinite(box.y) || !isFinite(box.width) || !isFinite(box.height)) {
    issues.push({
      severity: 'error',
      code: 'BBOX_NAN',
      message: `BoundingBox has non-finite values: (${box.x}, ${box.y}, ${box.width}, ${box.height})`,
    });
  }

  // Check for negative dimensions
  if (box.width < 0) {
    issues.push({
      severity: 'error',
      code: 'BBOX_NEGATIVE_WIDTH',
      message: `BoundingBox has negative width: ${box.width}`,
    });
  }
  if (box.height < 0) {
    issues.push({
      severity: 'error',
      code: 'BBOX_NEGATIVE_HEIGHT',
      message: `BoundingBox has negative height: ${box.height}`,
    });
  }

  // Check for zero dimensions
  if (box.width === 0 && box.height === 0) {
    issues.push({
      severity: 'info',
      code: 'BBOX_ZERO_AREA',
      message: 'BoundingBox has zero area (point)',
    });
  } else if (box.width === 0) {
    issues.push({
      severity: 'info',
      code: 'BBOX_ZERO_WIDTH',
      message: 'BoundingBox has zero width (vertical line)',
    });
  } else if (box.height === 0) {
    issues.push({
      severity: 'info',
      code: 'BBOX_ZERO_HEIGHT',
      message: 'BoundingBox has zero height (horizontal line)',
    });
  }

  // Check for extreme values
  const EXTREME_THRESHOLD = 1e8;
  if (
    Math.abs(box.x) > EXTREME_THRESHOLD ||
    Math.abs(box.y) > EXTREME_THRESHOLD ||
    box.width > EXTREME_THRESHOLD ||
    box.height > EXTREME_THRESHOLD
  ) {
    issues.push({
      severity: 'warning',
      code: 'BBOX_EXTREME',
      message: `BoundingBox has extreme values`,
    });
  }

  return { valid: issues.every((i) => i.severity !== 'error'), issues };
}
