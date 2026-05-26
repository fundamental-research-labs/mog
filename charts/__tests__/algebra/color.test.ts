import { resolveColor, resolveFillColor, resolveStrokeColor } from '../../src/algebra/color';
import { DEFAULT_CATEGORY_COLORS } from '../../src/grammar/encoding-resolver';
import type { ChartScale } from '../../src/primitives/scales/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * A simple mock scale that returns a deterministic string for any input.
 */
const mockScale = Object.assign((value: unknown) => `color-for-${value}`, {}) as ChartScale;

/**
 * A mock scale that always returns undefined (simulates a scale that cannot
 * resolve the given value).
 */
const undefinedScale = Object.assign(
  (_value: unknown) => undefined as unknown as string,
  {},
) as ChartScale;

// ---------------------------------------------------------------------------
// resolveColor — scale resolution
// ---------------------------------------------------------------------------

describe('resolveColor', () => {
  it('invokes the color scale when colorValue is present', () => {
    const result = resolveColor({
      colorScale: mockScale,
      colorValue: 'A',
      index: 0,
    });
    expect(result).toBe('color-for-A');
  });

  it('uses fillScale as fallback when colorScale is undefined', () => {
    const fillScale = Object.assign((value: unknown) => `fill-${value}`, {}) as ChartScale;

    const result = resolveColor({
      fillScale,
      colorValue: 'B',
      index: 0,
    });
    expect(result).toBe('fill-B');
  });

  it('prefers colorScale over fillScale', () => {
    const fillScale = Object.assign((value: unknown) => `fill-${value}`, {}) as ChartScale;

    const result = resolveColor({
      colorScale: mockScale,
      fillScale,
      colorValue: 'C',
      index: 0,
    });
    expect(result).toBe('color-for-C');
  });

  it('falls through to markColor when scale returns undefined', () => {
    const result = resolveColor({
      colorScale: undefinedScale,
      colorValue: 'X',
      markColor: '#ff0000',
      index: 0,
    });
    expect(result).toBe('#ff0000');
  });

  it('falls through to markColor when scale returns null', () => {
    const nullScale = Object.assign(
      (_value: unknown) => null as unknown as string,
      {},
    ) as ChartScale;

    const result = resolveColor({
      colorScale: nullScale,
      colorValue: 'X',
      markColor: '#00ff00',
      index: 0,
    });
    expect(result).toBe('#00ff00');
  });

  // ---------------------------------------------------------------------------
  // resolveColor — markSpec fallbacks
  // ---------------------------------------------------------------------------

  it('returns markColor when no scale and no colorValue', () => {
    const result = resolveColor({
      markColor: '#aabbcc',
      index: 0,
    });
    expect(result).toBe('#aabbcc');
  });

  it('returns markFill when no markColor is provided', () => {
    const result = resolveColor({
      markFill: '#112233',
      index: 0,
    });
    expect(result).toBe('#112233');
  });

  it('returns markStroke when neither markColor nor markFill is provided', () => {
    const result = resolveColor({
      markStroke: '#445566',
      index: 0,
    });
    expect(result).toBe('#445566');
  });

  it('prefers markColor over markFill and markStroke', () => {
    const result = resolveColor({
      markColor: '#aaa',
      markFill: '#bbb',
      markStroke: '#ccc',
      index: 0,
    });
    expect(result).toBe('#aaa');
  });

  it('prefers markFill over markStroke when markColor is undefined', () => {
    const result = resolveColor({
      markFill: '#bbb',
      markStroke: '#ccc',
      index: 0,
    });
    expect(result).toBe('#bbb');
  });

  // ---------------------------------------------------------------------------
  // resolveColor — default color cycling
  // ---------------------------------------------------------------------------

  it('cycles through DEFAULT_CATEGORY_COLORS when no other fallback', () => {
    const result = resolveColor({ index: 3 });
    expect(result).toBe(DEFAULT_CATEGORY_COLORS[3]);
  });

  it('returns the first default color at index 0', () => {
    const result = resolveColor({ index: 0 });
    expect(result).toBe(DEFAULT_CATEGORY_COLORS[0]);
  });

  it('wraps around when index exceeds default colors length', () => {
    const result = resolveColor({ index: 10 });
    expect(result).toBe(DEFAULT_CATEGORY_COLORS[0]); // 10 % 10 === 0
  });

  it('wraps around correctly for large indices', () => {
    const result = resolveColor({ index: 23 });
    expect(result).toBe(DEFAULT_CATEGORY_COLORS[3]); // 23 % 10 === 3
  });

  it('cycles through all 10 default colors', () => {
    for (let i = 0; i < DEFAULT_CATEGORY_COLORS.length; i++) {
      expect(resolveColor({ index: i })).toBe(DEFAULT_CATEGORY_COLORS[i]);
    }
  });

  // ---------------------------------------------------------------------------
  // resolveColor — empty/null/undefined colorValue handling
  // ---------------------------------------------------------------------------

  it('treats empty string colorValue as absent (falls through)', () => {
    const result = resolveColor({
      colorScale: mockScale,
      colorValue: '',
      markColor: '#ff0000',
      index: 0,
    });
    expect(result).toBe('#ff0000');
  });

  it('treats null colorValue as absent (falls through)', () => {
    const result = resolveColor({
      colorScale: mockScale,
      colorValue: null,
      markColor: '#ff0000',
      index: 0,
    });
    expect(result).toBe('#ff0000');
  });

  it('treats undefined colorValue as absent (falls through)', () => {
    const result = resolveColor({
      colorScale: mockScale,
      colorValue: undefined,
      markColor: '#ff0000',
      index: 0,
    });
    expect(result).toBe('#ff0000');
  });

  it('treats 0 as a valid colorValue (does NOT fall through)', () => {
    const result = resolveColor({
      colorScale: mockScale,
      colorValue: 0,
      index: 0,
    });
    expect(result).toBe('color-for-0');
  });

  it('treats false as a valid colorValue (does NOT fall through)', () => {
    const result = resolveColor({
      colorScale: mockScale,
      colorValue: false,
      index: 0,
    });
    expect(result).toBe('color-for-false');
  });

  // ---------------------------------------------------------------------------
  // resolveColor — custom defaults
  // ---------------------------------------------------------------------------

  it('uses a custom defaults array when provided', () => {
    const customDefaults = ['#111', '#222', '#333'];
    const result = resolveColor({
      index: 1,
      defaults: customDefaults,
    });
    expect(result).toBe('#222');
  });

  it('wraps around custom defaults correctly', () => {
    const customDefaults = ['#aaa', '#bbb'];
    const result = resolveColor({
      index: 5,
      defaults: customDefaults,
    });
    expect(result).toBe('#bbb'); // 5 % 2 === 1
  });
});

