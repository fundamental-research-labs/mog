import type { ChartDescription } from '@mog-sdk/contracts/api';

import { sourceRangeMatches } from '../chart-source-diagnostics';

describe('chart source diagnostics', () => {
  it('matches sanitized public range references by display sheet name', () => {
    const description = {
      chartId: 'chart-1',
      sheetId: 'chart-sheet-id',
      title: 'Revenue',
      sourceData: {
        dataRange: {
          kind: 'dataRange',
          source: 'a1',
          ref: 'Data!A1:B2',
          sheetName: 'Data',
          range: {
            startRow: 0,
            startCol: 0,
            endRow: 1,
            endCol: 1,
          },
        },
        categoryRange: null,
        seriesRange: null,
        seriesReferences: [],
        diagnostics: [],
      },
      series: [],
      warnings: [],
      diagnostics: { ranges: [], compiler: [], unsupportedFeatures: [] },
      resolvedSpec: {},
    } as unknown as ChartDescription;

    const matches = sourceRangeMatches(
      description,
      {
        sheetId: 'data-sheet-id',
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      },
      new Map([['data', 'data-sheet-id']]),
    );

    expect(matches).toEqual([
      expect.objectContaining({
        chartId: 'chart-1',
        chartTitle: 'Revenue',
        rangeKind: 'dataRange',
        ref: 'Data!A1:B2',
        range: {
          startRow: 0,
          startCol: 0,
          endRow: 1,
          endCol: 1,
        },
      }),
    ]);
    expect((matches[0]!.range as { sheetId?: string }).sheetId).toBeUndefined();
  });
});
