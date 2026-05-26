/**
 * Shared preset types.
 *
 * Extracted to break the cycle between `registry.ts` (which imports
 * preset implementations) and preset files (which need `WarpPreset`
 * for their type annotations).
 *
 * Presets import types only from this file. `registry.ts` imports
 * the preset implementations for side-effect registration.
 */
import type { Path } from '@mog-sdk/contracts/geometry';
import type { TextWarpPreset } from '@mog-sdk/contracts/text-effects';

/**
 * Warp preset name union type.
 * Uses the TextWarpPreset from contracts.
 */
export type WarpPresetName = TextWarpPreset;

/**
 * A warp preset definition.
 * Generates top and bottom guide paths given dimensions and an adjustment value.
 */
export interface WarpPreset {
  name: string;
  topGuide: (width: number, height: number, adj: number) => Path;
  bottomGuide: (width: number, height: number, adj: number) => Path;
  defaultAdjustment: number; // 0-1 range
  minAdjustment: number;
  maxAdjustment: number;
}
