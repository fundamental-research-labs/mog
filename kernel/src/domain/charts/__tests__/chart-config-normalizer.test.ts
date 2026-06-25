import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { toChartConfig, unsupportedChartTypeError } from '../bridge/chart-config-normalizer';

const SHEET_A: SheetId = toSheetId('sheet-a');
const CHART_ID = 'chart-1';
const EMU_PER_PT = 12700;

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
        width: 640,
        heightCells: 3,
        height: 300,
        axis: {
          categoryAxis: { axisType: 'dateAxis', visible: false, visibleExplicit: true },
          valueAxis: { axisType: 'value', visible: true },
          secondaryCategoryAxis: { axisType: 'dateAxis', visible: true, position: 't' },
        },
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.type).toBe('line');
    expect(config.width).toBe(480);
    expect(config.height).toBe(225);
    expect(config.axis?.xAxis).toMatchObject({ type: 'dateAxis', show: false });
    expect(config.axis?.yAxis).toMatchObject({ type: 'value', show: true });
    expect(config.axis?.secondaryCategoryAxis).toMatchObject({
      type: 'dateAxis',
      show: true,
      position: 't',
    });
  });

  it('derives render point dimensions from imported pixel geometry', () => {
    const config = toChartConfig(
      chart({
        widthCells: undefined,
        heightCells: undefined,
        width: 640,
        height: 300,
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.width).toBe(480);
    expect(config.height).toBe(225);
  });

  it('uses pixel geometry ahead of stale cell spans for render configs', () => {
    const config = toChartConfig(
      chart({
        width: 800,
        height: 400,
        widthCells: 4,
        heightCells: 5,
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.width).toBe(600);
    expect(config.height).toBe(300);
  });

  it('privately converts cell-only stored dimensions for render configs', () => {
    const config = toChartConfig(
      chart({
        width: 0,
        height: 0,
        widthCells: 8,
        heightCells: 15,
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.width).toBe(480);
    expect(config.height).toBe(225);
  });

  it('derives render point dimensions from imported anchor extents', () => {
    const config = toChartConfig(
      chart({
        widthPt: 1,
        heightPt: 1,
        anchor: {
          anchorRow: 0,
          anchorCol: 0,
          anchorCellId: 'cell-0' as never,
          extentCxEmu: 480 * EMU_PER_PT,
          extentCyEmu: 225 * EMU_PER_PT,
        },
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.widthPt).toBe(480);
    expect(config.heightPt).toBe(225);
    expect(config.width).toBe(480);
    expect(config.height).toBe(225);
  });

  it('maps imported bubble value-axis pairs to XY axes and suppresses invalid shared-side labels', () => {
    const config = toChartConfig(
      chart({
        chartType: 'bubble',
        axis: {
          valueAxis: {
            axisType: 'valAx',
            visible: true,
            position: 'l',
            gridLines: true,
            tickMarks: 'none',
          },
          secondaryValueAxis: {
            axisType: 'valAx',
            visible: true,
            position: 'l',
            gridLines: true,
            tickMarks: 'none',
          },
        },
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.axis?.xAxis).toMatchObject({
      type: 'valAx',
      show: true,
      position: 'l',
      tickLabelPosition: 'none',
    });
    expect(config.axis?.yAxis).toMatchObject({
      type: 'valAx',
      show: true,
      position: 'l',
      tickLabelPosition: 'none',
    });
    expect(config.axis?.valueAxis).toMatchObject({ tickLabelPosition: 'none' });
    expect(config.axis?.secondaryValueAxis).toBeUndefined();
  });

  it('suppresses render labels for imported column axes sharing the left side', () => {
    const config = toChartConfig(
      chart({
        chartType: 'column',
        axis: {
          categoryAxis: {
            axisType: 'catAx',
            visible: true,
            position: 'l',
            tickMarks: 'none',
            minorTickMarks: 'none',
          },
          valueAxis: {
            axisType: 'valAx',
            visible: true,
            position: 'l',
            tickMarks: 'none',
            minorTickMarks: 'none',
          },
        },
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.axis?.categoryAxis?.tickLabelPosition).toBe('none');
    expect(config.axis?.valueAxis?.tickLabelPosition).toBe('none');
    expect(config.axis?.xAxis).toMatchObject({ position: 'l', tickLabelPosition: 'none' });
    expect(config.axis?.yAxis).toMatchObject({ position: 'l', tickLabelPosition: 'none' });
  });

  it('keeps imported scatter value-axis pair labels when positions match XY geometry', () => {
    const config = toChartConfig(
      chart({
        chartType: 'scatter',
        axis: {
          valueAxis: { axisType: 'valAx', visible: true, position: 'b' },
          secondaryValueAxis: { axisType: 'valAx', visible: true, position: 'l' },
        },
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.axis?.xAxis).toMatchObject({ position: 'b' });
    expect(config.axis?.xAxis?.tickLabelPosition).toBeUndefined();
    expect(config.axis?.yAxis).toMatchObject({ position: 'l' });
    expect(config.axis?.yAxis?.tickLabelPosition).toBeUndefined();
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
        chartFormat: { fill: { type: 'solid', color: { theme: 'accent1', tint_shade: 0.1 } } },
        plotFormat: { line: { color: { theme: 'accent2', tint_shade: -0.1 } } },
        titleFormat: { font: { color: { theme: 'accent3', tint_shade: 0.2 } } },
        titleRichText: [
          { text: 'Revenue', font: { bold: true, color: { theme: 'accent4', tint_shade: 0.3 } } },
        ],
        plotLayout: { layoutTarget: 'inner', x: 0.1, y: 0.2, w: 0.7, h: 0.6 },
        titleLayout: { xMode: 'factor', x: 0.15, y: 0.05 },
        dataTable: {
          visible: true,
          showHorzBorder: true,
          format: { shadow: { color: { theme: 'accent5', tint_shade: 0.4 } } },
        },
        pivotOptions: { showAxisFieldButtons: false },
        pivotProjection: {
          sourceRef: 'Pivot!A3',
          pivotTableName: 'PivotTable1',
          authority: 'pivotCache',
          expectedImportedSeriesCount: 3,
          projectedSeriesCount: 2,
          renderedSeriesCount: 2,
          diagnostics: [{ reason: 'hiddenDataField', message: 'Hidden data field omitted' }],
        },
        bubbleScale: 175,
        showNegBubbles: true,
        sizeRepresents: 'w',
        bubble3dEffect: true,
        view3d: { rotX: 30, rotY: 20, depthPercent: 150 },
        floorFormat: { fill: { type: 'solid', color: { theme: 'lt1', tint_shade: -0.2 } } },
        sideWallFormat: { line: { color: { theme: 'dk1', tint_shade: 0.25 } } },
        backWallFormat: { font: { color: { theme: 'tx1', tint_shade: -0.25 } } },
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
    expect(config.chartFormat?.fill).toEqual({
      type: 'solid',
      color: { theme: 'accent1', tintShade: 0.1 },
    });
    expect(config.plotFormat?.line?.color).toEqual({ theme: 'accent2', tintShade: -0.1 });
    expect(config.titleFormat?.font?.color).toEqual({ theme: 'accent3', tintShade: 0.2 });
    expect(config.titleRichText).toEqual([
      { text: 'Revenue', font: { bold: true, color: { theme: 'accent4', tintShade: 0.3 } } },
    ]);
    expect(config.plotLayout).toEqual({ layoutTarget: 'inner', x: 0.1, y: 0.2, w: 0.7, h: 0.6 });
    expect(config.titleLayout).toEqual({ xMode: 'factor', x: 0.15, y: 0.05 });
    expect(config.dataTable).toMatchObject({ visible: true, showHorzBorder: true });
    expect(config.dataTable?.format?.shadow?.color).toEqual({
      theme: 'accent5',
      tintShade: 0.4,
    });
    expect(config.pivotOptions).toEqual({ showAxisFieldButtons: false });
    expect(config.pivotProjection).toMatchObject({
      sourceRef: 'Pivot!A3',
      pivotTableName: 'PivotTable1',
      authority: 'pivotCache',
      expectedImportedSeriesCount: 3,
      projectedSeriesCount: 2,
      renderedSeriesCount: 2,
      diagnostics: [{ reason: 'hiddenDataField', message: 'Hidden data field omitted' }],
    });
    expect(config.bubbleScale).toBe(175);
    expect(config.showNegBubbles).toBe(true);
    expect(config.sizeRepresents).toBe('w');
    expect(config.bubble3DEffect).toBe(true);
    expect(config.view3d).toEqual({ rotX: 30, rotY: 20, depthPercent: 150 });
    expect(config.floorFormat?.fill).toEqual({
      type: 'solid',
      color: { theme: 'lt1', tintShade: -0.2 },
    });
    expect(config.sideWallFormat?.line?.color).toEqual({ theme: 'dk1', tintShade: 0.25 });
    expect(config.backWallFormat?.font?.color).toEqual({ theme: 'tx1', tintShade: -0.25 });
    expect(config.colorScheme).toBe(12);
    expect(config.chartStyleContext?.colorMapOverride).toEqual({
      type: 'override',
      mapping: { bg1: 'Dk2', tx1: 'Accent2', folHlink: 'Hlink' },
    });
    expect(config.extra).toEqual({
      imported: true,
      sourceDialect: 'ooxml',
      sourceChartType: 'bar',
      sourceFamily: 'bar',
    });
    expect(config.extra).not.toHaveProperty('definition');
  });

  it('prefers generated chart style context over the OOXML compatibility fallback', () => {
    const config = toChartConfig(
      chart({
        chartStyleContext: {
          colorMapOverride: { type: 'master' },
          owners: [
            {
              ownerKey: 'title',
              format: {
                fill: { type: 'solid', color: { theme: 'accent1', tint_shade: 0.15 } },
              },
              richText: [
                { text: 'Generated', font: { color: { theme: 'accent2', tint_shade: -0.15 } } },
              ],
            },
          ],
        },
        ooxml: {
          definition: {
            _kind: 'chart',
            clr_map_ovr: {
              OverrideClrMapping: { tx1: 'Accent2' },
            },
          },
        },
      } as unknown as Partial<ChartFloatingObject>),
    );

    expect(config.chartStyleContext).toEqual({
      colorMapOverride: { type: 'master' },
      owners: [
        {
          ownerKey: 'title',
          format: {
            fill: { type: 'solid', color: { theme: 'accent1', tintShade: 0.15 } },
          },
          richText: [
            { text: 'Generated', font: { color: { theme: 'accent2', tintShade: -0.15 } } },
          ],
        },
      ],
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
