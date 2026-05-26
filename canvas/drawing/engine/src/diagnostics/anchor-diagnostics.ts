/**
 * Anchor Diagnostics
 *
 * Trace anchor resolution step-by-step for debugging.
 */

import type { BoundingBox } from '@mog-sdk/contracts/geometry';

import { resolveAnchor, resolveAnchorPoint } from '../anchor/anchor-resolver';
import type { Anchor, CellDimensionLookup } from '../anchor/anchor-types';

// =============================================================================
// TYPES
// =============================================================================

/**
 * A single step in anchor resolution tracing.
 */
export interface ResolutionStep {
  /** Description of this step */
  description: string;
  /** The value at this step */
  value: unknown;
}

/**
 * Full anchor resolution trace.
 */
export interface AnchorTrace {
  /** The input anchor */
  anchor: Anchor;
  /** The resolved bounding box */
  resolved: BoundingBox;
  /** Step-by-step trace */
  steps: ResolutionStep[];
}

// =============================================================================
// TRACING
// =============================================================================

/**
 * Trace anchor resolution step-by-step.
 *
 * @param anchor - Anchor to trace
 * @param dims - Cell dimension lookup
 * @returns Complete trace with steps
 */
export function traceAnchorResolution(anchor: Anchor, dims: CellDimensionLookup): AnchorTrace {
  const steps: ResolutionStep[] = [];

  steps.push({
    description: 'Input anchor',
    value: anchor,
  });

  steps.push({
    description: 'Anchor type',
    value: anchor.type,
  });

  switch (anchor.type) {
    case 'absolute': {
      steps.push({
        description: 'Absolute position (no cell resolution needed)',
        value: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height },
      });
      break;
    }

    case 'oneCell': {
      steps.push({
        description: 'From anchor point',
        value: anchor.from,
      });

      const colLeft = dims.getColLeft(anchor.from.col);
      const rowTop = dims.getRowTop(anchor.from.row);

      steps.push({
        description: `Cell (${anchor.from.row}, ${anchor.from.col}) position`,
        value: { colLeft, rowTop },
      });

      const fromPixel = resolveAnchorPoint(anchor.from, dims);
      steps.push({
        description: 'Resolved from position (cell + offset)',
        value: fromPixel,
      });

      steps.push({
        description: 'Object dimensions',
        value: { width: anchor.width, height: anchor.height },
      });
      break;
    }

    case 'twoCell': {
      steps.push({
        description: 'From anchor point',
        value: anchor.from,
      });

      const fromPixel = resolveAnchorPoint(anchor.from, dims);
      steps.push({
        description: 'Resolved from position',
        value: fromPixel,
      });

      steps.push({
        description: 'To anchor point',
        value: anchor.to,
      });

      const toPixel = resolveAnchorPoint(anchor.to, dims);
      steps.push({
        description: 'Resolved to position',
        value: toPixel,
      });

      steps.push({
        description: 'Computed dimensions',
        value: { width: toPixel.x - fromPixel.x, height: toPixel.y - fromPixel.y },
      });
      break;
    }
  }

  const resolved = resolveAnchor(anchor, dims);
  steps.push({
    description: 'Final resolved bounds',
    value: resolved,
  });

  return { anchor, resolved, steps };
}
