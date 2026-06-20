import {
  normalizeAxisConfig,
  normalizeChartConfig,
  normalizeLegendConfig,
  normalizePieSliceConfig,
  normalizeStoredChartConfigUpdate,
} from '../chart-config-adapter';

describe('chart config adapter', () => {
  it('fills missing legend visible from the display toggle', () => {
    expect(normalizeLegendConfig({ show: true, position: 'right' })).toEqual({
      show: true,
      position: 'right',
      visible: true,
    });

    expect(normalizeLegendConfig({ show: false, position: 'bottom' })).toEqual({
      show: false,
      position: 'bottom',
      visible: false,
    });
  });

  it('keeps legend show and visible in sync when legacy input diverges', () => {
    expect(normalizeLegendConfig({ show: false, visible: true, position: 'top' })).toMatchObject({
      show: false,
      visible: false,
      position: 'top',
    });

    expect(normalizeLegendConfig({ visible: true, position: 'none' })).toMatchObject({
      show: false,
      visible: false,
      position: 'none',
    });
  });

  it('fills axis visibility and mirrors canonical axis slots to legacy render aliases', () => {
    const axis = normalizeAxisConfig({
      xAxis: { type: 'category', title: 'Month', gridLines: false },
      yAxis: { type: 'value', title: 'Revenue', gridLines: true },
    });

    expect(axis.categoryAxis).toEqual({
      type: 'category',
      axisType: 'category',
      title: 'Month',
      gridLines: false,
      visible: true,
      show: true,
    });
    expect(axis.valueAxis).toEqual({
      type: 'value',
      axisType: 'value',
      title: 'Revenue',
      gridLines: true,
      visible: true,
      show: true,
    });
    expect(axis.xAxis).toBe(axis.categoryAxis);
    expect(axis.yAxis).toBe(axis.valueAxis);
  });

  it('maps legacy single exploded index to explodedIndices and drops UI-only selectable', () => {
    const pieSlice = normalizePieSliceConfig({
      explodedIndex: 2,
      explodeOffset: 0.12,
      selectable: true,
    });

    expect(pieSlice).toEqual({
      explodedIndices: [2],
      explodeOffset: 0.12,
    });
    expect('selectable' in pieSlice).toBe(false);
  });

  it('normalizes full chart create payloads before worksheet boundaries', () => {
    const config = normalizeChartConfig({
      type: 'column',
      anchorRow: 2,
      anchorCol: 3,
      width: 480,
      height: 225,
      dataRange: 'A1:B5',
      legend: { show: true, position: 'right' },
      axis: {
        xAxis: { type: 'category', title: 'Category' },
        yAxis: { type: 'value', title: 'Value', visible: false },
      },
      pieSlice: { explodedIndex: 1, selectable: true },
    });

    expect(config.legend).toMatchObject({ show: true, visible: true, position: 'right' });
    expect(config.axis?.categoryAxis?.visible).toBe(true);
    expect(config.axis?.valueAxis?.visible).toBe(false);
    expect(config.pieSlice).toEqual({ explodedIndices: [1] });
  });

  it('normalizes partial stored chart updates for hook/editor callers', () => {
    const updates = normalizeStoredChartConfigUpdate({
      legend: { show: false, position: 'bottom' },
      axis: {
        xAxis: { title: 'Quarter' },
      },
      pieSlice: {
        explodedIndex: 0,
        selectable: false,
      },
    });

    expect(updates.legend).toEqual({ show: false, position: 'bottom', visible: false });
    expect(updates.axis?.categoryAxis).toMatchObject({ title: 'Quarter', visible: true });
    expect(updates.pieSlice).toEqual({ explodedIndices: [0] });
  });
});
