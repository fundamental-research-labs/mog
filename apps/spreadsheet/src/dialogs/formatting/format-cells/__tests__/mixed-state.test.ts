/**
 * Unit tests for the Format Cells dialog mixed-state detector.
 *
 * Locks the contract that:
 * - Properties absent from a cell normalize to the same defaults as the active
 * cell base, so cell-level `indent: 0` vs cascade-absent (null) does NOT
 * show as mixed.
 * - Properties NOT in the defaults table normalize to `undefined` on both
 * sides — so e.g. an undefined `gradientFill` on every cell is "agreed".
 * - The merged format materializes default-backed null-for-absent fields when
 *   they are not mixed, so controls do not confuse default with indeterminate.
 */

import type { CellFormat } from '@mog-sdk/contracts/core';

import {
  buildMergedFormat,
  detectMixedProperties,
  totalCellCount,
  TRACKED_PROPERTIES,
} from '../mixed-state';

describe('detectMixedProperties', () => {
  it('returns empty when every cell agrees with the base', () => {
    const base: Partial<CellFormat> = { bold: true, fontSize: 12 };
    const cells: (CellFormat | null)[] = [
      { bold: true, fontSize: 12 },
      { bold: true, fontSize: 12 },
    ];
    expect(detectMixedProperties(base, cells)).toEqual(new Set());
  });

  it('flags a property when one cell has a different value', () => {
    const base: Partial<CellFormat> = { bold: true };
    const cells: (CellFormat | null)[] = [{ bold: true }, { bold: false }];
    const mixed = detectMixedProperties(base, cells);
    expect(mixed.has('bold')).toBe(true);
  });

  it('treats null cells as "all defaults" — no mixed when base also matches defaults', () => {
    // Base resolved cascade with no overrides anywhere: the dense format will
    // carry Rust defaults like fontSize=11. A null cell should also normalize
    // to fontSize=11 → no mismatch.
    const base: Partial<CellFormat> = {
      fontFamily: 'Calibri',
      fontSize: 11,
      bold: false,
      italic: false,
      horizontalAlign: 'general',
      verticalAlign: 'bottom',
      wrapText: false,
      locked: true,
      hidden: false,
    };
    const cells: (CellFormat | null)[] = [null, null];
    expect(detectMixedProperties(base, cells)).toEqual(new Set());
  });

  it('flags mismatch when a null cell would default but base has an explicit override', () => {
    const base: Partial<CellFormat> = { fontSize: 14 };
    const cells: (CellFormat | null)[] = [null]; // null → fontSize defaults to 11
    expect(detectMixedProperties(base, cells).has('fontSize')).toBe(true);
  });

  it('explicit indent=0 vs cascade-absent indent both normalize to 0 (no mismatch)', () => {
    // A cell that has indent: 0 explicitly and a base with no indent override
    // (resolved indent: undefined / null) should both normalize to default 0.
    const base: Partial<CellFormat> = {};
    const cells: (CellFormat | null)[] = [{ indent: 0 }, null];
    expect(detectMixedProperties(base, cells).has('indent')).toBe(false);
  });

  it('compares gradientFill structurally via JSON.stringify', () => {
    const baseGradient = {
      type: 'linear' as const,
      degree: 0,
      stops: [
        { position: 0, color: '#FFFFFF' },
        { position: 1, color: '#4472C4' },
      ],
    };
    const base: Partial<CellFormat> = { gradientFill: baseGradient };
    // Same gradient — different object identity, same structure.
    const sameStructure = JSON.parse(JSON.stringify(baseGradient));
    const cells: (CellFormat | null)[] = [{ gradientFill: sameStructure }];
    expect(detectMixedProperties(base, cells).has('gradientFill')).toBe(false);
  });

  it('flags gradientFill when one cell has a different gradient', () => {
    const base: Partial<CellFormat> = {
      gradientFill: { type: 'linear', degree: 0, stops: [{ position: 0, color: '#FFFFFF' }] },
    };
    const cells: (CellFormat | null)[] = [
      { gradientFill: { type: 'linear', degree: 90, stops: [{ position: 0, color: '#FFFFFF' }] } },
    ];
    expect(detectMixedProperties(base, cells).has('gradientFill')).toBe(true);
  });

  it('treats undefined and null on the base symmetrically with cell undefined', () => {
    // base.fontColor = null (ResolvedCellFormat absent), cell.fontColor = undefined → match.
    const base = { fontColor: null } as unknown as Partial<CellFormat>;
    const cells: (CellFormat | null)[] = [{}];
    expect(detectMixedProperties(base, cells).has('fontColor')).toBe(false);
  });

  it('returns early once all tracked properties are mixed', () => {
    // Sanity: large input doesn't affect correctness.
    const base: Partial<CellFormat> = {};
    for (const key of TRACKED_PROPERTIES) {
      // Force each property to differ from defaults so detection terminates fast.
      (base as Record<string, unknown>)[key] = 'sentinel-base';
    }
    const cells: (CellFormat | null)[] = Array.from({ length: 100 }, () => ({}) as CellFormat);
    const mixed = detectMixedProperties(base, cells);
    expect(mixed.size).toBe(TRACKED_PROPERTIES.length);
  });
});

