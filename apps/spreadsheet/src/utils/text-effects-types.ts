/**
 * TextEffect Type Guard Functions
 *
 * Inlined from @mog/spreadsheet-utils/text-effects/types.
 */

import type { TextEffectConfig } from '@mog-sdk/contracts/text-effects';

export function isTextEffectConfig(value: unknown): value is TextEffectConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.warpPreset !== 'string') {
    return false;
  }
  if (typeof obj.fill !== 'object' || obj.fill === null) {
    return false;
  }
  const fill = obj.fill as Record<string, unknown>;
  if (
    fill.type !== 'solid' &&
    fill.type !== 'gradient' &&
    fill.type !== 'pattern' &&
    fill.type !== 'none'
  ) {
    return false;
  }
  return true;
}

export function hasTextEffectConfig(obj: {
  textEffects?: TextEffectConfig;
}): obj is { textEffects: TextEffectConfig } {
  return obj.textEffects !== undefined && isTextEffectConfig(obj.textEffects);
}
