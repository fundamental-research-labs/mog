/**
 * Curve warp presets.
 *
 * textCurveUp, textCurveDown
 *
 * Simple Bezier curve transforms where text follows an upward or downward arc.
 * The adjustment controls the curve intensity.
 */
import { PathOps } from '@mog/geometry';
import type { Path } from '@mog-sdk/contracts/geometry';
import type { WarpPreset } from './types';

export const textCurveUp: WarpPreset = {
  name: 'textCurveUp',
  topGuide(width: number, height: number, adj: number): Path {
    const curveHeight = height * adj * 0.5;
    return PathOps.createPath()
      .moveTo(0, curveHeight)
      .curveTo(width * 0.25, -curveHeight, width * 0.75, -curveHeight, width, curveHeight)
      .toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const curveHeight = height * adj * 0.25;
    return PathOps.createPath()
      .moveTo(0, height)
      .curveTo(
        width * 0.25,
        height - curveHeight * 2,
        width * 0.75,
        height - curveHeight * 2,
        width,
        height,
      )
      .toPath();
  },
  defaultAdjustment: 0.45,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textCurveDown: WarpPreset = {
  name: 'textCurveDown',
  topGuide(width: number, height: number, adj: number): Path {
    const curveHeight = height * adj * 0.25;
    return PathOps.createPath()
      .moveTo(0, 0)
      .curveTo(width * 0.25, curveHeight * 2, width * 0.75, curveHeight * 2, width, 0)
      .toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const curveHeight = height * adj * 0.5;
    return PathOps.createPath()
      .moveTo(0, height - curveHeight)
      .curveTo(
        width * 0.25,
        height + curveHeight,
        width * 0.75,
        height + curveHeight,
        width,
        height - curveHeight,
      )
      .toPath();
  },
  defaultAdjustment: 0.45,
  minAdjustment: 0,
  maxAdjustment: 1,
};
