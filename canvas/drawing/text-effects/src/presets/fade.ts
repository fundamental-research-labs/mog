/**
 * Fade warp presets.
 *
 * textFadeRight, textFadeLeft, textFadeUp, textFadeDown
 *
 * Perspective-like fade effects where text shrinks toward one side.
 * The adjustment controls the amount of perspective fade.
 */
import { PathOps } from '@mog/geometry';
import type { Path } from '@mog-sdk/contracts/geometry';
import type { WarpPreset } from './types';

export const textFadeRight: WarpPreset = {
  name: 'textFadeRight',
  topGuide(width: number, height: number, adj: number): Path {
    // Top edge: starts at (0, 0), ends at (width, height * adj * 0.5)
    const fadeAmount = height * adj * 0.5;
    return PathOps.createPath().moveTo(0, 0).lineTo(width, fadeAmount).toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const fadeAmount = height * adj * 0.5;
    return PathOps.createPath()
      .moveTo(0, height)
      .lineTo(width, height - fadeAmount)
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textFadeLeft: WarpPreset = {
  name: 'textFadeLeft',
  topGuide(width: number, height: number, adj: number): Path {
    const fadeAmount = height * adj * 0.5;
    return PathOps.createPath().moveTo(0, fadeAmount).lineTo(width, 0).toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const fadeAmount = height * adj * 0.5;
    return PathOps.createPath()
      .moveTo(0, height - fadeAmount)
      .lineTo(width, height)
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textFadeUp: WarpPreset = {
  name: 'textFadeUp',
  topGuide(width: number, _height: number, adj: number): Path {
    // Text narrows at the top
    const inset = width * adj * 0.4;
    return PathOps.createPath()
      .moveTo(inset, 0)
      .lineTo(width - inset, 0)
      .toPath();
  },
  bottomGuide(width: number, height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, height).lineTo(width, height).toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textFadeDown: WarpPreset = {
  name: 'textFadeDown',
  topGuide(width: number, _height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, 0).lineTo(width, 0).toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const inset = width * adj * 0.4;
    return PathOps.createPath()
      .moveTo(inset, height)
      .lineTo(width - inset, height)
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};
