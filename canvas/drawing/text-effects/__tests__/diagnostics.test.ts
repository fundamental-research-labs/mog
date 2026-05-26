/**
 * Diagnostics Tests
 *
 * Tests for validators and comparators.
 */
import { compareTextEffect } from '../src/diagnostics/comparators';
import { validateWarpPreset, validateWarpResult } from '../src/diagnostics/validators';
import { getWarpPreset } from '../src/presets/registry';
import { warpText, type GlyphBox, type WarpedGlyph } from '../src/warp/warp-engine';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createGlyphs(text: string): GlyphBox[] {
  const charWidth = 12;
  const ascent = 16;
  const descent = 4;
  return text.split('').map((char, i) => ({
    x: i * charWidth,
    y: ascent,
    width: charWidth,
    height: ascent + descent,
    ascent,
    descent,
    char,
  }));
}

// ─── Validator Tests ────────────────────────────────────────────────────────

describe('validateWarpPreset', () => {
  test('valid preset returns valid result', () => {
    const result = validateWarpPreset('textArchUp');
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('valid preset with valid adjustment', () => {
    const result = validateWarpPreset('textArchUp', 0.5);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('unknown preset returns error', () => {
    const result = validateWarpPreset('textNonExistent');
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].code).toBe('TEXT_EFFECT_PRESET_UNKNOWN');
    expect(result.issues[0].severity).toBe('error');
  });

  test('empty string preset returns error', () => {
    const result = validateWarpPreset('');
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('TEXT_EFFECT_PRESET_UNKNOWN');
  });

  test('adjustment below minimum returns warning', () => {
    const result = validateWarpPreset('textArchUp', -0.5);
    expect(result.valid).toBe(true); // Warnings don't make it invalid
    expect(result.issues.some((i) => i.code === 'TEXT_EFFECT_ADJUSTMENT_BELOW_MIN')).toBe(true);
  });

  test('adjustment above maximum returns warning', () => {
    const result = validateWarpPreset('textArchUp', 5.0);
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.code === 'TEXT_EFFECT_ADJUSTMENT_ABOVE_MAX')).toBe(true);
  });

  test('NaN adjustment returns error', () => {
    const result = validateWarpPreset('textArchUp', NaN);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'TEXT_EFFECT_ADJUSTMENT_NAN')).toBe(true);
  });

  test('Infinity adjustment returns error', () => {
    const result = validateWarpPreset('textArchUp', Infinity);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'TEXT_EFFECT_ADJUSTMENT_NAN')).toBe(true);
  });
});

describe('validateWarpResult', () => {
  test('valid warp result passes validation', () => {
    const glyphs = createGlyphs('Hello');
    const preset = getWarpPreset('textArchUp');
    const topPath = preset.topGuide(200, 50, 0.5);
    const bottomPath = preset.bottomGuide(200, 50, 0.5);
    const warped = warpText(glyphs, topPath, bottomPath);

    const result = validateWarpResult(warped);
    expect(result.valid).toBe(true);
  });

  test('empty result returns info', () => {
    const result = validateWarpResult([]);
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.code === 'TEXT_EFFECT_EMPTY_RESULT')).toBe(true);
  });

  test('detects NaN in corners', () => {
    const fakeGlyph: WarpedGlyph = {
      original: { x: 0, y: 16, width: 12, height: 20, ascent: 16, descent: 4, char: 'A' },
      corners: [
        { x: NaN, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 20 },
        { x: 0, y: 20 },
      ],
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      scale: 1,
    };

    const result = validateWarpResult([fakeGlyph]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'TEXT_EFFECT_NAN_COORDINATE')).toBe(true);
  });

  test('detects degenerate warp', () => {
    const fakeGlyph: WarpedGlyph = {
      original: { x: 0, y: 16, width: 12, height: 20, ascent: 16, descent: 4, char: 'A' },
      corners: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      transform: { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 },
      scale: 0,
    };

    const result = validateWarpResult([fakeGlyph]);
    expect(
      result.issues.some(
        (i) => i.code === 'TEXT_EFFECT_WARP_DEGENERATE' || i.code === 'TEXT_EFFECT_EXTREME_SCALE',
      ),
    ).toBe(true);
  });

  test('detects NaN in transform', () => {
    const fakeGlyph: WarpedGlyph = {
      original: { x: 0, y: 16, width: 12, height: 20, ascent: 16, descent: 4, char: 'A' },
      corners: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 20 },
        { x: 0, y: 20 },
      ],
      transform: { a: NaN, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      scale: 1,
    };

    const result = validateWarpResult([fakeGlyph]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'TEXT_EFFECT_TRANSFORM_NAN')).toBe(true);
  });
});

