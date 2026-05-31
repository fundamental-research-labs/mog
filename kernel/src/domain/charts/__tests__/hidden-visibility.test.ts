import type { CellRange } from '@mog-sdk/contracts/core';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ChartConfig } from '@mog-sdk/contracts/data/charts';

import type { ResolvedChartRangeReferences } from '../chart-range-references';
import {
  isCellHidden,
  isRangeFullyHidden,
  loadHiddenVisibility,
  withHiddenSeriesFiltered,
} from '../bridge/hidden-visibility';

function range(sheetId: string, startRow: number, endRow = startRow): CellRange {
  return {
    sheetId,
    startRow,
    endRow,
    startCol: 0,
    endCol: 1,
  };
}

describe('hidden visibility bridge helpers', () => {
  it('loads hidden rows and columns once per referenced sheet', async () => {
    const rowRequests: string[] = [];
    const colRequests: string[] = [];

    const visibility = await loadHiddenVisibility(
      [range('sheet-a', 1), range('sheet-a', 2), range('sheet-b', 3), null],
      {
        getHiddenRows: async (sheetId) => {
          rowRequests.push(String(sheetId));
          return sheetId === toSheetId('sheet-a') ? [2] : [];
        },
        getHiddenColumns: async (sheetId) => {
          colRequests.push(String(sheetId));
          return sheetId === toSheetId('sheet-b') ? [1] : [];
        },
      },
    );

    expect(rowRequests.sort()).toEqual(['sheet-a', 'sheet-b']);
    expect(colRequests.sort()).toEqual(['sheet-a', 'sheet-b']);
    expect(isCellHidden('sheet-a', 2, 0, visibility)).toBe(true);
    expect(isCellHidden('sheet-b', 3, 1, visibility)).toBe(true);
    expect(isCellHidden('sheet-b', 3, 0, visibility)).toBe(false);
  });

  it('detects fully hidden ranges without treating partially hidden ranges as hidden', () => {
    const visibility = {
      hiddenRowsBySheet: new Map([['sheet-a', new Set([4])]]),
      hiddenColsBySheet: new Map([['sheet-a', new Set([3])]]),
    };

    expect(isRangeFullyHidden(range('sheet-a', 4), visibility)).toBe(true);
    expect(
      isRangeFullyHidden(
        { sheetId: 'sheet-a', startRow: 4, endRow: 5, startCol: 0, endCol: 1 },
        visibility,
      ),
    ).toBe(false);
    expect(
      isRangeFullyHidden(
        { sheetId: 'sheet-a', startRow: 1, endRow: 2, startCol: 3, endCol: 3 },
        visibility,
      ),
    ).toBe(true);
  });

  it('filters fully hidden explicit series while preserving visible series objects', () => {
    const visible = {
      name: 'Visible',
      values: 'Sheet1!A1:B1',
      format: { fill: { type: 'solid', color: { theme: 'accent1' } } },
    };
    const hidden = {
      name: 'Hidden',
      values: 'Sheet1!A2:B2',
      format: { fill: { type: 'solid', color: { theme: 'accent2' } } },
    };
    const later = {
      name: 'Later',
      values: 'Sheet1!A3:B3',
      format: { fill: { type: 'solid', color: { theme: 'accent3' } } },
    };
    const config = {
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 8,
      dataRange: '',
      series: [visible, hidden, later],
    } as ChartConfig;
    const resolvedRanges = {
      seriesReferences: [
        { values: { range: range('sheet-a', 0) } },
        { values: { range: range('sheet-a', 1) } },
        { values: { range: range('sheet-a', 2) } },
      ],
    } as unknown as ResolvedChartRangeReferences;
    const visibility = {
      hiddenRowsBySheet: new Map([['sheet-a', new Set([1])]]),
      hiddenColsBySheet: new Map<string, Set<number>>(),
    };

    const filtered = withHiddenSeriesFiltered(config, resolvedRanges, visibility);

    expect(filtered).not.toBe(config);
    expect(filtered.series).toEqual([visible, later]);
    expect(filtered.series?.[1]).toBe(later);
  });
});
