/**
 * Cascade warp presets.
 *
 * textCascadeUp, textCascadeDown
 *
 * Stepped cascade transforms where text steps up or down.
 * The adjustment controls the step height.
 */
import { PathOps } from '@mog/geometry';
import type { Path } from '@mog-sdk/contracts/geometry';
import type { WarpPreset } from './types';

export const textCascadeUp: WarpPreset = {
  name: 'textCascadeUp',
  topGuide(width: number, height: number, adj: number): Path {
    const step = height * adj * 0.6;
    const hw = width / 2;
    return PathOps.createPath()
      .moveTo(0, step)
      .lineTo(hw, step)
      .lineTo(hw, 0)
      .lineTo(width, 0)
      .toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const step = height * adj * 0.6;
    const hw = width / 2;
    return PathOps.createPath()
      .moveTo(0, height)
      .lineTo(hw, height)
      .lineTo(hw, height - step)
      .lineTo(width, height - step)
      .toPath();
  },
  defaultAdjustment: 0.4,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textCascadeDown: WarpPreset = {
  name: 'textCascadeDown',
  topGuide(width: number, height: number, adj: number): Path {
    const step = height * adj * 0.6;
    const hw = width / 2;
    return PathOps.createPath()
      .moveTo(0, 0)
      .lineTo(hw, 0)
      .lineTo(hw, step)
      .lineTo(width, step)
      .toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const step = height * adj * 0.6;
    const hw = width / 2;
    return PathOps.createPath()
      .moveTo(0, height - step)
      .lineTo(hw, height - step)
      .lineTo(hw, height)
      .lineTo(width, height)
      .toPath();
  },
  defaultAdjustment: 0.4,
  minAdjustment: 0,
  maxAdjustment: 1,
};
