import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import {
  chartConfigToInternal,
  chartUpdatesToInternal,
  serializedChartToChart,
} from '../chart-public-api-converters';

const EMU_PER_PT = 12700;

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
  it('stores SDK chart dimensions as point geometry', () => {
    const internal = chartConfigToInternal({
      type: 'bar',
      anchorRow: 0,
      anchorCol: 0,
      width: 480,
      height: 225,
      dataRange: 'A1:B2',
    });

    expect(internal.width).toBe(640);
    expect(internal.height).toBe(300);
    expect(internal.widthCells).toBeUndefined();
    expect(internal.heightCells).toBeUndefined();
    expect(internal.widthPt).toBe(480);
    expect(internal.heightPt).toBe(225);
    expect(internal.anchor.extentCxEmu).toBe(480 * EMU_PER_PT);
    expect(internal.anchor.extentCyEmu).toBe(225 * EMU_PER_PT);
  });

  it('reports imported pixel geometry as SDK chart point dimensions', () => {
    const publicChart = serializedChartToChart(
      chart({
        width: 640,
        height: 300,
        dataRange: 'Sheet1!A1:B2',
      }),
    );

    expect(publicChart.width).toBe(480);
    expect(publicChart.height).toBe(225);
  });

  it('reports drawing z-index as read-only public chart metadata', () => {
    const publicChart = serializedChartToChart(chart({ zIndex: 7 }));

    expect(publicChart.zIndex).toBe(7);
  });

  it('uses pixel geometry ahead of stale cell spans on read', () => {
    const publicChart = serializedChartToChart(
      chart({
        width: 800,
        height: 400,
        widthCells: 4,
        heightCells: 5,
      }),
    );

    expect(publicChart.width).toBe(600);
    expect(publicChart.height).toBe(300);
  });

  it('privately converts cell-only stored dimensions to SDK chart point dimensions', () => {
    const publicChart = serializedChartToChart(
      chart({
        width: 0,
        height: 0,
        widthCells: 8,
        heightCells: 15,
      }),
    );

    expect(publicChart.width).toBe(480);
    expect(publicChart.height).toBe(225);
  });

  it('reports imported anchor extents as SDK chart point dimensions', () => {
    const publicChart = serializedChartToChart(
      chart({
        width: 3360,
        height: 840,
        dataRange: 'Sheet1!A1:B2',
        anchor: {
          anchorRow: 0,
          anchorCol: 0,
          anchorMode: 'oneCell',
          extentCxEmu: 480 * EMU_PER_PT,
          extentCyEmu: 225 * EMU_PER_PT,
        },
      }),
    );

    expect(publicChart.width).toBe(480);
    expect(publicChart.height).toBe(225);
    expect(publicChart.widthPt).toBe(480);
    expect(publicChart.heightPt).toBe(225);
  });

  it('derives public top-level source ranges from lossless imported series refs', () => {
    const publicChart = serializedChartToChart(
      chart({
        chartType: 'area',
        dataRange: 'A1:D5',
        series: [
          { nameRef: 'B1', values: 'B2:B5', categories: 'A2:A5' },
          { nameRef: 'C1', values: 'C2:C5', categories: 'A2:A5' },
          { nameRef: 'D1', values: 'D2:D5', categories: 'A2:A5' },
        ],
      }),
    );

    expect(publicChart.categoryRange).toBe('A2:A5');
    expect(publicChart.seriesRange).toBe('B1:D1');
    expect(publicChart.series?.map((series) => series.nameRef)).toEqual(['B1', 'C1', 'D1']);
  });

  it('normalizes derived public source ranges with sheet-qualified refs', () => {
    const publicChart = serializedChartToChart(
      chart({
        chartType: 'column',
        dataRange: "'Q1 Data'!$A$1:$C$5",
        series: [
          {
            nameRef: "'Q1 Data'!$B$1",
            values: "'Q1 Data'!$B$2:$B$5",
            categories: "'Q1 Data'!$A$2:$A$5",
          },
          {
            nameRef: "'Q1 Data'!$C$1",
            values: "'Q1 Data'!$C$2:$C$5",
            categories: "'Q1 Data'!$A$2:$A$5",
          },
        ],
      }),
    );

    expect(publicChart.categoryRange).toBe("'Q1 Data'!A2:A5");
    expect(publicChart.seriesRange).toBe("'Q1 Data'!B1:C1");
  });

  it('does not derive public source ranges when series refs are not lossless', () => {
    const publicChart = serializedChartToChart(
      chart({
        chartType: 'bar',
        dataRange: 'A1:D5',
        series: [
          { nameRef: 'B1', values: 'B2:B5', categories: 'A2:A5' },
          { nameRef: 'D1', values: 'D2:D5', categories: 'A3:A6' },
        ],
      }),
    );

    expect(publicChart.categoryRange).toBeUndefined();
    expect(publicChart.seriesRange).toBeUndefined();
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

  it('syncs point size updates to pixel geometry and physical extents', () => {
    const internal = chartUpdatesToInternal({
      width: 480,
      height: 225,
      leftPt: 18,
      topPt: 9,
    });

    expect(internal.widthCells).toBeUndefined();
    expect(internal.heightCells).toBeUndefined();
    expect(internal.widthPt).toBe(480);
    expect(internal.heightPt).toBe(225);
    expect(internal.leftPt).toBe(18);
    expect(internal.topPt).toBe(9);
    expect(internal.width).toBe(640);
    expect(internal.height).toBe(300);
    expect(internal.anchor?.extentCxEmu).toBe(480 * EMU_PER_PT);
    expect(internal.anchor?.extentCyEmu).toBe(225 * EMU_PER_PT);
    expect(internal.anchor?.anchorColOffsetEmu).toBe(18 * EMU_PER_PT);
    expect(internal.anchor?.anchorRowOffsetEmu).toBe(9 * EMU_PER_PT);
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
