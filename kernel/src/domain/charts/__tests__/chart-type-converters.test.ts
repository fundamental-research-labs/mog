import { wireToLegendConfig, wireToSeriesConfig } from '../chart-type-converters';

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
});
