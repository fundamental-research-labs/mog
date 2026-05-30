import { wireToLegendConfig } from '../chart-type-converters';

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
});
