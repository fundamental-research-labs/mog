import { jest } from '@jest/globals';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../../context/types';
import { resolveChartRangeReferences } from '../chart-crud';

const DASHBOARD: SheetId = toSheetId('sheet-dashboard');
const FORMULAS: SheetId = toSheetId('sheet-formulas');
const QUOTED: SheetId = toSheetId('sheet-quoted');

function createCtx(): DocumentContext {
  const names = new Map<SheetId, string>([
    [DASHBOARD, 'Dashboard'],
    [FORMULAS, 'Formulas'],
    [QUOTED, "Q1 Data's"],
  ]);

  return {
    computeBridge: {
      getSheetOrder: jest.fn(async () => [DASHBOARD, FORMULAS, QUOTED]),
      getSheetName: jest.fn(async (sheetId: SheetId) => names.get(sheetId) ?? null),
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
    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({
        kind: 'categoryRange',
        code: 'UNKNOWN_SHEET',
        ref: 'Missing!$A$2:$A$4',
        sheetName: 'Missing',
      }),
    ]);
  });
});
