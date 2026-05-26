/**
 * Warp Engine Tests
 *
 * Tests for the core warp algorithm: warping glyphs between guide paths.
 */
import { PathOps } from '@mog/geometry';
import { getAllPresetNames, getWarpPreset } from '../src/presets/registry';
import { warpText, type GlyphBox } from '../src/warp/warp-engine';

// ─── Test Helpers ───────────────────────────────────────────────────────────

/** Create a simple array of glyph boxes for a text string. */
function createGlyphs(text: string, fontSize: number = 20): GlyphBox[] {
  const charWidth = fontSize * 0.6;
  const ascent = fontSize * 0.8;
  const descent = fontSize * 0.2;
  const height = ascent + descent;

  return text.split('').map((char, i) => ({
    x: i * charWidth,
    y: ascent, // baseline position
    width: charWidth,
    height,
    ascent,
    descent,
    char,
  }));
}

const TEST_WIDTH = 200;
const TEST_HEIGHT = 50;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('warpText', () => {
  test('returns empty array for empty glyphs', () => {
    const topPath = PathOps.createPath().moveTo(0, 0).lineTo(200, 0).toPath();
    const bottomPath = PathOps.createPath().moveTo(0, 50).lineTo(200, 50).toPath();
    expect(warpText([], topPath, bottomPath)).toEqual([]);
  });

  test('warps single character', () => {
    const glyphs = createGlyphs('A');
    const preset = getWarpPreset('textPlain');
    const topPath = preset.topGuide(TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);
    const bottomPath = preset.bottomGuide(TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);

    const result = warpText(glyphs, topPath, bottomPath);
    expect(result).toHaveLength(1);
    expect(result[0].original.char).toBe('A');
    expect(result[0].corners).toHaveLength(4);

    // Each corner should have finite coordinates
    for (const corner of result[0].corners) {
      expect(isFinite(corner.x)).toBe(true);
      expect(isFinite(corner.y)).toBe(true);
    }
  });

  test('warps "Hello" text', () => {
    const glyphs = createGlyphs('Hello');
    const preset = getWarpPreset('textArchUp');
    const topPath = preset.topGuide(TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);
    const bottomPath = preset.bottomGuide(TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);

    const result = warpText(glyphs, topPath, bottomPath);
    expect(result).toHaveLength(5);

    // Characters should be in order
    expect(result.map((g) => g.original.char).join('')).toBe('Hello');

    // All warped glyphs should have valid transforms
    for (const wg of result) {
      expect(isFinite(wg.transform.a)).toBe(true);
      expect(isFinite(wg.transform.d)).toBe(true);
      expect(isFinite(wg.transform.tx)).toBe(true);
      expect(isFinite(wg.transform.ty)).toBe(true);
      expect(wg.scale).toBeGreaterThan(0);
    }
  });

  test('warps with straight guide paths (textPlain) preserves approximate positions', () => {
    const glyphs = createGlyphs('AB');
    const topPath = PathOps.createPath().moveTo(0, 0).lineTo(200, 0).toPath();
    const bottomPath = PathOps.createPath().moveTo(0, 50).lineTo(200, 50).toPath();

    const result = warpText(glyphs, topPath, bottomPath);
    expect(result).toHaveLength(2);

    // With straight paths, the first glyph should be near the left
    expect(result[0].corners[0].x).toBeLessThan(result[1].corners[0].x);
  });

  test('warp with various presets produces valid results', () => {
    const glyphs = createGlyphs('Test');
    const presetNames = getAllPresetNames();

    for (const name of presetNames) {
      const preset = getWarpPreset(name);
      const topPath = preset.topGuide(TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);
      const bottomPath = preset.bottomGuide(TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);

      const result = warpText(glyphs, topPath, bottomPath);
      expect(result.length).toBe(4);

      for (const wg of result) {
        for (const corner of wg.corners) {
          expect(isFinite(corner.x)).toBe(true);
          expect(isFinite(corner.y)).toBe(true);
        }
      }
    }
  });

  test('warps long text', () => {
    const longText = 'The Quick Brown Fox Jumps Over The Lazy Dog';
    const glyphs = createGlyphs(longText, 10);
    const preset = getWarpPreset('textWave1');
    const topPath = preset.topGuide(400, 60, preset.defaultAdjustment);
    const bottomPath = preset.bottomGuide(400, 60, preset.defaultAdjustment);

    const result = warpText(glyphs, topPath, bottomPath);
    expect(result).toHaveLength(longText.length);
  });

  test('warps single character with different alignments', () => {
    const glyphs = createGlyphs('X');
    const topPath = PathOps.createPath().moveTo(0, 0).lineTo(200, 0).toPath();
    const bottomPath = PathOps.createPath().moveTo(0, 50).lineTo(200, 50).toPath();

    const resultLeft = warpText(glyphs, topPath, bottomPath, { alignment: 'left' });
    const resultCenter = warpText(glyphs, topPath, bottomPath, { alignment: 'center' });
    const resultRight = warpText(glyphs, topPath, bottomPath, { alignment: 'right' });

    // All should produce one glyph
    expect(resultLeft).toHaveLength(1);
    expect(resultCenter).toHaveLength(1);
    expect(resultRight).toHaveLength(1);

    // Different alignments should produce different glyph positions
    const leftX = resultLeft[0].corners[0].x;
    const centerX = resultCenter[0].corners[0].x;
    const rightX = resultRight[0].corners[0].x;

    // Left-aligned glyph should be to the left of center-aligned
    expect(leftX).toBeLessThan(centerX);
    // Center-aligned glyph should be to the left of right-aligned
    expect(centerX).toBeLessThan(rightX);
  });
});

describe('warpText snapshot tests', () => {
  const samplePresets = [
    'textArchUp',
    'textArchDown',
    'textWave1',
    'textInflate',
    'textFadeRight',
    'textSlantUp',
    'textChevron',
    'textTriangle',
  ] as const;

  const glyphs = createGlyphs('TextEffect');

  test.each(samplePresets)('warp "%s" snapshot', (name) => {
    const preset = getWarpPreset(name);
    const topPath = preset.topGuide(TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);
    const bottomPath = preset.bottomGuide(TEST_WIDTH, TEST_HEIGHT, preset.defaultAdjustment);

    const result = warpText(glyphs, topPath, bottomPath);

    // Snapshot the corners of all warped glyphs (rounded for stability)
    const snapshot = result.map((wg) => ({
      char: wg.original.char,
      corners: wg.corners.map((c) => ({
        x: Math.round(c.x * 100) / 100,
        y: Math.round(c.y * 100) / 100,
      })),
      scale: Math.round(wg.scale * 1000) / 1000,
    }));

    expect(snapshot).toMatchSnapshot();
  });
});
