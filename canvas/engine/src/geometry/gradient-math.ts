/**
 * Linear gradient endpoint computation.
 *
 * Computes start and end points for a linear gradient along the diagonal
 * of a bounding rectangle, given an angle in radians.
 */

export interface GradientEndpoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Compute linear gradient start/end points from a center, dimensions, and angle.
 *
 * The gradient line passes through the center of the bounding box and extends
 * to the diagonal corners so it fully covers the rectangle at any angle.
 *
 * @param cx - Center X of the bounding box
 * @param cy - Center Y of the bounding box
 * @param width - Width of the bounding box
 * @param height - Height of the bounding box
 * @param angleRadians - Gradient angle in radians
 * @param invertY - If true, invert the Y component (for Excel-style angles
 *   where 90 deg = bottom-to-top in canvas coordinates). Default false.
 * @returns Start (x1,y1) and end (x2,y2) points for the gradient
 */
export function computeLinearGradientEndpoints(
  cx: number,
  cy: number,
  width: number,
  height: number,
  angleRadians: number,
  invertY: boolean = false,
): GradientEndpoints {
  const halfDiag = Math.sqrt(width * width + height * height) / 2;
  const dx = Math.cos(angleRadians) * halfDiag;
  const dy = Math.sin(angleRadians) * halfDiag;

  const ySign = invertY ? -1 : 1;

  return {
    x1: cx - dx,
    y1: cy - dy * ySign,
    x2: cx + dx,
    y2: cy + dy * ySign,
  };
}
