/**
 * Slant warp presets.
 *
 * textSlantUp, textSlantDown
 *
 * Linear slant transforms where one side is higher than the other.
 * The adjustment controls the slant angle.
 */
import { PathOps } from '@mog/geometry';
import type { Path } from '@mog-sdk/contracts/geometry';
import type { WarpPreset } from './types';

export const textSlantUp: WarpPreset = {
  name: 'textSlantUp',
  topGuide(width: number, height: number, adj: number): Path {
    const rise = height * adj * 0.5;
    return PathOps.createPath().moveTo(0, rise).lineTo(width, 0).toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const rise = height * adj * 0.5;
    return PathOps.createPath()
      .moveTo(0, height)
      .lineTo(width, height - rise)
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textSlantDown: WarpPreset = {
  name: 'textSlantDown',
  topGuide(width: number, height: number, adj: number): Path {
    const rise = height * adj * 0.5;
    return PathOps.createPath().moveTo(0, 0).lineTo(width, rise).toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const rise = height * adj * 0.5;
    return PathOps.createPath()
      .moveTo(0, height - rise)
      .lineTo(width, height)
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};
