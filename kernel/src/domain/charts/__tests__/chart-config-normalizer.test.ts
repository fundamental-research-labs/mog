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
    expect(toChartConfig(chart({ chartType: 'boxWhisker' })).type).toBe('boxplot');
    expect(toChartConfig(chart({ chartType: 'paretoLine' })).type).toBe('pareto');
    expect(() => toChartConfig(chart({ chartType: 'chartEx:funnel' }))).toThrow(
      'Imported chart type "chartEx:funnel" is not supported',
    );
  });

  it('passes projected ChartEx family config through to render config', () => {
    const config = toChartConfig(
      chart({
        chartType: 'waterfall',
        waterfall: { subtotalIndices: [2], showConnectorLines: true },
        histogram: { binCount: 8, underflowBin: true, underflowBinValue: 1 },
        boxplot: {
          showOutlierPoints: true,
          showMeanMarkers: false,
          showMeanLine: true,
          quartileMethod: 'inclusive',
        },
        hierarchy: {
          categoryFormulas: ['Sheet1!A1:A3'],
          valueFormula: 'Sheet1!B1:B3',
          parentLabelLayout: 'banner',
        },
        regionMap: { regionFormula: 'Sheet1!A1:A3', valueFormula: 'Sheet1!B1:B3' },
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.waterfall).toMatchObject({
      subtotalIndices: [2],
      totalIndices: [2],
      showConnectorLines: true,
    });
    expect(config.histogram).toMatchObject({ binCount: 8, underflowBinValue: 1 });
    expect(config.boxplot).toMatchObject({
      showOutlierPoints: true,
      showOutliers: true,
      showMeanMarkers: false,
      showMeanLine: true,
      quartileMethod: 'inclusive',
    });
    expect(config.hierarchy).toMatchObject({ parentLabelLayout: 'banner' });
    expect(config.regionMap).toMatchObject({ regionFormula: 'Sheet1!A1:A3' });
  });

  it('forwards imported chart style fields into the render config', () => {
    const config = toChartConfig(
      chart({
        roundedCorners: true,
        autoTitleDeleted: false,
        showDataLabelsOverMax: true,
        titleRichText: [{ text: 'Revenue', font: { bold: true } }],
        dataTable: { visible: true, showHorzBorder: true },
        colorScheme: 12,
        ooxml: {
          definition: {
            _kind: 'chart',
            clr_map_ovr: {
              OverrideClrMapping: {
                bg1: 'Dk2',
                tx1: 'Accent2',
                fol_hlink: 'Hlink',
              },
            },
          },
        },
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.roundedCorners).toBe(true);
    expect(config.showDataLabelsOverMaximum).toBe(true);
    expect(config.titleRichText).toEqual([{ text: 'Revenue', font: { bold: true } }]);
    expect(config.dataTable).toMatchObject({ visible: true, showHorzBorder: true });
    expect(config.colorScheme).toBe(12);
    expect(config.chartStyleContext?.colorMapOverride).toEqual({
      type: 'override',
      mapping: { bg1: 'Dk2', tx1: 'Accent2', folHlink: 'Hlink' },
    });
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
