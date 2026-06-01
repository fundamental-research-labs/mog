/**
 * Chart Bridge — Cache Invalidation Tests
 *
 * Tests the isPositionOnlyUpdate logic that prevents chart flicker
 * during drag/resize by skipping mark cache invalidation for
 * position-only floating object updates.
 */

import type { DocumentContext } from '../../../context/types';
import type { ChartWasmExports } from '../chart-bridge';
import {
  ChartBridge,
  createChartBridge,
  initChartWasm,
  isPositionOnlyUpdate,
} from '../chart-bridge';

function acceptsChartWasmExports(exports: ChartWasmExports): ChartWasmExports {
  return exports;
}

describe('chart-bridge public compatibility exports', () => {
  it('keeps the stable bridge facade exports available', () => {
    const ctx = {} as DocumentContext;

    expect(typeof initChartWasm).toBe('function');
    expect(createChartBridge(ctx)).toBeInstanceOf(ChartBridge);
    expect(acceptsChartWasmExports({})).toEqual({});
    expect(typeof isPositionOnlyUpdate).toBe('function');
  });
});

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
