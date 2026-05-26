/**
 * Path Text Layout Tests
 *
 * Tests for layouting text along arbitrary paths.
 */
import { PathOps } from '@mog/geometry';
import { layoutTextOnPath } from '../src/warp/path-text';
import type { GlyphBox } from '../src/warp/warp-engine';

/** Create simple glyphs for testing. */
function createGlyphs(text: string, fontSize: number = 20): GlyphBox[] {
  const charWidth = fontSize * 0.6;
  const ascent = fontSize * 0.8;
  const descent = fontSize * 0.2;
  const height = ascent + descent;

  return text.split('').map((char, i) => ({
    x: i * charWidth,
    y: ascent,
    width: charWidth,
    height,
    ascent,
    descent,
    char,
  }));
}

describe('layoutTextOnPath', () => {
  test('returns empty array for empty glyphs', () => {
    const path = PathOps.createPath().moveTo(0, 0).lineTo(200, 0).toPath();
    expect(layoutTextOnPath([], path)).toEqual([]);
  });

  test('layouts text along a straight horizontal path', () => {
    const glyphs = createGlyphs('ABC');
    const path = PathOps.createPath().moveTo(0, 0).lineTo(200, 0).toPath();

    const result = layoutTextOnPath(glyphs, path, { alignment: 'left' });
    expect(result).toHaveLength(3);

    // Characters should be ordered left to right
    expect(result[0].corners[0].x).toBeLessThan(result[1].corners[0].x);
    expect(result[1].corners[0].x).toBeLessThan(result[2].corners[0].x);

    // All should be on or near y=0 (path is horizontal)
    for (const wg of result) {
      // The center of the glyph should be near y=0
      const centerY = (wg.corners[0].y + wg.corners[2].y) / 2;
      expect(Math.abs(centerY)).toBeLessThan(20);
    }
  });

  test('layouts text along a straight vertical path', () => {
    const glyphs = createGlyphs('AB');
    const path = PathOps.createPath().moveTo(0, 0).lineTo(0, 200).toPath();

    const result = layoutTextOnPath(glyphs, path, { alignment: 'left' });
    expect(result).toHaveLength(2);

    // Characters should be ordered top to bottom
    const center0Y = (result[0].corners[0].y + result[0].corners[2].y) / 2;
    const center1Y = (result[1].corners[0].y + result[1].corners[2].y) / 2;
    expect(center0Y).toBeLessThan(center1Y);
  });

  test('layouts text along a curved path', () => {
    const glyphs = createGlyphs('Hello');
    // Semi-circular arc
    const path = PathOps.createPath().moveTo(0, 100).curveTo(0, 0, 200, 0, 200, 100).toPath();

    const result = layoutTextOnPath(glyphs, path, { alignment: 'center' });
    expect(result).toHaveLength(5);

    // All glyphs should have finite coordinates
    for (const wg of result) {
      for (const corner of wg.corners) {
        expect(isFinite(corner.x)).toBe(true);
        expect(isFinite(corner.y)).toBe(true);
      }
    }

    // Scale should be ~1 (text along path doesn't scale)
    for (const wg of result) {
      expect(wg.scale).toBeCloseTo(1, 1);
    }
  });

  test('layouts text with center alignment', () => {
    const glyphs = createGlyphs('Hi');
    const path = PathOps.createPath().moveTo(0, 0).lineTo(400, 0).toPath();

    const resultCenter = layoutTextOnPath(glyphs, path, { alignment: 'center' });
    const resultLeft = layoutTextOnPath(glyphs, path, { alignment: 'left' });

    // Center alignment should shift text to the right compared to left
    const centerX0 = (resultCenter[0].corners[0].x + resultCenter[0].corners[1].x) / 2;
    const leftX0 = (resultLeft[0].corners[0].x + resultLeft[0].corners[1].x) / 2;
    expect(centerX0).toBeGreaterThan(leftX0);
  });

  test('layouts text with right alignment', () => {
    const glyphs = createGlyphs('Hi');
    const path = PathOps.createPath().moveTo(0, 0).lineTo(400, 0).toPath();

    const resultRight = layoutTextOnPath(glyphs, path, { alignment: 'right' });
    const resultLeft = layoutTextOnPath(glyphs, path, { alignment: 'left' });

    const rightX0 = (resultRight[0].corners[0].x + resultRight[0].corners[1].x) / 2;
    const leftX0 = (resultLeft[0].corners[0].x + resultLeft[0].corners[1].x) / 2;
    expect(rightX0).toBeGreaterThan(leftX0);
  });

  test('layouts text with offset', () => {
    const glyphs = createGlyphs('A');
    const path = PathOps.createPath().moveTo(0, 0).lineTo(200, 0).toPath();

    const resultNoOffset = layoutTextOnPath(glyphs, path, { offset: 0, alignment: 'left' });
    const resultOffset = layoutTextOnPath(glyphs, path, { offset: 50, alignment: 'left' });

    // With offset, glyph should be further along the path
    const noOffsetCenterX = (resultNoOffset[0].corners[0].x + resultNoOffset[0].corners[1].x) / 2;
    const offsetCenterX = (resultOffset[0].corners[0].x + resultOffset[0].corners[1].x) / 2;
    expect(offsetCenterX).toBeGreaterThan(noOffsetCenterX);
  });

  test('handles path with zero length gracefully', () => {
    const glyphs = createGlyphs('A');
    const path = PathOps.createPath().moveTo(0, 0).toPath();
    const result = layoutTextOnPath(glyphs, path);
    expect(result).toEqual([]);
  });
});

describe('layoutTextOnPath snapshots', () => {
  test('horizontal line snapshot', () => {
    const glyphs = createGlyphs('ABC');
    const path = PathOps.createPath().moveTo(0, 0).lineTo(200, 0).toPath();
    const result = layoutTextOnPath(glyphs, path, { alignment: 'left' });

    const snapshot = result.map((wg) => ({
      char: wg.original.char,
      corners: wg.corners.map((c) => ({
        x: Math.round(c.x * 100) / 100,
        y: Math.round(c.y * 100) / 100,
      })),
    }));
    expect(snapshot).toMatchSnapshot();
  });

  test('arc path snapshot', () => {
    const glyphs = createGlyphs('Arc');
    const path = PathOps.createPath().moveTo(0, 50).curveTo(50, 0, 150, 0, 200, 50).toPath();
    const result = layoutTextOnPath(glyphs, path, { alignment: 'center' });

    const snapshot = result.map((wg) => ({
      char: wg.original.char,
      corners: wg.corners.map((c) => ({
        x: Math.round(c.x * 100) / 100,
        y: Math.round(c.y * 100) / 100,
      })),
    }));
    expect(snapshot).toMatchSnapshot();
  });
});
