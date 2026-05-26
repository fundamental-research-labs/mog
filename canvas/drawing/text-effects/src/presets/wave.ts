/**
 * Wave-based warp presets.
 *
 * textWave1, textWave2, textWave4, textDoubleWave1
 *
 * Sinusoidal guide paths. The adjustment controls the wave amplitude.
 */
import { PathOps } from '@mog/geometry';
import type { Path } from '@mog-sdk/contracts/geometry';
import type { WarpPreset } from './types';

/**
 * Generate a single sine-wave path across the given width.
 * @param width Total width
 * @param yBase Base Y coordinate
 * @param amplitude Wave amplitude
 * @param periods Number of full periods across the width
 * @param phaseShift Phase shift in radians
 */
function sinePath(
  width: number,
  yBase: number,
  amplitude: number,
  periods: number,
  phaseShift: number = 0,
): Path {
  // Approximate sine wave with cubic bezier segments.
  // Each half-period uses one bezier segment.
  const segments = periods * 2; // two bezier segments per period
  const segWidth = width / segments;
  const builder = PathOps.createPath();

  const startY = yBase + amplitude * Math.sin(phaseShift);
  builder.moveTo(0, startY);

  for (let i = 0; i < segments; i++) {
    const x0 = i * segWidth;
    const x1 = (i + 1) * segWidth;
    const angle0 = phaseShift + (i / segments) * periods * 2 * Math.PI;
    const angle1 = phaseShift + ((i + 1) / segments) * periods * 2 * Math.PI;

    const y0 = yBase + amplitude * Math.sin(angle0);
    const y1 = yBase + amplitude * Math.sin(angle1);

    // Derivative-based control points for smooth bezier approximation
    const dydx0 = amplitude * Math.cos(angle0) * ((periods * 2 * Math.PI) / width);
    const dydx1 = amplitude * Math.cos(angle1) * ((periods * 2 * Math.PI) / width);

    const dt = segWidth / 3;
    const cp1x = x0 + dt;
    const cp1y = y0 + dydx0 * dt;
    const cp2x = x1 - dt;
    const cp2y = y1 - dydx1 * dt;

    builder.curveTo(cp1x, cp1y, cp2x, cp2y, x1, y1);
  }

  return builder.toPath();
}

export const textWave1: WarpPreset = {
  name: 'textWave1',
  topGuide(width: number, height: number, adj: number): Path {
    const amp = height * adj * 0.5;
    return sinePath(width, 0, amp, 1);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const amp = height * adj * 0.5;
    return sinePath(width, height, amp, 1);
  },
  defaultAdjustment: 0.4,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textWave2: WarpPreset = {
  name: 'textWave2',
  topGuide(width: number, height: number, adj: number): Path {
    const amp = height * adj * 0.5;
    return sinePath(width, 0, amp, 1, 0);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const amp = height * adj * 0.5;
    return sinePath(width, height, -amp, 1, 0);
  },
  defaultAdjustment: 0.4,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textWave4: WarpPreset = {
  name: 'textWave4',
  topGuide(width: number, height: number, adj: number): Path {
    const amp = height * adj * 0.3;
    return sinePath(width, 0, amp, 2);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const amp = height * adj * 0.3;
    return sinePath(width, height, amp, 2);
  },
  defaultAdjustment: 0.4,
  minAdjustment: 0,
  maxAdjustment: 1,
};

export const textDoubleWave1: WarpPreset = {
  name: 'textDoubleWave1',
  topGuide(width: number, height: number, adj: number): Path {
    const amp = height * adj * 0.4;
    return sinePath(width, 0, amp, 2, 0);
  },
  bottomGuide(width: number, height: number, adj: number): Path {
    const amp = height * adj * 0.4;
    return sinePath(width, height, amp, 2, Math.PI);
  },
  defaultAdjustment: 0.3,
  minAdjustment: 0,
  maxAdjustment: 1,
};
