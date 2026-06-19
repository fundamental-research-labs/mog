import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import {
  chartConfigToInternal,
  chartUpdatesToInternal,
  serializedChartToChart,
} from '../chart-public-api-converters';

function chart(overrides: Partial<ChartFloatingObject> = {}): ChartFloatingObject {
  return {
    id: 'chart-1',
    type: 'chart',
    chartType: 'bar',
    sheetId: 'sheet-1',
    anchor: { anchorRow: 0, anchorCol: 0, anchorMode: 'oneCell' },
    width: 0,
    height: 0,
    zIndex: 0,
    rotation: 0,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
    printable: true,
    opacity: 1,
    name: '',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as ChartFloatingObject;
}

describe('chart public API converters', () => {
  it('stores SDK chart dimensions as pixel geometry and explicit cell spans', () => {
    const internal = chartConfigToInternal({
      type: 'bar',
      anchorRow: 0,
      anchorCol: 0,
      width: 42,
      height: 43,
      dataRange: 'A1:B2',
    });

    expect(internal.width).toBe(3360);
    expect(internal.height).toBe(860);
    expect(internal.widthCells).toBe(42);
    expect(internal.heightCells).toBe(43);
  });

  it('reports imported pixel geometry as SDK chart cell spans', () => {
    const publicChart = serializedChartToChart(
      chart({
        width: 3360,
        height: 840,
        dataRange: 'Sheet1!A1:B2',
      }),
    );

    expect(publicChart.width).toBe(42);
    expect(publicChart.height).toBe(42);
  });

  it('derives line-family series color from line format on read and write', () => {
    const publicChart = serializedChartToChart(
      chart({
        chartType: 'line',
        dataRange: 'Sheet1!A1:B5',
        series: [
          {
            name: 'Revenue',
            values: 'Sheet1!B2:B5',
            format: { line: { color: '4472C4' } },
          },
        ],
      }),
    );

    expect(publicChart.series?.[0]?.color).toBe('#4472C4');

    const internal = chartConfigToInternal({
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      dataRange: 'A1:B5',
      series: [
        {
          name: 'Revenue',
          values: 'B2:B5',
          format: { line: { color: '#4472C4' } },
        },
      ],
    });

    expect(internal.series?.[0]?.color).toBe('4472C4');
  });

  it('does not derive fill-family series color from border line format', () => {
    const publicChart = serializedChartToChart(
      chart({
        chartType: 'bar',
        dataRange: 'Sheet1!A1:B5',
        series: [
          {
            name: 'Revenue',
            values: 'Sheet1!B2:B5',
            format: { line: { color: 'ED7D31' } },
          },
        ],
      }),
    );

    expect(publicChart.series?.[0]?.color).toBeUndefined();
    expect(publicChart.series?.[0]?.format?.line?.color).toBe('#ED7D31');

    const internal = chartConfigToInternal({
      type: 'bar',
      anchorRow: 0,
      anchorCol: 0,
      dataRange: 'A1:B5',
      series: [
        {
          name: 'Revenue',
          values: 'B2:B5',
          format: { line: { color: '#ED7D31' } },
        },
      ],
    });

    expect(internal.series?.[0]?.color).toBeUndefined();
    expect(internal.series?.[0]?.format?.line?.color).toBe('ED7D31');
  });

  it('reports chart-level trendline aliases from first-series trendlines', () => {
    const publicChart = serializedChartToChart(
      chart({
        chartType: 'scatter',
        series: [
          {
            name: 'Series 1',
            values: 'Sheet1!B2:B5',
            categories: 'Sheet1!A2:A5',
            trendlines: [
              {
                show: true,
                type: 'linear',
                lineFormat: { noFill: true },
                label: {
                  text: 'Fit',
                  format: { line: { noFill: true } },
                },
              },
            ],
          },
        ],
      }),
    );

    expect(publicChart.trendline).toMatchObject({
      show: true,
      type: 'linear',
      lineFormat: { noFill: true },
      label: {
        text: 'Fit',
        format: { line: { noFill: true } },
      },
    });
    expect(publicChart.trendlines).toEqual([publicChart.trendline]);
  });

  it('derives series color from line-rendering series traits when chart family metadata is degraded', () => {
    const publicChart = serializedChartToChart(
      chart({
        chartType: 'column',
        dataRange: 'Sheet1!A1:B5',
        series: [
          {
            name: 'Revenue',
            values: 'Sheet1!B2:B5',
            showMarkers: true,
            format: { line: { color: '4472C4' } },
          },
        ],
      }),
    );

    expect(publicChart.series?.[0]?.color).toBe('#4472C4');
  });

  it('stores public chart-type aliases as canonical native chart fields', () => {
    expect(
      chartConfigToInternal({
        type: 'lineMarkersStacked100',
        anchorRow: 0,
        anchorCol: 0,
        dataRange: 'A1:B5',
        varyByCategories: true,
      }),
    ).toMatchObject({
      chartType: 'line',
      subType: 'markersPercentStacked',
      varyByCategories: true,
    });

    expect(
      chartConfigToInternal({
        type: 'coneBarStacked100',
        anchorRow: 0,
        anchorCol: 0,
        dataRange: 'A1:B5',
      }),
    ).toMatchObject({
      chartType: 'bar3d',
      subType: 'percentStacked',
      barShape: 'cone',
    });

    expect(
      chartConfigToInternal({
        type: 'bubble3DEffect',
        anchorRow: 0,
        anchorCol: 0,
        dataRange: 'A1:C5',
      }),
    ).toMatchObject({
      chartType: 'bubble',
      bubble3dEffect: true,
    });

    expect(
      chartConfigToInternal({
        type: 'surfaceTopViewWireframe',
        anchorRow: 0,
        anchorCol: 0,
        dataRange: 'A1:C5',
      }),
    ).toMatchObject({
      chartType: 'surface',
      wireframe: true,
      surfaceTopView: true,
    });
  });

  it('normalizes public chart-type aliases in chart updates', () => {
    expect(chartUpdatesToInternal({ type: 'cylinderColStacked' })).toMatchObject({
      chartType: 'column3d',
      subType: 'stacked',
      barShape: 'cylinder',
    });
    expect(chartUpdatesToInternal({ type: 'surfaceWireframe' })).toMatchObject({
      chartType: 'surface3d',
      wireframe: true,
      surfaceTopView: false,
    });
  });

  it('syncs series axis text orientation through the native axis text format', () => {
    const internal = chartConfigToInternal({
      type: 'area3d',
      dataRange: 'A1:D5',
      axis: {
        seriesAxis: {
          visible: true,
          axisType: 'serAx',
          textOrientation: 45,
        },
      },
    });

    expect(internal.axis?.seriesAxis?.textOrientation).toBe(45);
    expect(internal.axis?.seriesAxis?.format?.textRotation).toBe(45);

    const publicChart = serializedChartToChart(
      chart({
        chartType: 'area3D',
        axis: {
          seriesAxis: {
            visible: true,
            axisType: 'serAx',
            format: { textRotation: 45 },
          },
        },
      }),
    );

    expect(publicChart.axis?.seriesAxis?.textOrientation).toBe(45);
    expect(publicChart.axis?.seriesAxis?.format?.textRotation).toBe(45);
  });
});
