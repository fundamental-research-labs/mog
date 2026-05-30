import { normalizeImportedComboChart } from '../chart-import-normalization';

const group = (chartType: string, seriesIndices: number[]) => ({
  chartType,
  configTemplate: {},
  seriesIndices,
});

describe('normalizeImportedComboChart', () => {
  it('keeps repeated imported chart groups on their single chart family', () => {
    const normalized = normalizeImportedComboChart({
      chartType: 'combo',
      rt: {
        chartGroupsMeta: [group('line', [0]), group('line', [1])],
      },
      series: [{}, {}],
    });

    expect(normalized.chartType).toBe('line');
    expect(normalized.series).toEqual([{ type: 'line' }, { type: 'line' }]);
  });

  it('keeps mixed imported chart groups as combo', () => {
    const normalized = normalizeImportedComboChart({
      chartType: 'column',
      rt: {
        chartGroupsMeta: [group('area', [0]), group('line', [1])],
      },
      series: [{}, {}],
    });

    expect(normalized.chartType).toBe('combo');
    expect(normalized.series).toEqual([{ type: 'area' }, { type: 'line' }]);
  });

  it('collapses imported combo charts with uniform series types when group metadata is absent', () => {
    const normalized = normalizeImportedComboChart({
      chartType: 'combo',
      series: [{ type: 'line' }, { type: 'line' }],
    });

    expect(normalized.chartType).toBe('line');
    expect(normalized.series).toEqual([{ type: 'line' }, { type: 'line' }]);
  });

  it('keeps imported combo charts with mixed series types when group metadata is absent', () => {
    const normalized = normalizeImportedComboChart({
      chartType: 'combo',
      series: [{ type: 'area' }, { type: 'line' }],
    });

    expect(normalized.chartType).toBe('combo');
    expect(normalized.series).toEqual([{ type: 'area' }, { type: 'line' }]);
  });

  it('does not infer chart type from partially typed series', () => {
    const normalized = normalizeImportedComboChart({
      chartType: 'combo',
      series: [{ type: 'line' }, {}],
    });

    expect(normalized.chartType).toBe('combo');
    expect(normalized.series).toEqual([{ type: 'line' }, {}]);
  });

  it('binds percent-formatted cached series to a modeled secondary percent axis', () => {
    const normalized = normalizeImportedComboChart({
      chartType: 'combo',
      axis: {
        valueAxis: { visible: true, min: 0, max: 50000000, numberFormat: '"$"#,##0' },
        secondaryValueAxis: { visible: true, min: -0.2, max: 0.3, numberFormat: '0%' },
      },
      series: [
        {
          name: 'Revenue',
          type: 'area',
          valueCache: { pointCount: 2, points: [{ idx: 0, value: '10000000' }] },
        },
        {
          name: 'Y/Y %',
          type: 'column',
          valueCache: {
            pointCount: 2,
            points: [
              { idx: 0, value: '0.12', formatCode: '#,##0%' },
              { idx: 1, value: '-0.03', formatCode: '#,##0%' },
            ],
          },
        },
      ],
    });

    expect(normalized.series?.[0]?.yAxisIndex).toBeUndefined();
    expect(normalized.series?.[1]?.yAxisIndex).toBe(1);
  });

  it('binds cached values that fit only the secondary value-axis domain', () => {
    const normalized = normalizeImportedComboChart({
      chartType: 'combo',
      axis: {
        valueAxis: { visible: true, min: 0, max: 50000000 },
        secondaryValueAxis: { visible: true, min: -0.2, max: 0.3 },
      },
      series: [
        {
          name: 'Rate',
          type: 'line',
          valueCache: {
            pointCount: 3,
            points: [
              { idx: 0, value: '0.1' },
              { idx: 1, value: '-0.05' },
              { idx: 2, value: '0.25' },
            ],
          },
        },
      ],
    });

    expect(normalized.series?.[0]?.yAxisIndex).toBe(1);
  });

  it('preserves explicit series y-axis bindings', () => {
    const normalized = normalizeImportedComboChart({
      chartType: 'combo',
      axis: {
        valueAxis: { visible: true, min: 0, max: 50000000, numberFormat: '"$"#,##0' },
        secondaryValueAxis: { visible: true, min: -0.2, max: 0.3, numberFormat: '0%' },
      },
      series: [
        {
          name: 'Already primary',
          type: 'column',
          yAxisIndex: 0,
          valueCache: {
            pointCount: 1,
            points: [{ idx: 0, value: '0.12', formatCode: '#,##0%' }],
          },
        },
      ],
    });

    expect(normalized.series?.[0]?.yAxisIndex).toBe(0);
  });
});
