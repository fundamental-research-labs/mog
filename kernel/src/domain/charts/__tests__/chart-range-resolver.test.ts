import { jest } from '@jest/globals';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../../context/types';
import { resolveChartRangeReferences } from '../chart-range-references';

const DASHBOARD: SheetId = toSheetId('sheet-dashboard');
const FORMULAS: SheetId = toSheetId('sheet-formulas');
const QUOTED: SheetId = toSheetId('sheet-quoted');

function createCtx(
  positions: Record<string, { row: number; col: number } | null> = {},
): DocumentContext {
  const names = new Map<SheetId, string>([
    [DASHBOARD, 'Dashboard'],
    [FORMULAS, 'Formulas'],
    [QUOTED, "Q1 Data's"],
  ]);

  return {
    computeBridge: {
      getSheetOrder: jest.fn(async () => [DASHBOARD, FORMULAS, QUOTED]),
      getSheetName: jest.fn(async (sheetId: SheetId) => names.get(sheetId) ?? null),
      getCellPosition: jest.fn(async (_sheetId: SheetId, cellId: string) => {
        const position = positions[cellId];
        return position ? { sheetId: DASHBOARD, sheetName: 'Dashboard', ...position } : null;
      }),
    },
  } as unknown as DocumentContext;
}

function chart(fields: Partial<ChartFloatingObject>): ChartFloatingObject {
  return {
    id: 'chart-1',
    type: 'chart',
    sheetId: DASHBOARD,
    anchor: { anchorRow: 0, anchorCol: 0 },
    chartType: 'bar',
    ...fields,
  } as ChartFloatingObject;
}

