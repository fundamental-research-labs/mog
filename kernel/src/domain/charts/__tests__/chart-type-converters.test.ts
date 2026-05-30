import {
  seriesConfigToWire,
  wireToLegendConfig,
  wireToSeriesConfig,
} from '../chart-type-converters';

describe('chart-type-converters', () => {
  it('reconciles imported legend visibility when OOXML preserved visible=true with show=false', () => {
    expect(
      wireToLegendConfig({
        show: false,
        visible: true,
        position: 'right',
      }),
    ).toEqual(
      expect.objectContaining({
        show: true,
        visible: true,
        position: 'right',
      }),
    );
  });

  it('preserves imported category label format metadata on series configs', () => {
    expect(
      wireToSeriesConfig({
        name: 'Forecast',
        categoryLabelFormat: {
          formatCode: '"FY3/"0',
          points: [{ idx: 7, formatCode: '"FY3/"0"E"' }],
        },
      }),
    ).toEqual(
      expect.objectContaining({
        categoryLabelFormat: {
          formatCode: '"FY3/"0',
          points: [{ idx: 7, formatCode: '"FY3/"0"E"' }],
        },
      }),
    );
  });

  it('round-trips imported sparse point caches on series configs', () => {
    const seriesConfig = wireToSeriesConfig({
      name: 'Imported',
      valueCache: {
        pointCount: 4,
        formatCode: 'General',
        points: [
          { idx: 1, value: '0', formatCode: '0%' },
          { idx: 3, value: '4.5' },
        ],
      },
      categoryCache: {
        pointCount: 4,
        formatCode: 'm/d/yyyy',
        points: [{ idx: 0, value: '45292' }],
      },
      bubbleSizeCache: {
        pointCount: 2,
        points: [{ idx: 1, value: '10' }],
      },
    });

    expect(seriesConfig.valueCache).toEqual({
      pointCount: 4,
      formatCode: 'General',
      points: [
        { idx: 1, value: '0', formatCode: '0%' },
        { idx: 3, value: '4.5' },
      ],
    });
    expect(seriesConfig.categoryCache?.points).toEqual([{ idx: 0, value: '45292' }]);
    expect(seriesConfig.bubbleSizeCache?.points).toEqual([{ idx: 1, value: '10' }]);
    expect(seriesConfigToWire(seriesConfig)).toEqual(
      expect.objectContaining({
        valueCache: seriesConfig.valueCache,
        categoryCache: seriesConfig.categoryCache,
        bubbleSizeCache: seriesConfig.bubbleSizeCache,
      }),
    );
  });
});
