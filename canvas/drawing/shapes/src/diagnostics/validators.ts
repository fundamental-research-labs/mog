/**
 * Shape validation diagnostics.
 */
import { PathOps } from '@mog/geometry';
import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import type { ShapeAdjustment } from '../presets/registry';
import { generateShapePath, isValidShapeType } from '../shape-to-path';

export interface DiagnosticIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface ShapeValidationResult {
  valid: boolean;
  issues: DiagnosticIssue[];
  geometry?: {
    pathLength: number;
    pointCount: number;
    boundingBox: BoundingBox;
  };
}

/**
 * Validate shape data.
 *
 * Checks that the shape type exists, adjustments are within valid ranges,
 * and the generated path is non-degenerate.
 */
export function validateShape(data: {
  shapeType: string;
  width?: number;
  height?: number;
  adjustments?: ShapeAdjustment[];
}): ShapeValidationResult {
  const issues: DiagnosticIssue[] = [];
  const { shapeType, width = 100, height = 100, adjustments } = data;

  // Check shape type
  if (!isValidShapeType(shapeType)) {
    issues.push({
      code: 'SHAPE_PRESET_UNKNOWN',
      severity: 'error',
      message: `Shape preset "${shapeType}" is not registered in the catalog.`,
    });
    return { valid: false, issues };
  }

  // Check dimensions
  if (width <= 0 || height <= 0) {
    issues.push({
      code: 'SHAPE_DIMENSIONS_INVALID',
      severity: 'error',
      message: `Shape dimensions must be positive (got ${width}x${height}).`,
    });
  }

  // Check adjustments
  if (adjustments) {
    for (const adj of adjustments) {
      if (adj.min !== undefined && adj.value < adj.min) {
        issues.push({
          code: 'SHAPE_ADJUSTMENT_OOB',
          severity: 'warning',
          message: `Adjustment "${adj.name}" value ${adj.value} is below min ${adj.min}.`,
        });
      }
      if (adj.max !== undefined && adj.value > adj.max) {
        issues.push({
          code: 'SHAPE_ADJUSTMENT_OOB',
          severity: 'warning',
          message: `Adjustment "${adj.name}" value ${adj.value} is above max ${adj.max}.`,
        });
      }
      if (isNaN(adj.value)) {
        issues.push({
          code: 'SHAPE_ADJUSTMENT_NAN',
          severity: 'error',
          message: `Adjustment "${adj.name}" has NaN value.`,
        });
      }
    }
  }

  // Try generating the path
  try {
    const path = generateShapePath(shapeType, width, height, adjustments);

    // Check for empty path
    if (path.segments.length === 0) {
      issues.push({
        code: 'SHAPE_PATH_EMPTY',
        severity: 'error',
        message: 'Generated path has no segments.',
      });
      return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
    }

    // Compute geometry metrics
    const pathLength = PathOps.pathLength(path);
    const boundingBox = PathOps.pathBoundingBox(path);
    let pointCount = 0;
    for (const seg of path.segments) {
      if (seg.type !== 'Z') pointCount++;
    }

    // Check for degenerate path
    if (boundingBox.width === 0 && boundingBox.height === 0) {
      issues.push({
        code: 'SHAPE_PATH_DEGENERATE',
        severity: 'warning',
        message: 'Generated path has zero area (all points coincident).',
      });
    }

    // Check for NaN in path
    for (const seg of path.segments) {
      if (seg.type === 'Z') continue;
      if (isNaN(seg.x) || isNaN(seg.y)) {
        issues.push({
          code: 'SHAPE_PATH_NAN',
          severity: 'error',
          message: `Path contains NaN coordinates in ${seg.type} segment.`,
        });
        break;
      }
      if (seg.type === 'C' && (isNaN(seg.x1) || isNaN(seg.y1) || isNaN(seg.x2) || isNaN(seg.y2))) {
        issues.push({
          code: 'SHAPE_PATH_NAN',
          severity: 'error',
          message: 'Path contains NaN control point coordinates in C segment.',
        });
        break;
      }
      if (seg.type === 'Q' && (isNaN(seg.x1) || isNaN(seg.y1))) {
        issues.push({
          code: 'SHAPE_PATH_NAN',
          severity: 'error',
          message: 'Path contains NaN control point coordinates in Q segment.',
        });
        break;
      }
    }

    const valid = issues.filter((i) => i.severity === 'error').length === 0;
    return {
      valid,
      issues,
      geometry: { pathLength, pointCount, boundingBox },
    };
  } catch (err) {
    issues.push({
      code: 'SHAPE_GENERATION_ERROR',
      severity: 'error',
      message: `Failed to generate path: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { valid: false, issues };
  }
}
