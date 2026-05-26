/**
 * Arc-based warp presets.
 *
 * textArchUp, textArchDown, textCircle, textButton,
 * textArchUpPour, textArchDownPour, textCirclePour, textButtonPour
 *
 * These presets generate arc guide paths. The adjustment controls
 * the arc height/curvature.
 */
import { PathOps } from '@mog/geometry';
import type { Path } from '@mog-sdk/contracts/geometry';
import type { WarpPreset } from './types';

/**
 * Generate a semi-circular arc path from (0,0) to (width, 0)
 * with the arc peaking at the given height (positive = upward).
 */
function arcPath(width: number, arcHeight: number): Path {
  // Use a cubic bezier approximation of a circular arc.
  // For a semi-circle, the control point distance is ~0.5522847498 * radius.
  const kappa = 0.5522847498;
  const halfW = width / 2;

  if (Math.abs(arcHeight) < 0.001) {
    // Degenerate: straight line
    return PathOps.createPath().moveTo(0, 0).lineTo(width, 0).toPath();
  }

  const cpOffset = halfW * kappa;

  return PathOps.createPath()
    .moveTo(0, 0)
    .curveTo(cpOffset, -arcHeight * 1.333, width - cpOffset, -arcHeight * 1.333, width, 0)
    .toPath();
}

export const textArchUp: WarpPreset = {
  name: 'textArchUp',
  topGuide(width: number, _height: number, adj: number): Path {
    const arcH = _height * adj;
    return arcPath(width, arcH);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj * 0.5;
    const builder = PathOps.createPath()
      .moveTo(0, height)
      .curveTo(
        width * 0.5522847498,
        height - arcH * 1.333,
        width - width * 0.5522847498,
        height - arcH * 1.333,
        width,
        height,
      );
    return builder.toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textArchDown: WarpPreset = {
  name: 'textArchDown',
  topGuide(width: number, height: number, adj: number): Path {
    const arcH = -height * adj * 0.5;
    return arcPath(width, arcH);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const arcH = -height * adj;
    const builder = PathOps.createPath()
      .moveTo(0, height)
      .curveTo(
        width * 0.5522847498,
        height + arcH * 1.333,
        width - width * 0.5522847498,
        height + arcH * 1.333,
        width,
        height,
      );
    return builder.toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textCircle: WarpPreset = {
  name: 'textCircle',
  topGuide(width: number, height: number, adj: number): Path {
    // Top semicircle arc
    const arcH = height * adj;
    return arcPath(width, arcH);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    // Bottom follows opposite arc
    const arcH = -height * adj;
    const builder = PathOps.createPath()
      .moveTo(0, height)
      .curveTo(
        width * 0.5522847498,
        height - arcH * 1.333,
        width - width * 0.5522847498,
        height - arcH * 1.333,
        width,
        height,
      );
    return builder.toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textButton: WarpPreset = {
  name: 'textButton',
  topGuide(width: number, height: number, adj: number): Path {
    // Button: both top and bottom curve inward
    const arcH = height * adj * 0.4;
    return arcPath(width, arcH);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj * 0.4;
    const builder = PathOps.createPath()
      .moveTo(0, height)
      .curveTo(
        width * 0.5522847498,
        height + arcH * 1.333,
        width - width * 0.5522847498,
        height + arcH * 1.333,
        width,
        height,
      );
    return builder.toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

// Pour variants — wider inner space for multi-line text

export const textArchUpPour: WarpPreset = {
  name: 'textArchUpPour',
  topGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj;
    return arcPath(width, arcH);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const innerArc = height * adj * 0.3;
    const builder = PathOps.createPath()
      .moveTo(0, height)
      .curveTo(
        width * 0.5522847498,
        height - innerArc * 1.333,
        width - width * 0.5522847498,
        height - innerArc * 1.333,
        width,
        height,
      );
    return builder.toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textArchDownPour: WarpPreset = {
  name: 'textArchDownPour',
  topGuide(width: number, height: number, adj: number): Path {
    const arcH = -height * adj * 0.3;
    return arcPath(width, arcH);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const arcH = -height * adj;
    const builder = PathOps.createPath()
      .moveTo(0, height)
      .curveTo(
        width * 0.5522847498,
        height + arcH * 1.333,
        width - width * 0.5522847498,
        height + arcH * 1.333,
        width,
        height,
      );
    return builder.toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textCirclePour: WarpPreset = {
  name: 'textCirclePour',
  topGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj;
    return arcPath(width, arcH);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const arcH = -height * adj * 0.6;
    const builder = PathOps.createPath()
      .moveTo(0, height)
      .curveTo(
        width * 0.5522847498,
        height - arcH * 1.333,
        width - width * 0.5522847498,
        height - arcH * 1.333,
        width,
        height,
      );
    return builder.toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textButtonPour: WarpPreset = {
  name: 'textButtonPour',
  topGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj * 0.3;
    return arcPath(width, arcH);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj * 0.3;
    const builder = PathOps.createPath()
      .moveTo(0, height)
      .curveTo(
        width * 0.5522847498,
        height + arcH * 1.333,
        width - width * 0.5522847498,
        height + arcH * 1.333,
        width,
        height,
      );
    return builder.toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};
