/**
 * Adjustment Handle Computation
 *
 * Computes the position and behavior of the interactive adjustment
 * handles for warp presets.
 */
import type { Point2D } from '@mog-sdk/contracts/geometry';
import type { WarpPresetName } from '../presets/registry';
import { getWarpPreset } from '../presets/registry';

/**
 * An adjustment handle for interactive warp editing.
 */
export interface AdjustHandle {
  /** Handle position in shape coordinates */
  position: Point2D;
  /** Which axis the handle moves along */
  axis: 'horizontal' | 'vertical' | 'both';
  /** Minimum adjustment value */
  min: number;
  /** Maximum adjustment value */
  max: number;
  /** Current adjustment value */
  current: number;
}

/**
 * Get the adjustment handle for a warp preset.
 *
 * The handle is positioned at a visually meaningful location
 * within the warp bounding box.
 *
 * @param presetName The warp preset name
 * @param width Shape width
 * @param height Shape height
 * @param adjustment Current adjustment value
 * @returns The adjustment handle configuration
 */
export function getAdjustHandle(
  presetName: WarpPresetName,
  width: number,
  height: number,
  adjustment: number,
): AdjustHandle {
  const preset = getWarpPreset(presetName);
  const clampedAdj = Math.max(preset.minAdjustment, Math.min(preset.maxAdjustment, adjustment));

  // Default handle position: center-top of the shape, offset by adjustment
  let position: Point2D;
  let axis: 'horizontal' | 'vertical' | 'both' = 'vertical';

  // Position the handle based on preset category
  const name = presetName as string;

  if (
    name.startsWith('textArch') ||
    name === 'textCircle' ||
    name === 'textButton' ||
    name.startsWith('textRing') ||
    name.startsWith('textCan')
  ) {
    // Arc-based: handle at top center, moves vertically
    position = { x: width / 2, y: -height * clampedAdj * 0.5 };
    axis = 'vertical';
  } else if (name.startsWith('textWave') || name.startsWith('textDoubleWave')) {
    // Wave: handle at quarter width, moves vertically
    position = { x: width / 4, y: -height * clampedAdj * 0.3 };
    axis = 'vertical';
  } else if (name.startsWith('textInflate') || name.startsWith('textDeflate')) {
    // Inflate/deflate: handle at center, moves vertically
    position = { x: width / 2, y: -height * clampedAdj * 0.3 };
    axis = 'vertical';
  } else if (name.startsWith('textFade')) {
    // Fade: depends on direction
    if (name === 'textFadeRight' || name === 'textFadeLeft') {
      position = { x: name === 'textFadeRight' ? width : 0, y: height * clampedAdj * 0.25 };
      axis = 'vertical';
    } else {
      position = { x: width * clampedAdj * 0.4, y: name === 'textFadeUp' ? 0 : height };
      axis = 'horizontal';
    }
  } else if (name.startsWith('textSlant')) {
    // Slant: handle at edge, moves vertically
    position = { x: name === 'textSlantUp' ? 0 : width, y: height * clampedAdj * 0.25 };
    axis = 'vertical';
  } else if (name.startsWith('textCascade')) {
    // Cascade: handle at midpoint, moves vertically
    position = { x: width / 2, y: height * clampedAdj * 0.3 };
    axis = 'vertical';
  } else if (name.startsWith('textChevron') || name.startsWith('textTriangle')) {
    // Chevron/triangle: handle at top center
    position = { x: width / 2, y: -height * clampedAdj * 0.2 };
    axis = 'vertical';
  } else {
    // Default
    position = { x: width / 2, y: -height * clampedAdj * 0.3 };
    axis = 'vertical';
  }

  return {
    position,
    axis,
    min: preset.minAdjustment,
    max: preset.maxAdjustment,
    current: clampedAdj,
  };
}

/**
 * Update the adjustment value based on handle movement.
 *
 * @param presetName The warp preset name
 * @param handleDelta How much the handle was dragged
 * @param currentAdj Current adjustment value
 * @returns New adjustment value, clamped to valid range
 */
export function updateAdjustment(
  presetName: WarpPresetName,
  handleDelta: Point2D,
  currentAdj: number,
): number {
  const preset = getWarpPreset(presetName);

  // Convert delta to adjustment change
  // Use a sensitivity factor based on a nominal shape size
  const sensitivity = 0.005;

  // Determine which delta component to use based on the handle's axis
  const handle = getAdjustHandle(presetName, 200, 50, currentAdj);
  let delta: number;
  if (handle.axis === 'horizontal') {
    delta = handleDelta.x * sensitivity;
  } else if (handle.axis === 'both') {
    // Use the larger component for 'both' axis handles
    delta =
      Math.abs(handleDelta.x) > Math.abs(handleDelta.y)
        ? handleDelta.x * sensitivity
        : handleDelta.y * sensitivity;
  } else {
    delta = handleDelta.y * sensitivity;
  }

  const newAdj = currentAdj - delta; // negative because dragging up/left increases adjustment
  return Math.max(preset.minAdjustment, Math.min(preset.maxAdjustment, newAdj));
}
