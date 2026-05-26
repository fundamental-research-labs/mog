/**
 * Warp Preset Registry
 *
 * All 41 OOXML text warp presets (from ST_TextShapeType) plus textNoShape.
 * Each preset defines two guide paths (top and bottom) that text characters
 * are warped between.
 *
 * Types live in `./types`. Presets import types from there; registry imports
 * preset implementations for side-effect registration. This breaks the cycle
 * between `registry.ts` and each preset file.
 */
import type { WarpPreset, WarpPresetName } from './types';

// Import all preset implementations
import {
  textArchDown,
  textArchDownPour,
  textArchUp,
  textArchUpPour,
  textButton,
  textButtonPour,
  textCircle,
  textCirclePour,
} from './arc';
import { textCascadeDown, textCascadeUp } from './cascade';
import { textCurveDown, textCurveUp } from './curve';
import { textFadeDown, textFadeLeft, textFadeRight, textFadeUp } from './fade';
import {
  textChevron,
  textChevronInverted,
  textNoShape,
  textPlain,
  textRingInside,
  textRingOutside,
  textStop,
  textTriangle,
  textTriangleInverted,
} from './geometric';
import {
  textCanDown,
  textCanUp,
  textDeflate,
  textDeflateBottom,
  textDeflateInflate,
  textDeflateInflateDeflate,
  textDeflateTop,
  textInflate,
  textInflateBottom,
  textInflateTop,
} from './inflate';
import { textSlantDown, textSlantUp } from './slant';
import { textDoubleWave1, textWave1, textWave2, textWave4 } from './wave';

// Re-export types so existing consumers keep working.
export type { WarpPreset, WarpPresetName } from './types';

/**
 * Registry of all warp presets.
 */
const PRESET_MAP = new Map<WarpPresetName, WarpPreset>([
  // No warp
  ['textNoShape', textNoShape],
  ['textPlain', textPlain],

  // Arc paths
  ['textArchUp', textArchUp],
  ['textArchDown', textArchDown],
  ['textCircle', textCircle],
  ['textButton', textButton],

  // Arc pour paths
  ['textArchUpPour', textArchUpPour],
  ['textArchDownPour', textArchDownPour],
  ['textCirclePour', textCirclePour],
  ['textButtonPour', textButtonPour],

  // Curve effects
  ['textCurveUp', textCurveUp],
  ['textCurveDown', textCurveDown],

  // Wave effects
  ['textWave1', textWave1],
  ['textWave2', textWave2],
  ['textWave4', textWave4],
  ['textDoubleWave1', textDoubleWave1],

  // Inflate/deflate
  ['textInflate', textInflate],
  ['textDeflate', textDeflate],
  ['textInflateBottom', textInflateBottom],
  ['textInflateTop', textInflateTop],
  ['textDeflateBottom', textDeflateBottom],
  ['textDeflateTop', textDeflateTop],
  ['textDeflateInflate', textDeflateInflate],
  ['textDeflateInflateDeflate', textDeflateInflateDeflate],

  // Can shapes
  ['textCanUp', textCanUp],
  ['textCanDown', textCanDown],

  // Fade effects
  ['textFadeRight', textFadeRight],
  ['textFadeLeft', textFadeLeft],
  ['textFadeUp', textFadeUp],
  ['textFadeDown', textFadeDown],

  // Slant effects
  ['textSlantUp', textSlantUp],
  ['textSlantDown', textSlantDown],

  // Cascade effects
  ['textCascadeUp', textCascadeUp],
  ['textCascadeDown', textCascadeDown],

  // Geometric shapes
  ['textTriangle', textTriangle],
  ['textTriangleInverted', textTriangleInverted],
  ['textChevron', textChevron],
  ['textChevronInverted', textChevronInverted],
  ['textRingInside', textRingInside],
  ['textRingOutside', textRingOutside],
  ['textStop', textStop],
]);

/**
 * Get a warp preset by name.
 * @throws Error if preset name is not found.
 */
export function getWarpPreset(name: WarpPresetName): WarpPreset {
  const preset = PRESET_MAP.get(name);
  if (!preset) {
    throw new Error(`Unknown warp preset: ${name}`);
  }
  return preset;
}

/**
 * Get all registered preset names.
 */
export function getAllPresetNames(): WarpPresetName[] {
  return Array.from(PRESET_MAP.keys());
}

/**
 * Check if a string is a valid preset name.
 */
export function isValidPresetName(name: string): name is WarpPresetName {
  return PRESET_MAP.has(name as WarpPresetName);
}

/**
 * Get the total number of registered presets.
 */
export function getPresetCount(): number {
  return PRESET_MAP.size;
}
