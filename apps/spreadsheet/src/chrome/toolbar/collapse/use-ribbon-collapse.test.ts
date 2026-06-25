import { __testing__ } from './use-ribbon-collapse';

describe('ribbon collapse breakpoints', () => {
  it('keeps the full ribbon mode for desktop widths', () => {
    expect(__testing__.computeCollapseLevel(1600)).toBe(0);
    expect(__testing__.computeCollapseLevel(1599)).toBe(1);
  });

  it('keeps existing lower-width collapse levels stable', () => {
    expect(__testing__.computeCollapseLevel(1200)).toBe(1);
    expect(__testing__.computeCollapseLevel(1024)).toBe(2);
    expect(__testing__.computeCollapseLevel(900)).toBe(3);
    expect(__testing__.computeCollapseLevel(640)).toBe(4);
  });

  it('re-expands after a width-only collapse when no overflow escalation is pending', () => {
    expect(
      __testing__.resolveWidthCollapseLevel(
        1800,
        __testing__.computeCollapseLevel(1800),
        3,
        Number.POSITIVE_INFINITY,
      ).level,
    ).toBe(0);
  });

  it('keeps overflow escalation until the release width is crossed', () => {
    expect(
      __testing__.resolveWidthCollapseLevel(1400, __testing__.computeCollapseLevel(1400), 2, 1500)
        .level,
    ).toBe(2);

    expect(
      __testing__.resolveWidthCollapseLevel(1608, __testing__.computeCollapseLevel(1608), 2, 1500)
        .level,
    ).toBe(0);
  });
});
