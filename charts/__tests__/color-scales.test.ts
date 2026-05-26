/**
 * Color scale tests
 */
import {
  getColorScheme,
  hexToRgb,
  interpolateColor,
  interpolateColors,
  rgbToHex,
  scaleDiverging,
  scaleOrdinal,
  scaleSequential,
  schemeBlues,
  schemeCategory10,
  schemeCategory20,
  schemeViridis,
} from '../src/primitives/scales/color';

describe('getColorScheme', () => {
  it('returns category10', () => {
    expect(getColorScheme('category10')).toBe(schemeCategory10);
  });
  it('returns category20', () => {
    expect(getColorScheme('category20')).toBe(schemeCategory20);
  });
  it('returns blues', () => {
    expect(getColorScheme('blues')).toBe(schemeBlues);
  });
  it('returns viridis', () => {
    expect(getColorScheme('viridis')).toBe(schemeViridis);
  });
  it('falls back to category10 for unknown', () => {
    expect(getColorScheme('nonexistent' as any)).toBe(schemeCategory10);
  });
});

describe('color hexToRgb', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0]);
    expect(hexToRgb('#00ff00')).toEqual([0, 255, 0]);
    expect(hexToRgb('#0000ff')).toEqual([0, 0, 255]);
  });
  it('returns [0,0,0] for invalid', () => {
    expect(hexToRgb('invalid')).toEqual([0, 0, 0]);
  });
});

describe('color rgbToHex', () => {
  it('converts RGB to hex', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
  });
  it('clamps values', () => {
    expect(rgbToHex(-10, 300, 128)).toBe('#00ff80');
  });
});

describe('interpolateColor', () => {
  it('returns first color at t=0', () => {
    expect(interpolateColor('#ff0000', '#0000ff', 0)).toBe('#ff0000');
  });
  it('returns second color at t=1', () => {
    expect(interpolateColor('#ff0000', '#0000ff', 1)).toBe('#0000ff');
  });
  it('midpoint is between the two colors', () => {
    const mid = interpolateColor('#ff0000', '#0000ff', 0.5);
    const [r, , b] = hexToRgb(mid);
    // Midpoint should have some red and some blue
    expect(r).toBeGreaterThan(50);
    expect(r).toBeLessThan(200);
    expect(b).toBeGreaterThan(50);
    expect(b).toBeLessThan(200);
  });
});

describe('interpolateColors', () => {
  it('empty array returns black', () => {
    const fn = interpolateColors([]);
    expect(fn(0.5)).toBe('#000000');
  });
  it('single color', () => {
    const fn = interpolateColors(['#ff0000']);
    expect(fn(0)).toBe('#ff0000');
    expect(fn(1)).toBe('#ff0000');
  });
  it('two colors', () => {
    const fn = interpolateColors(['#000000', '#ffffff']);
    expect(fn(0)).toBe('#000000');
    expect(fn(1)).toBe('#ffffff');
  });
  it('multi stops', () => {
    const fn = interpolateColors(['#ff0000', '#00ff00', '#0000ff']);
    expect(fn(0)).toBe('#ff0000');
    expect(fn(0.5)).toBe('#00ff00');
    expect(fn(1)).toBe('#0000ff');
  });
  it('clamps t', () => {
    const fn = interpolateColors(['#000000', '#ffffff']);
    expect(fn(-1)).toBe('#000000');
    expect(fn(2)).toBe('#ffffff');
  });
});

