import { computeInitLayoutMetrics } from '../runtime-layout';

describe('computeInitLayoutMetrics', () => {
  it('returns null outside browser-like runtimes', () => {
    expect(computeInitLayoutMetrics({})).toBeNull();
    expect(computeInitLayoutMetrics({ window: {} })).toBeNull();
  });

  it('uses the macOS layout metrics for Mac browser platforms', () => {
    expect(computeInitLayoutMetrics({ window: { navigator: { platform: 'MacIntel' } } })).toEqual({
      columnWidthMdw: 8,
      defaultColumnWidthPx: 72,
      defaultRowHeightPx: 20,
    });
    expect(
      computeInitLayoutMetrics({
        window: { navigator: { userAgentData: { platform: 'macOS' } } },
      }),
    ).toEqual({
      columnWidthMdw: 8,
      defaultColumnWidthPx: 72,
      defaultRowHeightPx: 20,
    });
  });

  it('uses the Windows/Linux layout metrics for non-Mac browser platforms', () => {
    expect(computeInitLayoutMetrics({ window: { navigator: { platform: 'Win32' } } })).toEqual({
      columnWidthMdw: 7,
      defaultColumnWidthPx: 64,
      defaultRowHeightPx: 20,
    });
  });
});
