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
});