describe('scaleSequential', () => {
  it('creates default viridis scale', () => {
    const s = scaleSequential([0, 100]);
    expect(s(50)).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('accepts scheme name', () => {
    const s = scaleSequential([0, 100], 'blues');
    expect(s(50)).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('clamps output', () => {
    const s = scaleSequential([0, 100]);
    expect(s(-100)).toBe(s(0));
    expect(s(200)).toBe(s(100));
  });
  it('equal domain returns midpoint', () => {
    const s = scaleSequential([5, 5]);
    expect(s(5)).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('domain getter/setter', () => {
    const s = scaleSequential([10, 20]);
    expect(s.domain()).toEqual([10, 20]);
    s.domain([0, 1]);
    expect(s.domain()).toEqual([0, 1]);
  });
  it('interpolator getter', () => {
    const fn = (t: number) => '#000000';
    const s = scaleSequential([0, 1], fn);
    expect(s.interpolator()).toBe(fn);
  });
  it('copy is independent', () => {
    const s = scaleSequential([0, 100], 'blues');
    const c = s.copy();
    c.domain([0, 50]);
    expect(s.domain()).toEqual([0, 100]);
    expect(c.domain()).toEqual([0, 50]);
  });
});

describe('scaleDiverging', () => {
  it('creates default scale', () => {
    const s = scaleDiverging([-1, 0, 1]);
    expect(s(0)).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('accepts scheme name', () => {
    const s = scaleDiverging([-10, 0, 10], 'rdylgn');
    expect(s(0)).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('extremes differ', () => {
    const s = scaleDiverging([-1, 0, 1]);
    expect(s(-1)).not.toBe(s(1));
  });
  it('domain getter/setter', () => {
    const s = scaleDiverging([-1, 0, 1]);
    expect(s.domain()).toEqual([-1, 0, 1]);
    s.domain([-100, 0, 100]);
    expect(s.domain()).toEqual([-100, 0, 100]);
  });
  it('copy is independent', () => {
    const s = scaleDiverging([-1, 0, 1]);
    const c = s.copy();
    c.domain([-10, 0, 10]);
    expect(s.domain()).toEqual([-1, 0, 1]);
  });
  it('degenerate domain d0===d1', () => {
    const s = scaleDiverging([0, 0, 10]);
    expect(s(-5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('scaleOrdinal', () => {
  it('maps domain to range', () => {
    const s = scaleOrdinal(['A', 'B', 'C'], schemeCategory10);
    expect(s('A')).toBe(schemeCategory10[0]);
    expect(s('B')).toBe(schemeCategory10[1]);
    expect(s('C')).toBe(schemeCategory10[2]);
  });
  it('default range is category10', () => {
    expect(scaleOrdinal(['X'])('X')).toBe(schemeCategory10[0]);
  });
  it('accepts scheme name', () => {
    expect(scaleOrdinal(['A'], 'category20')('A')).toBe(schemeCategory20[0]);
  });
  it('cycles colors', () => {
    const s = scaleOrdinal([], ['#aaa', '#bbb']);
    expect(s('first')).toBe('#aaa');
    expect(s('second')).toBe('#bbb');
    expect(s('third')).toBe('#aaa');
  });
  it('implicit domain extension', () => {
    const s = scaleOrdinal(['A'], ['#111', '#222']);
    expect(s('B')).toBe('#222');
    expect(s.domain()).toContain('B');
  });
  it('unknown color', () => {
    const s = scaleOrdinal(['A'], ['#111']);
    s.unknown('#999');
    expect(s('B')).toBe('#999');
  });
  it('domain getter/setter', () => {
    const s = scaleOrdinal(['X', 'Y']);
    expect(s.domain()).toEqual(['X', 'Y']);
    s.domain(['C']);
    expect(s.domain()).toEqual(['C']);
  });
  it('range getter/setter', () => {
    const s = scaleOrdinal([], ['#aaa']);
    expect(s.range()).toEqual(['#aaa']);
    s.range(['#bbb']);
    expect(s.range()).toEqual(['#bbb']);
  });
  it('copy is independent', () => {
    const s = scaleOrdinal(['A', 'B'], ['#111', '#222']);
    const c = s.copy();
    c.domain(['X']);
    expect(s.domain()).toEqual(['A', 'B']);
    expect(c.domain()).toEqual(['X']);
  });
  it('domain reset reindexes', () => {
    const s = scaleOrdinal(['A', 'B', 'C'], ['#1', '#2', '#3']);
    expect(s('A')).toBe('#1');
    s.domain(['C', 'A']);
    expect(s('C')).toBe('#1');
    expect(s('A')).toBe('#2');
  });
});
