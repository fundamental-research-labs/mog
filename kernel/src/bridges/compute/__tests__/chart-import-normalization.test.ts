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
});