describe('resolveChartRangeReferences', () => {
  it('resolves absolute and sheet-qualified A1 ranges against workbook sheets', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx(),
      chart({
        dataRange: 'Formulas!$D$287:$D$289',
        categoryRange: "'Q1 Data''s'!$A$1:$A$3",
        seriesRange: '$B$1',
      }),
    );

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.dataRange?.range).toMatchObject({
      sheetId: FORMULAS,
      startRow: 286,
      startCol: 3,
      endRow: 288,
      endCol: 3,
    });
    expect(resolved.categoryRange?.range).toMatchObject({
      sheetId: QUOTED,
      startRow: 0,
      startCol: 0,
      endRow: 2,
      endCol: 0,
    });
    expect(resolved.seriesRange?.range).toMatchObject({
      sheetId: DASHBOARD,
      startRow: 0,
      startCol: 1,
      endRow: 0,
      endCol: 1,
    });
  });

  it('reports unknown sheets without falling back to the chart sheet', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx(),
      chart({ dataRange: 'Missing!$A$1:$A$2' }),
    );

    expect(resolved.dataRange).toBeNull();
    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({
        kind: 'dataRange',
        code: 'UNKNOWN_SHEET',
        sheetName: 'Missing',
      }),
    ]);
  });

  it('uses the first series category reference when the chart has no category range', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx(),
      chart({
        dataRange: "'Q1 Data''s'!$B$2:$B$4",
        series: [
          {
            values: "'Q1 Data''s'!$B$2:$B$4",
            categories: "'Q1 Data''s'!$A$2:$A$4",
          },
        ],
      }),
    );

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.categoryRange?.range).toMatchObject({
      sheetId: QUOTED,
      startRow: 1,
      startCol: 0,
      endRow: 3,
      endCol: 0,
    });
    expect(resolved.categoryRange?.ref).toBe("'Q1 Data''s'!$A$2:$A$4");
  });

  it('resolves imported charts that use explicit per-series value ranges without a dataRange', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx(),
      chart({
        dataRange: '',
        series: [
          {
            name: 'Revenue',
            nameRef: 'Formulas!$B$1',
            values: 'Formulas!$B$2:$D$2',
            categories: 'Formulas!$B$1:$D$1',
            bubbleSize: 'Formulas!$B$3:$D$3',
          },
        ],
      }),
    );

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.dataRange).toBeNull();
    expect(resolved.seriesReferences).toHaveLength(1);
    expect(resolved.seriesReferences[0].name?.range).toMatchObject({
      sheetId: FORMULAS,
      startRow: 0,
      startCol: 1,
      endRow: 0,
      endCol: 1,
    });
    expect(resolved.seriesReferences[0].values?.range).toMatchObject({
      sheetId: FORMULAS,
      startRow: 1,
      startCol: 1,
      endRow: 1,
      endCol: 3,
    });
    expect(resolved.seriesReferences[0].categories?.range).toMatchObject({
      sheetId: FORMULAS,
      startRow: 0,
      startCol: 1,
      endRow: 0,
      endCol: 3,
    });
    expect(resolved.seriesReferences[0].bubbleSizes?.range).toMatchObject({
      sheetId: FORMULAS,
      startRow: 2,
      startCol: 1,
      endRow: 2,
      endCol: 3,
    });
  });

  it('does not treat sparse value cache points outside explicit zero pointCount as renderable data', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx(),
      chart({
        dataRange: '',
        series: [
          {
            valueCache: {
              pointCount: 0,
              points: [{ idx: 0, value: '10' }],
            },
          },
        ],
      }),
    );

    expect(resolved.dataRange).toBeNull();
    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({
        kind: 'dataRange',
        code: 'MISSING_REF',
      }),
    ]);
  });

  it('prefers an explicit category range over series category references', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx(),
      chart({
        dataRange: 'Formulas!$B$2:$B$4',
        categoryRange: 'Formulas!$A$2:$A$4',
        series: [
          {
            values: 'Formulas!$B$2:$B$4',
            categories: "'Q1 Data''s'!$A$2:$A$4",
          },
        ],
      }),
    );

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.categoryRange?.range).toMatchObject({
      sheetId: FORMULAS,
      startRow: 1,
      startCol: 0,
      endRow: 3,
      endCol: 0,
    });
    expect(resolved.categoryRange?.ref).toBe('Formulas!$A$2:$A$4');
  });

  it('resolves identity ranges for data, category, and series references before A1 strings', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx({
        dataTop: { row: 9, col: 4 },
        dataBottom: { row: 5, col: 2 },
        categoryTop: { row: 5, col: 1 },
        categoryBottom: { row: 9, col: 1 },
        seriesTop: { row: 4, col: 2 },
        seriesBottom: { row: 4, col: 4 },
      }),
      chart({
        dataRange: 'Missing!A1:B2',
        dataRangeIdentity: { topLeftCellId: 'dataTop', bottomRightCellId: 'dataBottom' },
        categoryRange: 'Missing!A1:A2',
        categoryRangeIdentity: {
          topLeftCellId: 'categoryTop',
          bottomRightCellId: 'categoryBottom',
        },
        seriesRange: 'Missing!B1:D1',
        seriesRangeIdentity: { topLeftCellId: 'seriesTop', bottomRightCellId: 'seriesBottom' },
      }),
    );

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.dataRange).toMatchObject({
      source: 'identity',
      range: { sheetId: DASHBOARD, startRow: 5, startCol: 2, endRow: 9, endCol: 4 },
    });
    expect(resolved.categoryRange).toMatchObject({
      source: 'identity',
      range: { sheetId: DASHBOARD, startRow: 5, startCol: 1, endRow: 9, endCol: 1 },
    });
    expect(resolved.seriesRange).toMatchObject({
      source: 'identity',
      range: { sheetId: DASHBOARD, startRow: 4, startCol: 2, endRow: 4, endCol: 4 },
    });
  });

  it('reports missing data range when no renderable series references or caches exist', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx(),
      chart({ dataRange: undefined, series: [] }),
    );

    expect(resolved.dataRange).toBeNull();
    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({
        kind: 'dataRange',
        code: 'MISSING_REF',
      }),
    ]);
  });

  it('reports deleted identity range cells without falling back to stale A1 strings', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx({
        liveTop: { row: 1, col: 1 },
        deletedBottom: null,
      }),
      chart({
        dataRange: 'A1:B2',
        dataRangeIdentity: { topLeftCellId: 'liveTop', bottomRightCellId: 'deletedBottom' },
      }),
    );

    expect(resolved.dataRange).toBeNull();
    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({
        kind: 'dataRange',
        code: 'DELETED_CELLS',
      }),
    ]);
  });

  it('reports deleted category and series identity cells', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx({
        categoryTop: { row: 1, col: 0 },
        deletedCategoryBottom: null,
        deletedSeriesTop: null,
        seriesBottom: { row: 0, col: 3 },
      }),
      chart({
        dataRange: 'A1:B2',
        categoryRangeIdentity: {
          topLeftCellId: 'categoryTop',
          bottomRightCellId: 'deletedCategoryBottom',
        },
        seriesRangeIdentity: {
          topLeftCellId: 'deletedSeriesTop',
          bottomRightCellId: 'seriesBottom',
        },
      }),
    );

    expect(resolved.categoryRange).toBeNull();
    expect(resolved.seriesRange).toBeNull();
    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'categoryRange', code: 'DELETED_CELLS' }),
        expect.objectContaining({ kind: 'seriesRange', code: 'DELETED_CELLS' }),
      ]),
    );
  });

  it('reports identity ranges without an owning chart sheet', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx(),
      chart({
        sheetId: undefined,
        dataRangeIdentity: { topLeftCellId: 'dataTop', bottomRightCellId: 'dataBottom' },
        categoryRangeIdentity: {
          topLeftCellId: 'categoryTop',
          bottomRightCellId: 'categoryBottom',
        },
        seriesRangeIdentity: { topLeftCellId: 'seriesTop', bottomRightCellId: 'seriesBottom' },
      }),
    );

    expect(resolved.dataRange).toBeNull();
    expect(resolved.categoryRange).toBeNull();
    expect(resolved.seriesRange).toBeNull();
    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'dataRange', code: 'NO_CHART_SHEET' }),
        expect.objectContaining({ kind: 'categoryRange', code: 'NO_CHART_SHEET' }),
        expect.objectContaining({ kind: 'seriesRange', code: 'NO_CHART_SHEET' }),
      ]),
    );
  });

  it('reports malformed A1 and missing chart-sheet diagnostics', async () => {
    const malformed = await resolveChartRangeReferences(
      createCtx(),
      chart({ dataRange: 'not a range' }),
    );
    const noChartSheet = await resolveChartRangeReferences(
      createCtx(),
      chart({ sheetId: undefined, dataRange: 'A1:B2' }),
    );

    expect(malformed.dataRange).toBeNull();
    expect(malformed.diagnostics).toEqual([
      expect.objectContaining({
        kind: 'dataRange',
        code: 'MALFORMED_A1',
        ref: 'not a range',
      }),
    ]);
    expect(noChartSheet.dataRange).toBeNull();
    expect(noChartSheet.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'dataRange',
          code: 'NO_CHART_SHEET',
          ref: 'A1:B2',
        }),
      ]),
    );
  });

  it('uses only the literal first series category reference as the chart category fallback', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx(),
      chart({
        dataRange: 'Formulas!$B$2:$B$4',
        series: [
          {
            values: 'Formulas!$B$2:$B$4',
            categories: '',
          },
          {
            values: 'Formulas!$C$2:$C$4',
            categories: 'Formulas!$A$2:$A$4',
          },
        ],
      }),
    );

    expect(resolved.categoryRange).toBeNull();
    expect(resolved.seriesReferences.map((series) => series.index)).toEqual([0, 1]);
    expect(resolved.seriesReferences[1].categories?.range).toMatchObject({
      sheetId: FORMULAS,
      startRow: 1,
      startCol: 0,
      endRow: 3,
      endCol: 0,
    });
  });

  it('reports per-series malformed, unknown sheet, and no-sheet diagnostics while preserving order', async () => {
    const noSheet = await resolveChartRangeReferences(
      createCtx(),
      chart({
        sheetId: undefined,
        dataRange: 'Dashboard!A1:B2',
        series: [
          { values: 'A1:A2', bubbleSize: 'not a range' },
          { values: 'Missing!B1:B2', bubbleSize: 'Dashboard!C1:C2' },
        ],
      }),
    );

    expect(noSheet.seriesReferences.map((series) => series.index)).toEqual([0, 1]);
    expect(noSheet.seriesReferences[0].values).toBeNull();
    expect(noSheet.seriesReferences[0].bubbleSizes).toBeNull();
    expect(noSheet.seriesReferences[1].values).toBeNull();
    expect(noSheet.seriesReferences[1].bubbleSizes?.range).toMatchObject({
      sheetId: DASHBOARD,
      startRow: 0,
      startCol: 2,
      endRow: 1,
      endCol: 2,
    });
    expect(noSheet.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'seriesValues', code: 'NO_CHART_SHEET', ref: 'A1:A2' }),
        expect.objectContaining({
          kind: 'seriesBubbleSizes',
          code: 'MALFORMED_A1',
          ref: 'not a range',
        }),
        expect.objectContaining({
          kind: 'seriesValues',
          code: 'UNKNOWN_SHEET',
          ref: 'Missing!B1:B2',
        }),
      ]),
    );
  });

  it('reports unknown sheets from fallback series category references', async () => {
    const resolved = await resolveChartRangeReferences(
      createCtx(),
      chart({
        dataRange: 'Formulas!$B$2:$B$4',
        series: [
          {
            values: 'Formulas!$B$2:$B$4',
            categories: 'Missing!$A$2:$A$4',
          },
        ],
      }),
    );

    expect(resolved.categoryRange).toBeNull();
    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'categoryRange',
          code: 'UNKNOWN_SHEET',
          ref: 'Missing!$A$2:$A$4',
          sheetName: 'Missing',
        }),
        expect.objectContaining({
          kind: 'seriesCategories',
          code: 'UNKNOWN_SHEET',
          ref: 'Missing!$A$2:$A$4',
          sheetName: 'Missing',
        }),
      ]),
    );
  });
});
