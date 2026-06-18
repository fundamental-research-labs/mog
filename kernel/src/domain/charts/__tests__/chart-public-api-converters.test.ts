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
});
