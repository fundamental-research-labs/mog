import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { chartConfigToInternal, serializedChartToChart } from '../chart-public-api-converters';

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
});
