import type { ContentOp } from '../content-ops';
import type { ExcelPatternType, PatternFillOptions } from '../pattern-fill';
import {
  ALL_PATTERN_TYPES,
  generatePatternFillOps,
  generatePatternTileOps,
  PatternCache,
} from '../pattern-fill';

describe('Pattern Fill', () => {
  const defaultFore: [number, number, number] = [0, 0, 0]; // black
  const defaultBack: [number, number, number] = [1, 1, 1]; // white

  function makeOptions(pattern: ExcelPatternType): PatternFillOptions {
    return { pattern, foreColor: defaultFore, backColor: defaultBack };
  }

  // ── All 18 Patterns Generate Valid Ops ───────────────────────────

  describe('generatePatternTileOps', () => {
    it('returns empty ops for none pattern', () => {
      const ops = generatePatternTileOps(makeOptions('none'));
      expect(ops).toEqual([]);
    });

    it('returns solid fill for solid pattern', () => {
      const ops = generatePatternTileOps(makeOptions('solid'));
      expect(ops.length).toBeGreaterThan(0);
      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'SetFillColorRGB', r: 0, g: 0, b: 0 }),
      );
      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'Rectangle', x: 0, y: 0, w: 8, h: 8 }),
      );
      expect(ops).toContainEqual({ op: 'Fill' });
    });

    it.each(ALL_PATTERN_TYPES.filter((p) => p !== 'none'))(
      'generates non-empty ops for pattern "%s"',
      (pattern) => {
        const ops = generatePatternTileOps(makeOptions(pattern));
        expect(ops.length).toBeGreaterThan(0);
      },
    );
  });

  // ── Gray Patterns ────────────────────────────────────────────────

  describe('gray patterns', () => {
    it('darkGray has more marks than lightGray', () => {
      const darkOps = generatePatternTileOps(makeOptions('darkGray'));
      const lightOps = generatePatternTileOps(makeOptions('lightGray'));
      // More Rectangle ops = more pixels filled
      const darkRects = darkOps.filter((o) => o.op === 'Rectangle').length;
      const lightRects = lightOps.filter((o) => o.op === 'Rectangle').length;
      expect(darkRects).toBeGreaterThan(lightRects);
    });

    it('mediumGray has density between dark and light', () => {
      const darkOps = generatePatternTileOps(makeOptions('darkGray'));
      const medOps = generatePatternTileOps(makeOptions('mediumGray'));
      const lightOps = generatePatternTileOps(makeOptions('lightGray'));

      const darkRects = darkOps.filter((o) => o.op === 'Rectangle').length;
      const medRects = medOps.filter((o) => o.op === 'Rectangle').length;
      const lightRects = lightOps.filter((o) => o.op === 'Rectangle').length;

      expect(medRects).toBeLessThan(darkRects);
      expect(medRects).toBeGreaterThan(lightRects);
    });

    it('gray125 has fewer marks than lightGray', () => {
      const lightOps = generatePatternTileOps(makeOptions('lightGray'));
      const gray125Ops = generatePatternTileOps(makeOptions('gray125'));

      const lightRects = lightOps.filter((o) => o.op === 'Rectangle').length;
      const gray125Rects = gray125Ops.filter((o) => o.op === 'Rectangle').length;

      expect(gray125Rects).toBeLessThan(lightRects);
    });

    it('gray0625 has the fewest marks', () => {
      const gray125Ops = generatePatternTileOps(makeOptions('gray125'));
      const gray0625Ops = generatePatternTileOps(makeOptions('gray0625'));

      const gray125Rects = gray125Ops.filter((o) => o.op === 'Rectangle').length;
      const gray0625Rects = gray0625Ops.filter((o) => o.op === 'Rectangle').length;

      expect(gray0625Rects).toBeLessThan(gray125Rects);
    });
  });

  // ── Line Patterns ───────────────────────────────────────────────

  describe('horizontal line patterns', () => {
    it('darkHorizontal contains horizontal MoveTo/LineTo + Stroke', () => {
      const ops = generatePatternTileOps(makeOptions('darkHorizontal'));
      const moveOps = ops.filter((o) => o.op === 'MoveTo') as Array<
        Extract<ContentOp, { op: 'MoveTo' }>
      >;
      const lineOps = ops.filter((o) => o.op === 'LineTo') as Array<
        Extract<ContentOp, { op: 'LineTo' }>
      >;
      expect(moveOps.length).toBeGreaterThan(0);
      expect(lineOps.length).toBeGreaterThan(0);
      expect(ops.some((o) => o.op === 'Stroke')).toBe(true);

      // Horizontal lines: same y for MoveTo and LineTo pairs
      for (let i = 0; i < moveOps.length; i++) {
        expect(moveOps[i].y).toBe(lineOps[i].y);
      }
    });

    it('lightHorizontal has fewer lines than darkHorizontal', () => {
      const darkOps = generatePatternTileOps(makeOptions('darkHorizontal'));
      const lightOps = generatePatternTileOps(makeOptions('lightHorizontal'));

      const darkMoves = darkOps.filter((o) => o.op === 'MoveTo').length;
      const lightMoves = lightOps.filter((o) => o.op === 'MoveTo').length;

      expect(lightMoves).toBeLessThanOrEqual(darkMoves);
    });
  });

  describe('vertical line patterns', () => {
    it('darkVertical contains vertical MoveTo/LineTo + Stroke', () => {
      const ops = generatePatternTileOps(makeOptions('darkVertical'));
      const moveOps = ops.filter((o) => o.op === 'MoveTo') as Array<
        Extract<ContentOp, { op: 'MoveTo' }>
      >;
      const lineOps = ops.filter((o) => o.op === 'LineTo') as Array<
        Extract<ContentOp, { op: 'LineTo' }>
      >;
      expect(moveOps.length).toBeGreaterThan(0);
      expect(lineOps.length).toBeGreaterThan(0);

      // Vertical lines: same x for MoveTo and LineTo pairs
      for (let i = 0; i < moveOps.length; i++) {
        expect(moveOps[i].x).toBe(lineOps[i].x);
      }
    });
  });

  describe('diagonal patterns', () => {
    it('darkDown generates diagonal lines', () => {
      const ops = generatePatternTileOps(makeOptions('darkDown'));
      expect(ops.some((o) => o.op === 'Stroke')).toBe(true);
      const moveOps = ops.filter((o) => o.op === 'MoveTo') as Array<
        Extract<ContentOp, { op: 'MoveTo' }>
      >;
      expect(moveOps.length).toBeGreaterThan(0);
    });

    it('lightUp generates diagonal lines', () => {
      const ops = generatePatternTileOps(makeOptions('lightUp'));
      expect(ops.some((o) => o.op === 'Stroke')).toBe(true);
    });
  });

  describe('grid/trellis patterns', () => {
    it('darkGrid has both horizontal and vertical lines', () => {
      const ops = generatePatternTileOps(makeOptions('darkGrid'));
      const strokeCount = ops.filter((o) => o.op === 'Stroke').length;
      expect(strokeCount).toBeGreaterThanOrEqual(2); // H + V strokes
    });

    it('lightGrid has lines', () => {
      const ops = generatePatternTileOps(makeOptions('lightGrid'));
      const strokeCount = ops.filter((o) => o.op === 'Stroke').length;
      expect(strokeCount).toBeGreaterThanOrEqual(2);
    });

    it('darkTrellis has diagonal cross-hatching', () => {
      const ops = generatePatternTileOps(makeOptions('darkTrellis'));
      const strokeCount = ops.filter((o) => o.op === 'Stroke').length;
      expect(strokeCount).toBeGreaterThanOrEqual(2);
    });

    it('lightTrellis has diagonal cross-hatching', () => {
      const ops = generatePatternTileOps(makeOptions('lightTrellis'));
      const strokeCount = ops.filter((o) => o.op === 'Stroke').length;
      expect(strokeCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Two-Color Support ────────────────────────────────────────────

  describe('two-color support', () => {
    it('tile ops include both foreground and background colors', () => {
      const ops = generatePatternTileOps({
        pattern: 'mediumGray',
        foreColor: [1, 0, 0], // red foreground
        backColor: [0, 0, 1], // blue background
      });

      const fillColors = ops.filter(
        (o): o is Extract<ContentOp, { op: 'SetFillColorRGB' }> => o.op === 'SetFillColorRGB',
      );

      // Should have background color fill
      expect(fillColors).toContainEqual(expect.objectContaining({ r: 0, g: 0, b: 1 }));
      // Should have foreground color fill
      expect(fillColors).toContainEqual(expect.objectContaining({ r: 1, g: 0, b: 0 }));
    });
  });

  // ── generatePatternFillOps ───────────────────────────────────────

  describe('generatePatternFillOps', () => {
    it('none pattern returns empty ops', () => {
      const ops = generatePatternFillOps(makeOptions('none'), 0, 0, 100, 100);
      expect(ops).toEqual([]);
    });

    it('solid pattern returns fill ops with foreground color', () => {
      const ops = generatePatternFillOps(
        { pattern: 'solid', foreColor: [1, 0, 0], backColor: [1, 1, 1] },
        10,
        20,
        100,
        50,
      );
      expect(ops).toContainEqual({ op: 'SetFillColorRGB', r: 1, g: 0, b: 0 });
      expect(ops).toContainEqual({ op: 'Rectangle', x: 10, y: 20, w: 100, h: 50 });
      expect(ops).toContainEqual({ op: 'Fill' });
    });

    it('patterned fill includes SaveState/RestoreState and clipping', () => {
      const ops = generatePatternFillOps(makeOptions('mediumGray'), 0, 0, 100, 100);
      expect(ops.filter((o) => o.op === 'SaveState').length).toBeGreaterThanOrEqual(2);
      expect(ops.filter((o) => o.op === 'RestoreState').length).toBeGreaterThanOrEqual(2);
      expect(ops.some((o) => o.op === 'ClipNonZero')).toBe(true);
    });

    it('patterned fill includes background rect', () => {
      const ops = generatePatternFillOps(
        { pattern: 'lightGray', foreColor: [0, 0, 0], backColor: [1, 1, 1] },
        5,
        10,
        50,
        30,
      );
      // Should have a background rectangle fill
      const rectOps = ops.filter(
        (o): o is Extract<ContentOp, { op: 'Rectangle' }> => o.op === 'Rectangle',
      );
      expect(rectOps).toContainEqual({ op: 'Rectangle', x: 5, y: 10, w: 50, h: 30 });
    });

    it('generates tiled marks for the area', () => {
      const ops = generatePatternFillOps(makeOptions('darkHorizontal'), 0, 0, 20, 20);
      // Should have multiple MoveTo/LineTo for tiled pattern
      const moveOps = ops.filter((o) => o.op === 'MoveTo');
      expect(moveOps.length).toBeGreaterThan(0);
    });
  });

  // ── Pattern Cache ───────────────────────────────────────────────

  describe('PatternCache', () => {
    it('deduplicates identical patterns', () => {
      const cache = new PatternCache();
      const opt1 = makeOptions('mediumGray');
      const opt2 = makeOptions('mediumGray');

      const def1 = cache.getOrCreate(opt1);
      const def2 = cache.getOrCreate(opt2);

      expect(def1.name).toBe(def2.name);
      expect(cache.getAll().length).toBe(1);
    });

    it('creates different entries for different patterns', () => {
      const cache = new PatternCache();
      const def1 = cache.getOrCreate(makeOptions('darkGray'));
      const def2 = cache.getOrCreate(makeOptions('lightGray'));

      expect(def1.name).not.toBe(def2.name);
      expect(cache.getAll().length).toBe(2);
    });

    it('creates different entries for same pattern with different colors', () => {
      const cache = new PatternCache();
      const def1 = cache.getOrCreate({
        pattern: 'mediumGray',
        foreColor: [1, 0, 0],
        backColor: [1, 1, 1],
      });
      const def2 = cache.getOrCreate({
        pattern: 'mediumGray',
        foreColor: [0, 0, 1],
        backColor: [1, 1, 1],
      });

      expect(def1.name).not.toBe(def2.name);
    });

    it('assigns sequential names', () => {
      const cache = new PatternCache();
      const def1 = cache.getOrCreate(makeOptions('darkGray'));
      const def2 = cache.getOrCreate(makeOptions('lightGray'));
      const def3 = cache.getOrCreate(makeOptions('mediumGray'));

      expect(def1.name).toBe('P0');
      expect(def2.name).toBe('P1');
      expect(def3.name).toBe('P2');
    });

    it('includes tile dimensions', () => {
      const cache = new PatternCache();
      const def = cache.getOrCreate(makeOptions('mediumGray'));
      expect(def.tileWidth).toBe(8);
      expect(def.tileHeight).toBe(8);
    });

    it('clear resets the cache', () => {
      const cache = new PatternCache();
      cache.getOrCreate(makeOptions('darkGray'));
      cache.getOrCreate(makeOptions('lightGray'));
      expect(cache.getAll().length).toBe(2);

      cache.clear();
      expect(cache.getAll().length).toBe(0);

      // New entries start from P0 again
      const def = cache.getOrCreate(makeOptions('darkGray'));
      expect(def.name).toBe('P0');
    });
  });

  // ── ALL_PATTERN_TYPES ───────────────────────────────────────────

  describe('ALL_PATTERN_TYPES', () => {
    it('contains all 19 pattern types (none + solid + 17 patterned)', () => {
      expect(ALL_PATTERN_TYPES.length).toBe(19);
    });

    it('contains all expected patterns', () => {
      const expected: ExcelPatternType[] = [
        'none',
        'solid',
        'darkGray',
        'mediumGray',
        'lightGray',
        'gray125',
        'gray0625',
        'darkHorizontal',
        'lightHorizontal',
        'darkVertical',
        'lightVertical',
        'darkDown',
        'lightDown',
        'darkUp',
        'lightUp',
        'darkGrid',
        'lightGrid',
        'darkTrellis',
        'lightTrellis',
      ];
      for (const p of expected) {
        expect(ALL_PATTERN_TYPES).toContain(p);
      }
    });
  });
});
