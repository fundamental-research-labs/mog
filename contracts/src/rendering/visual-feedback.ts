/**
 * Transient visual feedback types shared by render context config and data sources.
 *
 * @module @mog-sdk/contracts/rendering/visual-feedback
 */

import type { CellRange } from '@mog/types-core';

/** A single shimmer entry representing a recently-changed cell range. */
export interface ShimmerEntry {
  /** The cell range that was changed */
  range: CellRange;
  /** Timestamp (Date.now()) when the change occurred */
  startTime: number;
  /** Sheet ID this shimmer belongs to */
  sheetId: string;
}

export type ShimmerEffectType = 'fade' | 'pulse' | 'border-glow' | 'sweep';

export interface ShimmerDefaults {
  readonly effect: ShimmerEffectType;
  readonly durationMs: number;
  readonly color: string;
  readonly maxOpacity: number;
  readonly enabled: boolean;
}

export const DEFAULT_SHIMMER_CONFIG: ShimmerDefaults = {
  effect: 'sweep',
  durationMs: 1500,
  color: '#4285F4',
  maxOpacity: 0.35,
  enabled: true,
};
