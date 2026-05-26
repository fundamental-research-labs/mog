import {
  clampScrollPosition,
  clampZoom,
  computeScrollbarThumb,
  stepZoom,
} from '../viewport-chrome';

describe('viewport chrome math', () => {
  it('clamps scroll positions to max extents', () => {
    expect(clampScrollPosition({ x: -10, y: 500 }, { x: 100, y: 120 })).toEqual({
      x: 0,
      y: 120,
    });
    expect(clampScrollPosition({ x: 80, y: 90 }, { x: 100, y: 120 })).toEqual({
      x: 80,
      y: 90,
    });
  });

  it('clamps non-finite scroll positions to zero', () => {
    expect(clampScrollPosition({ x: Number.NaN, y: Infinity }, { x: 100, y: 100 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('computes proportional scrollbar thumbs', () => {
    expect(computeScrollbarThumb(200, 100, 400, 150)).toEqual({
      offset: 75,
      size: 50,
      hidden: false,
    });
  });

  it('hides scrollbar thumbs when content fits', () => {
    expect(computeScrollbarThumb(200, 400, 300, 0)).toEqual({
      offset: 0,
      size: 200,
      hidden: true,
    });
  });

  it('clamps and steps zoom on the canonical spreadsheet range', () => {
    expect(clampZoom(0)).toBe(0.1);
    expect(clampZoom(8)).toBe(4);
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(0.1, -1)).toBe(0.1);
    expect(stepZoom(4, 1)).toBe(4);
  });
});
