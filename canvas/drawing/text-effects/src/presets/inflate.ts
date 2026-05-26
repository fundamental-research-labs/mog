/**
 * Inflate/deflate warp presets.
 *
 * textInflate, textDeflate, textInflateBottom, textInflateTop,
 * textDeflateBottom, textDeflateTop, textDeflateInflate, textDeflateInflateDeflate,
 * textCanUp, textCanDown
 *
 * Paths that bulge outward (inflate) or pinch inward (deflate).
 * The adjustment controls the bulge amount.
 */
import { PathOps } from '@mog/geometry';
import type { Path } from '@mog-sdk/contracts/geometry';
import type { WarpPreset } from './types';

/**
 * Generate a path that bulges at the center.
 * @param width Path width
 * @param yBase Base Y value
 * @param bulge Amount of bulge (positive = downward, negative = upward)
 */
function bulgePath(width: number, yBase: number, bulge: number): Path {
  const hw = width / 2;
  return PathOps.createPath()
    .moveTo(0, yBase)
    .curveTo(hw * 0.5, yBase + bulge, hw * 1.5, yBase + bulge, width, yBase)
    .toPath();
}

export const textInflate: WarpPreset = {
  name: 'textInflate',
  topGuide(width: number, height: number, adj: number): Path {
    const bulge = -height * adj * 0.4;
    return bulgePath(width, 0, bulge);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const bulge = height * adj * 0.4;
    return bulgePath(width, height, bulge);
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textDeflate: WarpPreset = {
  name: 'textDeflate',
  topGuide(width: number, height: number, adj: number): Path {
    const bulge = height * adj * 0.4;
    return bulgePath(width, 0, bulge);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const bulge = -height * adj * 0.4;
    return bulgePath(width, height, bulge);
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textInflateBottom: WarpPreset = {
  name: 'textInflateBottom',
  topGuide(width: number, _height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, 0).lineTo(width, 0).toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const bulge = height * adj * 0.5;
    return bulgePath(width, height, bulge);
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textInflateTop: WarpPreset = {
  name: 'textInflateTop',
  topGuide(width: number, height: number, adj: number): Path {
    const bulge = -height * adj * 0.5;
    return bulgePath(width, 0, bulge);
  },
  bottomGuide(width: number, height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, height).lineTo(width, height).toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textDeflateBottom: WarpPreset = {
  name: 'textDeflateBottom',
  topGuide(width: number, _height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, 0).lineTo(width, 0).toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const bulge = -height * adj * 0.4;
    return bulgePath(width, height, bulge);
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textDeflateTop: WarpPreset = {
  name: 'textDeflateTop',
  topGuide(width: number, height: number, adj: number): Path {
    const bulge = height * adj * 0.4;
    return bulgePath(width, 0, bulge);
  },
  bottomGuide(width: number, height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, height).lineTo(width, height).toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textDeflateInflate: WarpPreset = {
  name: 'textDeflateInflate',
  topGuide(width: number, _height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, 0).lineTo(width, 0).toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    // Bottom path: deflate on sides, inflate in center
    const hw = width / 2;
    const bulge = height * adj * 0.4;
    return PathOps.createPath()
      .moveTo(0, height)
      .curveTo(hw * 0.3, height - bulge, hw * 0.7, height - bulge, hw, height)
      .curveTo(hw + hw * 0.3, height + bulge, hw + hw * 0.7, height + bulge, width, height)
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textDeflateInflateDeflate: WarpPreset = {
  name: 'textDeflateInflateDeflate',
  topGuide(width: number, _height: number, _adj: number): Path {
    return PathOps.createPath().moveTo(0, 0).lineTo(width, 0).toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    // Bottom: deflate-inflate-deflate pattern (3 sections)
    const third = width / 3;
    const bulge = height * adj * 0.35;
    return PathOps.createPath()
      .moveTo(0, height)
      .curveTo(third * 0.3, height - bulge, third * 0.7, height - bulge, third, height)
      .curveTo(
        third + third * 0.3,
        height + bulge,
        third + third * 0.7,
        height + bulge,
        2 * third,
        height,
      )
      .curveTo(
        2 * third + third * 0.3,
        height - bulge,
        2 * third + third * 0.7,
        height - bulge,
        width,
        height,
      )
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textCanUp: WarpPreset = {
  name: 'textCanUp',
  topGuide(width: number, height: number, adj: number): Path {
    // Can shape: top curves up like a cylinder top
    const arcH = height * adj * 0.3;
    return PathOps.createPath()
      .moveTo(0, 0)
      .curveTo(width * 0.25, -arcH, width * 0.75, -arcH, width, 0)
      .toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj * 0.15;
    return PathOps.createPath()
      .moveTo(0, height)
      .curveTo(width * 0.25, height - arcH, width * 0.75, height - arcH, width, height)
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textCanDown: WarpPreset = {
  name: 'textCanDown',
  topGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj * 0.15;
    return PathOps.createPath()
      .moveTo(0, 0)
      .curveTo(width * 0.25, arcH, width * 0.75, arcH, width, 0)
      .toPath();
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const arcH = height * adj * 0.3;
    return PathOps.createPath()
      .moveTo(0, height)
      .curveTo(width * 0.25, height + arcH, width * 0.75, height + arcH, width, height)
      .toPath();
  },
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};
