/**
 * 3D Rotation and Extrusion
 *
 * Computes an affine transform that approximates 3D rotation
 * and perspective projection for text rendering.
 */
import { Matrix, Transform } from '@mog/geometry';
import type { AffineTransform, BoundingBox } from '@mog-sdk/contracts/geometry';

/**
 * 3D rotation configuration.
 */
export interface ThreeDConfig {
  /** Rotation around X axis in degrees (tilt forward/back) */
  rotationX: number;
  /** Rotation around Y axis in degrees (turn left/right) */
  rotationY: number;
  /** Rotation around Z axis in degrees (spin in-plane) */
  rotationZ: number;
  /** Perspective distance (field of view). Higher = flatter projection */
  perspective?: number;
  /** Extrusion depth (3D thickness) */
  depth?: number;
}

/**
 * Compute a 2D affine transform that approximates a 3D rotation
 * with perspective projection.
 *
 * This is a simplified projection that works well for small rotation angles.
 * For full 3D rendering, a proper 3D pipeline would be needed.
 *
 * The transform is computed relative to the center of the bounding box.
 *
 * @param config 3D rotation parameters
 * @param bounds Bounding box of the content being transformed
 * @returns Affine transform approximating the 3D effect
 */
export function compute3DTransform(config: ThreeDConfig, bounds: BoundingBox): AffineTransform {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  const radX = (config.rotationX * Math.PI) / 180;
  const radY = (config.rotationY * Math.PI) / 180;
  const radZ = (config.rotationZ * Math.PI) / 180;

  // Perspective factor: controls how much depth affects scale.
  // Higher perspective value = flatter projection (less dramatic).
  // A perspective of 0 or below means no perspective correction.
  const perspective = config.perspective ?? 1000;
  // perspFactor modulates the foreshortening from rotation.
  // With large perspective distance, the effect is subtle.
  // With small perspective distance, the effect is dramatic.
  // Only the rotation-induced scale changes are affected by perspective.
  const perspFactor = perspective > 0 ? perspective / (perspective + bounds.width * 0.5) : 1;

  // Approximate 3D rotation as 2D affine:
  // - X rotation (tilt) maps to vertical scale + skew
  // - Y rotation (turn) maps to horizontal scale + skew
  // - Z rotation (spin) maps to 2D rotation

  const cosX = Math.cos(radX);
  const cosY = Math.cos(radY);
  const sinX = Math.sin(radX);
  const sinY = Math.sin(radY);

  // Scale factors from projection, modulated by perspective.
  // perspFactor scales only the rotation-induced foreshortening:
  // when cosY/cosX < 1 (object is rotated), perspective makes it smaller.
  // when cosY/cosX = 1 (no rotation on that axis), result stays 1.
  const scaleX = 1 - (1 - cosY) * perspFactor;
  const scaleY = 1 - (1 - cosX) * perspFactor;

  // Skew from off-axis rotation
  const skewX = sinY * 0.5;
  const skewY = sinX * 0.5;

  // Build the composite transform
  // 1. Translate center to origin
  // 2. Apply perspective-projected rotation
  // 3. Apply Z rotation
  // 4. Translate back

  const projection = Matrix.fromValues(scaleX, skewY, skewX, scaleY, 0, 0);

  const zRotation = Transform.rotate(radZ);

  // Depth-based extrusion: scale down slightly proportional to depth to
  // simulate perspective foreshortening, and shift vertically for a subtle
  // 3D offset. Only applied when depth > 0.
  const depth = config.depth ?? 0;
  let depthTransform = Matrix.identity();
  if (depth > 0) {
    const maxDim = Math.max(bounds.width, bounds.height, 1);
    // Scale factor shrinks towards a minimum of 0.9 (at most 10% reduction)
    const depthScale = Math.max(1 - (depth / (depth + maxDim)) * 0.1, 0.9);
    // Small vertical offset proportional to depth
    const depthOffsetY = depth * 0.02;
    depthTransform = Matrix.fromValues(depthScale, 0, 0, depthScale, 0, depthOffsetY);
  }

  const combined = Transform.compose(
    Transform.translate(cx, cy),
    depthTransform,
    zRotation,
    projection,
    Transform.translate(-cx, -cy),
  );

  return combined;
}
