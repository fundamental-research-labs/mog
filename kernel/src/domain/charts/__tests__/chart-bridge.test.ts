/**
 * Chart Bridge — Cache Invalidation Tests
 *
 * Tests the isPositionOnlyUpdate logic that prevents chart flicker
 * during drag/resize by skipping mark cache invalidation for
 * position-only floating object updates.
 */

import { isPositionOnlyUpdate } from '../chart-bridge';

describe('isPositionOnlyUpdate', () => {
  it('returns true for drag fields (anchorRow, anchorCol)', () => {
    expect(isPositionOnlyUpdate(['anchorRow', 'anchorCol'])).toBe(true);
  });

  it('returns true for resize fields (width, height)', () => {
    expect(isPositionOnlyUpdate(['width', 'height'])).toBe(true);
  });

  it('returns true for single position field', () => {
    expect(isPositionOnlyUpdate(['anchorRow'])).toBe(true);
  });

  it('returns true for all position fields combined', () => {
    expect(
      isPositionOnlyUpdate([
        'anchorRow',
        'anchorCol',
        'width',
        'height',
        'offsetX',
        'offsetY',
        'rotation',
        'zIndex',
      ]),
    ).toBe(true);
  });

  it('returns false for data-affecting fields', () => {
    expect(isPositionOnlyUpdate(['chartConfig'])).toBe(false);
  });

  it('returns false for mixed position and data fields', () => {
    expect(isPositionOnlyUpdate(['anchorRow', 'chartConfig'])).toBe(false);
  });

  it('returns false for empty array (safe default — invalidate on unknown changes)', () => {
    expect(isPositionOnlyUpdate([])).toBe(false);
  });

  it('returns false for unknown fields (safe default)', () => {
    expect(isPositionOnlyUpdate(['someNewField'])).toBe(false);
  });
});
