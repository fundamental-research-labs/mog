/**
 * Shimmer Contract Compliance Tests
 *
 * Validates that NULL_SHEET_DATA_SOURCE has correct shimmer defaults.
 */

import { DEFAULT_SHIMMER_CONFIG } from '@mog-sdk/contracts/rendering';

import { NULL_SHEET_DATA_SOURCE } from '../data/defaults';

describe('Shimmer Contract Defaults', () => {
  it('NULL_SHEET_DATA_SOURCE has correct shimmer defaults', () => {
    expect(NULL_SHEET_DATA_SOURCE.shimmerEntries).toEqual([]);
    expect(NULL_SHEET_DATA_SOURCE.shimmerEffect).toBe(DEFAULT_SHIMMER_CONFIG.effect);
    expect(NULL_SHEET_DATA_SOURCE.shimmerDurationMs).toBe(DEFAULT_SHIMMER_CONFIG.durationMs);
    expect(NULL_SHEET_DATA_SOURCE.shimmerColor).toBe(DEFAULT_SHIMMER_CONFIG.color);
    expect(NULL_SHEET_DATA_SOURCE.shimmerMaxOpacity).toBe(DEFAULT_SHIMMER_CONFIG.maxOpacity);
    expect(NULL_SHEET_DATA_SOURCE.shimmerEnabled).toBe(DEFAULT_SHIMMER_CONFIG.enabled);
  });
});
