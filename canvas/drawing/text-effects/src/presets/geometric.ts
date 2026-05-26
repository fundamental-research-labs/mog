/**
 * Additional geometric warp presets.
 *
 * textTriangle, textTriangleInverted, textChevron, textChevronInverted,
 * textRingInside, textRingOutside, textStop, textPlain, textNoShape
 *
 * These presets use linear or simple curved guide paths to create
 * various geometric text warp effects.
 */
import { PathOps } from '@mog/geometry';
import type { Path } from '@mog-sdk/contracts/geometry';
import type { WarpPreset } from './types';

export const textTriangle: WarpPreset = {
  name: 'textTriangle',
  topGuide(width: number, height: number, adj: number): Path {
    // Top pinches to a point at center
    const hw = width / 2;
    const pinch = height * adj * 0.4;
    return PathOps.createPath().moveTo(0, pinch).lineTo(hw, 0).lineTo(width, pinch).toPath();
  },
  bottomGuide(width: number, height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, height).lineTo(width, height).toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textTriangleInverted: WarpPreset = {
  name: 'textTriangleInverted',
  topGuide(width: number, _height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, 0).lineTo(width, 0).toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const hw = width / 2;
    const pinch = height * adj * 0.4;
    return PathOps.createPath()
      .moveTo(0, height - pinch)
      .lineTo(hw, height)
      .lineTo(width, height - pinch)
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textChevron: WarpPreset = {
  name: 'textChevron',
  topGuide(width: number, height: number, adj: number): Path {
    const hw = width / 2;
    const peak = height * adj * 0.4;
    return PathOps.createPath().moveTo(0, peak).lineTo(hw, 0).lineTo(width, peak).toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const hw = width / 2;
    const peak = height * adj * 0.4;
    return PathOps.createPath()
      .moveTo(0, height)
      .lineTo(hw, height - peak)
      .lineTo(width, height)
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textChevronInverted: WarpPreset = {
  name: 'textChevronInverted',
  topGuide(width: number, height: number, adj: number): Path {
    const hw = width / 2;
    const valley = height * adj * 0.4;
    return PathOps.createPath().moveTo(0, 0).lineTo(hw, valley).lineTo(width, 0).toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const hw = width / 2;
    const valley = height * adj * 0.4;
    return PathOps.createPath()
      .moveTo(0, height - valley)
      .lineTo(hw, height)
      .lineTo(width, height - valley)
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textRingInside: WarpPreset = {
  name: 'textRingInside',
  topGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj * 0.6;
    const kappa = 0.5522847498;
    return PathOps.createPath()
      .moveTo(0, 0)
      .curveTo(width * kappa * 0.5, -arcH, width - width * kappa * 0.5, -arcH, width, 0)
      .toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj * 0.3;
    const kappa = 0.5522847498;
    return PathOps.createPath()
      .moveTo(0, height)
      .curveTo(
        width * kappa * 0.5,
        height + arcH,
        width - width * kappa * 0.5,
        height + arcH,
        width,
        height,
      )
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textRingOutside: WarpPreset = {
  name: 'textRingOutside',
  topGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj * 0.3;
    const kappa = 0.5522847498;
    return PathOps.createPath()
      .moveTo(0, 0)
      .curveTo(width * kappa * 0.5, arcH, width - width * kappa * 0.5, arcH, width, 0)
      .toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj * 0.6;
    const kappa = 0.5522847498;
    return PathOps.createPath()
      .moveTo(0, height)
      .curveTo(
        width * kappa * 0.5,
        height - arcH,
        width - width * kappa * 0.5,
        height - arcH,
        width,
        height,
      )
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textStop: WarpPreset = {
  name: 'textStop',
  topGuide(width: number, _height: number, adj: number): Path {
    // Octagonal stop-sign shape top edge
    const inset = width * adj * 0.2;
    return PathOps.createPath()
      .moveTo(inset, 0)
      .lineTo(width - inset, 0)
      .toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const inset = width * adj * 0.2;
    return PathOps.createPath()
      .moveTo(inset, height)
      .lineTo(width - inset, height)
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textPlain: WarpPreset = {
  name: 'textPlain',
  topGuide(width: number, _height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, 0).lineTo(width, 0).toPath();
  },
  bottomGuide(width: number, height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, height).lineTo(width, height).toPath();
  },
  defaultAdjustment: 0,
  minAdjustment: 0,
  maxAdjustment: 0,
};

export const textNoShape: WarpPreset = {
  name: 'textNoShape',
  topGuide(width: number, _height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, 0).lineTo(width, 0).toPath();
  },
  bottomGuide(width: number, height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, height).lineTo(width, height).toPath();
  },
  defaultAdjustment: 0,
  minAdjustment: 0,
  maxAdjustment: 0,
};