// ---------------------------------------------------------------------------
// resolveFillColor — convenience wrapper
// ---------------------------------------------------------------------------

describe('resolveFillColor', () => {
  it('invokes scale when colorValue is present', () => {
    const result = resolveFillColor(mockScale, 'cat-A', undefined, undefined, 0);
    expect(result).toBe('color-for-cat-A');
  });

  it('falls through to markColor when no scale', () => {
    const result = resolveFillColor(undefined, undefined, '#abc', undefined, 0);
    expect(result).toBe('#abc');
  });

  it('falls through to markFill when no markColor', () => {
    const result = resolveFillColor(undefined, undefined, undefined, '#def', 0);
    expect(result).toBe('#def');
  });

  it('falls through to defaults when no markFill', () => {
    const result = resolveFillColor(undefined, undefined, undefined, undefined, 2);
    expect(result).toBe(DEFAULT_CATEGORY_COLORS[2]);
  });

  it('treats empty string colorValue as absent', () => {
    const result = resolveFillColor(mockScale, '', '#abc', undefined, 0);
    expect(result).toBe('#abc');
  });
});

// ---------------------------------------------------------------------------
// resolveStrokeColor — convenience wrapper
// ---------------------------------------------------------------------------

describe('resolveStrokeColor', () => {
  it('invokes scale when colorValue is present', () => {
    const result = resolveStrokeColor(mockScale, 'cat-B', undefined, undefined, 0);
    expect(result).toBe('color-for-cat-B');
  });

  it('falls through to markColor when no scale', () => {
    const result = resolveStrokeColor(undefined, undefined, '#abc', undefined, 0);
    expect(result).toBe('#abc');
  });

  it('falls through to markStroke when no markColor', () => {
    const result = resolveStrokeColor(undefined, undefined, undefined, '#789', 0);
    expect(result).toBe('#789');
  });

  it('falls through to defaults when no markStroke', () => {
    const result = resolveStrokeColor(undefined, undefined, undefined, undefined, 4);
    expect(result).toBe(DEFAULT_CATEGORY_COLORS[4]);
  });

  it('treats null colorValue as absent', () => {
    const result = resolveStrokeColor(mockScale, null, undefined, '#stroke', 0);
    expect(result).toBe('#stroke');
  });
});
