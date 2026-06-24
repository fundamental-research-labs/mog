import { wireToAxisConfig } from '../chart-type-converters';

describe('chart axis converters', () => {
  it('treats non-explicit false wire visibility as default-visible', () => {
    expect(
      wireToAxisConfig({
        categoryAxis: { visible: false, visibleExplicit: false },
        valueAxis: { visible: false },
      } as any),
    ).toEqual(
      expect.objectContaining({
        categoryAxis: expect.objectContaining({ visible: true, visibleExplicit: false }),
        valueAxis: expect.objectContaining({ visible: true }),
      }),
    );
  });

  it('preserves explicitly hidden axes', () => {
    expect(
      wireToAxisConfig({
        categoryAxis: { visible: false, visibleExplicit: true },
      } as any),
    ).toEqual(
      expect.objectContaining({
        categoryAxis: expect.objectContaining({ visible: false, visibleExplicit: true }),
      }),
    );
  });
});
