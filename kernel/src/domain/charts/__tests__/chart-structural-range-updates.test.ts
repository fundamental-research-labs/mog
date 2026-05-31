import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { buildStructuralRangeUpdate } from '../bridge/chart-structural-range-updates';

function chart(overrides: Partial<ChartFloatingObject> = {}): ChartFloatingObject {
  return {
    id: 'chart-1',
    type: 'chart',
    chartType: 'bar',
    sheetId: 'sheet-a',
    dataRange: 'B2:C4',
    ...overrides,
  } as unknown as ChartFloatingObject;
}

describe('buildStructuralRangeUpdate', () => {
  it('expands row ranges when rows are inserted inside explicit A1 refs', () => {
    const result = buildStructuralRangeUpdate(
      chart({
        dataRange: 'B2:C4',
        categoryRange: 'A2:A4',
        seriesRange: 'B1:C1',
        series: [
          {
            name: 'Series 1',
            values: 'B2:B4',
            categories: "'Sheet A'!A2:A4",
            bubbleSize: 'D2:D4',
          },
        ],
      } as never),
      'row',
      'insert',
      3,
      2,
    );

    expect(result).toEqual({
      updates: {
        dataRange: 'B2:C6',
        categoryRange: 'A2:A6',
        series: [
          expect.objectContaining({
            values: 'B2:B6',
            categories: "'Sheet A'!A2:A6",
            bubbleSize: 'D2:D6',
          }),
        ],
      },
      invalidate: false,
    });
  });

  it('shifts column ranges when columns are inserted before sheet-qualified refs', () => {
    const result = buildStructuralRangeUpdate(
      chart({
        dataRange: "'Sheet A'!B2:C4",
        categoryRange: "'Sheet A'!A2:A4",
        seriesRange: "'Sheet A'!B1:C1",
        series: [
          {
            name: 'Series 1',
            values: "'Sheet A'!B2:B4",
            categories: "'Sheet A'!A2:A4",
            bubbleSize: "'Sheet A'!D2:D4",
          },
        ],
      } as never),
      'column',
      'insert',
      0,
      2,
    );

    expect(result).toEqual({
      updates: {
        dataRange: "'Sheet A'!D2:E4",
        seriesRange: "'Sheet A'!D1:E1",
        series: [
          expect.objectContaining({
            values: "'Sheet A'!D2:D4",
            categories: "'Sheet A'!A2:A4",
            bubbleSize: "'Sheet A'!F2:F4",
          }),
        ],
      },
      invalidate: false,
    });
  });

  it('shrinks row and column ranges around partial deletions', () => {
    expect(
      buildStructuralRangeUpdate(chart({ dataRange: 'B5:C8' }), 'row', 'delete', 6, 2),
    ).toEqual({
      updates: { dataRange: 'B5:C6' },
      invalidate: false,
    });

    expect(
      buildStructuralRangeUpdate(chart({ dataRange: 'D2:G4' }), 'column', 'delete', 2, 3),
    ).toEqual({
      updates: { dataRange: 'C2:E4' },
      invalidate: false,
    });
  });

  it('shifts ranges when deletion happens before the range', () => {
    expect(
      buildStructuralRangeUpdate(chart({ dataRange: 'B5:C8' }), 'row', 'delete', 1, 2),
    ).toEqual({
      updates: { dataRange: 'B3:C6' },
      invalidate: false,
    });

    expect(
      buildStructuralRangeUpdate(chart({ dataRange: "'Sheet A'!D2:F4" }), 'column', 'delete', 1, 2),
    ).toEqual({
      updates: { dataRange: "'Sheet A'!B2:D4" },
      invalidate: false,
    });
  });

  it('invalidates without rewriting refs when deletion removes an entire referenced range', () => {
    expect(
      buildStructuralRangeUpdate(chart({ dataRange: 'B5:C8' }), 'row', 'delete', 4, 6),
    ).toEqual({
      updates: {},
      invalidate: true,
    });
  });

  it('ignores identity-backed and unparsable ranges', () => {
    expect(
      buildStructuralRangeUpdate(
        chart({
          dataRange: 'B2:C4',
          dataRangeIdentity: {} as never,
          categoryRange: 'not-a-range',
          series: [{ name: 'Series 1', values: 'SUM(A1:A3)' }],
        } as never),
        'row',
        'insert',
        3,
        1,
      ),
    ).toEqual({
      updates: {},
      invalidate: false,
    });
  });
});