describe('buildMergedFormat', () => {
  it('strips mixed properties to undefined', () => {
    const base: Partial<CellFormat> = { bold: true, fontSize: 12 };
    const merged = buildMergedFormat(base, new Set(['bold']));
    expect(merged.bold).toBeUndefined();
    expect(merged.fontSize).toBe(12);
  });

  it('materializes default-backed ResolvedCellFormat null-for-absent fields', () => {
    const base = {
      bold: null,
      shrinkToFit: null,
      horizontalAlign: null,
      fontSize: 12,
    } as unknown as Partial<CellFormat>;
    const merged = buildMergedFormat(base, new Set());
    expect(merged.bold).toBe(false);
    expect(merged.shrinkToFit).toBe(false);
    expect(merged.horizontalAlign).toBe('general');
    expect(merged.fontSize).toBe(12);
  });

  it('keeps mixed default-backed properties undefined while materializing agreed siblings', () => {
    const base = {
      wrapText: null,
      shrinkToFit: null,
    } as unknown as Partial<CellFormat>;
    const merged = buildMergedFormat(base, new Set(['wrapText']));
    expect(merged.wrapText).toBeUndefined();
    expect(merged.shrinkToFit).toBe(false);
  });

  it('still strips null fields that have no declared default', () => {
    const base = { fontColor: null } as unknown as Partial<CellFormat>;
    const merged = buildMergedFormat(base, new Set());
    expect(merged.fontColor).toBeUndefined();
  });

  it('preserves agreed properties unchanged', () => {
    const base: Partial<CellFormat> = {
      fontFamily: 'Arial',
      bold: false,
      horizontalAlign: 'center',
    };
    const merged = buildMergedFormat(base, new Set(['fontFamily']));
    expect(merged.fontFamily).toBeUndefined();
    expect(merged.bold).toBe(false);
    expect(merged.horizontalAlign).toBe('center');
  });
});

describe('totalCellCount', () => {
  it('counts a single cell range', () => {
    expect(totalCellCount([{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }])).toBe(1);
  });

  it('counts a 5x5 range', () => {
    expect(totalCellCount([{ startRow: 0, startCol: 0, endRow: 4, endCol: 4 }])).toBe(25);
  });

  it('sums multiple ranges', () => {
    expect(
      totalCellCount([
        { startRow: 0, startCol: 0, endRow: 1, endCol: 1 }, // 4
        { startRow: 5, startCol: 5, endRow: 6, endCol: 7 }, // 6
      ]),
    ).toBe(10);
  });

  it('handles inverted (end < start) ranges via abs', () => {
    expect(totalCellCount([{ startRow: 4, startCol: 4, endRow: 0, endCol: 0 }])).toBe(25);
  });
});
