import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { toChartConfig, unsupportedChartTypeError } from '../bridge/chart-config-normalizer';

const SHEET_A: SheetId = toSheetId('sheet-a');
const CHART_ID = 'chart-1';

function chart(overrides: Partial<ChartFloatingObject> = {}): ChartFloatingObject {
  return {
    id: CHART_ID,
    type: 'chart',
    chartType: 'bar',
    sheetId: SHEET_A as unknown as string,
    anchor: { anchorRow: 0, anchorCol: 0, anchorCellId: 'cell-0' as never },
    widthCells: 4,
    heightCells: 10,
    dataRange: 'A1:C1',
    ...overrides,
  } as unknown as ChartFloatingObject;
}

describe('chart config normalizer', () => {
  it('converts floating chart objects into render chart configs with legacy axis aliases', () => {
    const config = toChartConfig(
      chart({
        chartType: 'line',
        widthCells: undefined,
        width: 7,
        heightCells: 3,
        axis: {
          categoryAxis: { axisType: 'dateAxis', visible: false },
          valueAxis: { axisType: 'value', visible: true },
          secondaryCategoryAxis: { axisType: 'dateAxis', visible: true, position: 't' },
        },
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.type).toBe('line');
    expect(config.width).toBe(7);
    expect(config.height).toBe(3);
    expect(config.axis?.xAxis).toMatchObject({ type: 'dateAxis', show: false });
    expect(config.axis?.yAxis).toMatchObject({ type: 'value', show: true });
    expect(config.axis?.secondaryCategoryAxis).toMatchObject({
      type: 'dateAxis',
      show: true,
      position: 't',
    });
  });

  it('canonicalizes imported chart type aliases before rendering', () => {
    expect(toChartConfig(chart({ chartType: 'surface3D' })).type).toBe('surface3d');
    expect(toChartConfig(chart({ chartType: 'chartEx:funnel' })).type).toBe('funnel');
    expect(toChartConfig(chart({ chartType: 'boxWhisker' })).type).toBe('boxplot');
  });

  it('normalizes imported combo chart metadata before narrowing the chart type', () => {
    const config = toChartConfig(
      chart({
        chartType: 'combo',
        rt: {
          chartGroupsMeta: [
            { chartType: 'line', seriesIndices: [0] },
            { chartType: 'line', seriesIndices: [1] },
          ],
        },
        series: [{ name: 'Revenue' }, { name: 'Cost' }],
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.type).toBe('line');
  });

  it('rejects unsupported imported chart types before ChartConfig construction', () => {
    const importedUnknown = chart({
      chartType: 'chartEx:unknown',
      importStatus: {
        source: 'xlsx',
        featureKind: 'chart',
        recoverability: 'preservedNotRenderable',
        renderability: 'notRenderable',
        editability: 'partiallyEditable',
      },
    } as unknown as Partial<ChartFloatingObject>);

    expect(unsupportedChartTypeError(importedUnknown)).toMatchObject({
      code: 'INVALID_SPEC',
      message: 'Imported chart type "chartEx:unknown" is not supported',
      details: {
        chartType: 'chartEx:unknown',
        diagnostics: [{ code: 'unsupportedChartType' }],
      },
    });
    expect(() => toChartConfig(importedUnknown)).toThrow(
      'Imported chart type "chartEx:unknown" is not supported',
    );
  });
});