// ─── Comparator Tests ───────────────────────────────────────────────────────

describe('compareTextEffect', () => {
  test('identical objects match', () => {
    const config = {
      warpPreset: 'textArchUp',
      adjustment: 0.5,
      fill: { type: 'solid', color: '#FF0000' },
    };

    const result = compareTextEffect(config, { ...config });
    expect(result.match).toBe(true);
    expect(result.differences).toHaveLength(0);
  });

  test('detects different preset', () => {
    const source = { warpPreset: 'textArchUp', fill: { type: 'solid', color: '#FF0000' } };
    const stored = { warpPreset: 'textWave1', fill: { type: 'solid', color: '#FF0000' } };

    const result = compareTextEffect(source, stored);
    expect(result.match).toBe(false);
    expect(result.differences.some((d) => d.property === 'warpPreset')).toBe(true);
  });

  test('detects different fill color', () => {
    const source = { fill: { type: 'solid', color: '#FF0000' } };
    const stored = { fill: { type: 'solid', color: '#00FF00' } };

    const result = compareTextEffect(source, stored);
    expect(result.match).toBe(false);
    expect(result.differences.some((d) => d.property === 'fill.color')).toBe(true);
  });

  test('detects missing property', () => {
    const source = { warpPreset: 'textArchUp', outline: { width: 2 } };
    const stored = { warpPreset: 'textArchUp' };

    const result = compareTextEffect(source, stored);
    expect(result.match).toBe(false);
    expect(result.differences.some((d) => d.property === 'outline')).toBe(true);
  });

  test('detects extra property in stored', () => {
    const source = { warpPreset: 'textArchUp' };
    const stored = { warpPreset: 'textArchUp', extraProp: 'value' };

    const result = compareTextEffect(source, stored);
    expect(result.match).toBe(false);
    expect(result.differences.some((d) => d.property === 'extraProp')).toBe(true);
  });

  test('treats near-equal numbers as equal', () => {
    const source = { adjustment: 0.500000001 };
    const stored = { adjustment: 0.500000002 };

    const result = compareTextEffect(source, stored);
    expect(result.match).toBe(true);
  });

  test('handles null and undefined correctly', () => {
    expect(compareTextEffect(null, null).match).toBe(true);
    expect(compareTextEffect(undefined, undefined).match).toBe(true);
    expect(compareTextEffect(null, { a: 1 }).match).toBe(false);
    expect(compareTextEffect({ a: 1 }, null).match).toBe(false);
  });

  test('compares arrays', () => {
    const source = {
      stops: [
        { pos: 0, color: '#FFF' },
        { pos: 100, color: '#000' },
      ],
    };
    const stored = {
      stops: [
        { pos: 0, color: '#FFF' },
        { pos: 100, color: '#111' },
      ],
    };

    const result = compareTextEffect(source, stored);
    expect(result.match).toBe(false);
    expect(result.differences.some((d) => d.property.includes('stops'))).toBe(true);
  });

  test('detects array length difference', () => {
    const source = { items: [1, 2, 3] };
    const stored = { items: [1, 2] };

    const result = compareTextEffect(source, stored);
    expect(result.match).toBe(false);
  });
});
