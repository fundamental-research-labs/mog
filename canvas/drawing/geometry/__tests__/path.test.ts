import {
  createPath,
  parseSvgPath,
  pathBoundingBox,
  pathLength,
  pathToSvgString,
  pointAtLength,
  reversePath,
  splitIntoSubPaths,
  transformPath,
} from '../src/path';
import { scale, translate } from '../src/transform';

describe('Path operations', () => {
  // ─── Path Builder ────────────────────────────────────────────────────

  test('createPath builds a simple triangle', () => {
    const path = createPath().moveTo(0, 0).lineTo(100, 0).lineTo(50, 100).closePath().toPath();

    expect(path.segments).toHaveLength(4);
    expect(path.segments[0]).toEqual({ type: 'M', x: 0, y: 0 });
    expect(path.segments[1]).toEqual({ type: 'L', x: 100, y: 0 });
    expect(path.segments[2]).toEqual({ type: 'L', x: 50, y: 100 });
    expect(path.segments[3]).toEqual({ type: 'Z' });
    expect(path.closed).toBe(true);
  });

  test('createPath builds path with curves', () => {
    const path = createPath()
      .moveTo(0, 0)
      .curveTo(10, 20, 30, 40, 50, 0)
      .quadTo(75, 50, 100, 0)
      .toPath();

    expect(path.segments).toHaveLength(3);
    expect(path.segments[1].type).toBe('C');
    expect(path.segments[2].type).toBe('Q');
    expect(path.closed).toBe(false);
  });

  test('createPath can chain fluently', () => {
    const builder = createPath();
    const same = builder.moveTo(0, 0);
    expect(same).toBe(builder);
  });

  test('createPath empty path', () => {
    const path = createPath().toPath();
    expect(path.segments).toHaveLength(0);
    expect(path.closed).toBe(false);
  });

  // ─── SVG Parsing ─────────────────────────────────────────────────────

  test('parse simple moveto-lineto', () => {
    const path = parseSvgPath('M 0 0 L 100 0 L 100 100 Z');
    expect(path.segments).toHaveLength(4);
    expect(path.segments[0]).toEqual({ type: 'M', x: 0, y: 0 });
    expect(path.segments[1]).toEqual({ type: 'L', x: 100, y: 0 });
    expect(path.segments[2]).toEqual({ type: 'L', x: 100, y: 100 });
    expect(path.segments[3]).toEqual({ type: 'Z' });
    expect(path.closed).toBe(true);
  });

  test('parse cubic bezier', () => {
    const path = parseSvgPath('M 0 0 C 10 20 30 40 50 0');
    expect(path.segments).toHaveLength(2);
    expect(path.segments[1]).toEqual({
      type: 'C',
      x1: 10,
      y1: 20,
      x2: 30,
      y2: 40,
      x: 50,
      y: 0,
    });
  });

  test('parse quadratic bezier', () => {
    const path = parseSvgPath('M 0 0 Q 50 100 100 0');
    expect(path.segments).toHaveLength(2);
    expect(path.segments[1]).toEqual({
      type: 'Q',
      x1: 50,
      y1: 100,
      x: 100,
      y: 0,
    });
  });

  test('parse relative commands', () => {
    const path = parseSvgPath('M 10 10 l 20 0 l 0 20 z');
    expect(path.segments).toHaveLength(4);
    expect(path.segments[1]).toEqual({ type: 'L', x: 30, y: 10 });
    expect(path.segments[2]).toEqual({ type: 'L', x: 30, y: 30 });
  });

  test('parse negative coordinates', () => {
    const path = parseSvgPath('M -10 -20 L 30 -40');
    expect(path.segments[0]).toEqual({ type: 'M', x: -10, y: -20 });
    expect(path.segments[1]).toEqual({ type: 'L', x: 30, y: -40 });
  });

  test('parse decimal coordinates', () => {
    const path = parseSvgPath('M 0.5 1.5 L 2.75 3.25');
    expect(path.segments[0]).toEqual({ type: 'M', x: 0.5, y: 1.5 });
    expect(path.segments[1]).toEqual({ type: 'L', x: 2.75, y: 3.25 });
  });

  test('parse multiple coordinate pairs after L', () => {
    const path = parseSvgPath('M 0 0 L 10 10 20 20 30 30');
    expect(path.segments).toHaveLength(4); // M + 3 L
    expect(path.segments[3]).toEqual({ type: 'L', x: 30, y: 30 });
  });

  test('parse implicit lineto after moveto', () => {
    const path = parseSvgPath('M 0 0 10 10 20 20');
    expect(path.segments).toHaveLength(3); // M + 2 implicit L
    expect(path.segments[1]).toEqual({ type: 'L', x: 10, y: 10 });
    expect(path.segments[2]).toEqual({ type: 'L', x: 20, y: 20 });
  });

  test('parse empty string returns empty path', () => {
    const path = parseSvgPath('');
    expect(path.segments).toHaveLength(0);
  });

  // ─── H/h, V/v, S/s, T/t Commands ─────────────────────────────────────

  test('parse H (absolute horizontal lineto)', () => {
    const path = parseSvgPath('M 0 10 H 50');
    expect(path.segments).toHaveLength(2);
    expect(path.segments[1]).toEqual({ type: 'L', x: 50, y: 10 });
  });

  test('parse h (relative horizontal lineto)', () => {
    const path = parseSvgPath('M 10 20 h 30');
    expect(path.segments).toHaveLength(2);
    expect(path.segments[1]).toEqual({ type: 'L', x: 40, y: 20 });
  });

  test('parse V (absolute vertical lineto)', () => {
    const path = parseSvgPath('M 10 0 V 60');
    expect(path.segments).toHaveLength(2);
    expect(path.segments[1]).toEqual({ type: 'L', x: 10, y: 60 });
  });

  test('parse v (relative vertical lineto)', () => {
    const path = parseSvgPath('M 10 20 v 15');
    expect(path.segments).toHaveLength(2);
    expect(path.segments[1]).toEqual({ type: 'L', x: 10, y: 35 });
  });

  test('parse S (smooth cubic) reflects previous cubic control point', () => {
    // C ends at (30,0) with last control point (20,0).
    // S should reflect (20,0) across (30,0) to get first CP (40,0).
    const path = parseSvgPath('M 0,0 C 10,10 20,0 30,0 S 50,10 60,0');
    expect(path.segments).toHaveLength(3);
    const s = path.segments[2];
    expect(s.type).toBe('C');
    if (s.type === 'C') {
      expect(s.x1).toBeCloseTo(40, 10); // reflected: 2*30 - 20
      expect(s.y1).toBeCloseTo(0, 10); // reflected: 2*0 - 0
      expect(s.x2).toBe(50);
      expect(s.y2).toBe(10);
      expect(s.x).toBe(60);
      expect(s.y).toBe(0);
    }
  });

  test('parse s (relative smooth cubic) reflects previous cubic control point', () => {
    // C ends at (30,0) with last control point (20,0).
    // s with dx2=10,dy2=5,dx=20,dy=0 => x2=50,y2=5,x=50,y=0, reflected CP1=(40,0)
    const path = parseSvgPath('M 0,0 C 10,10 20,0 30,0 s 20,5 30,0');
    expect(path.segments).toHaveLength(3);
    const s = path.segments[2];
    expect(s.type).toBe('C');
    if (s.type === 'C') {
      expect(s.x1).toBeCloseTo(40, 10); // reflected
      expect(s.y1).toBeCloseTo(0, 10);
      expect(s.x2).toBeCloseTo(50, 10); // 30 + 20
      expect(s.y2).toBeCloseTo(5, 10); // 0 + 5
      expect(s.x).toBeCloseTo(60, 10); // 30 + 30
      expect(s.y).toBeCloseTo(0, 10);
    }
  });

  test('parse S without prior cubic uses current point as CP1', () => {
    // No previous C/c/S/s, so CP1 = current point (10,20)
    const path = parseSvgPath('M 10,20 S 30,40 50,20');
    expect(path.segments).toHaveLength(2);
    const s = path.segments[1];
    expect(s.type).toBe('C');
    if (s.type === 'C') {
      expect(s.x1).toBe(10);
      expect(s.y1).toBe(20);
      expect(s.x2).toBe(30);
      expect(s.y2).toBe(40);
      expect(s.x).toBe(50);
      expect(s.y).toBe(20);
    }
  });

  test('parse T (smooth quadratic) reflects previous quadratic control point', () => {
    // Q has CP (10,10), ends at (20,0). T reflects (10,10) across (20,0) => (30,-10).
    const path = parseSvgPath('M 0,0 Q 10,10 20,0 T 40,0');
    expect(path.segments).toHaveLength(3);
    const t = path.segments[2];
    expect(t.type).toBe('Q');
    if (t.type === 'Q') {
      expect(t.x1).toBeCloseTo(30, 10); // reflected: 2*20 - 10
      expect(t.y1).toBeCloseTo(-10, 10); // reflected: 2*0 - 10
      expect(t.x).toBe(40);
      expect(t.y).toBe(0);
    }
  });

  test('parse t (relative smooth quadratic) reflects previous quadratic control point', () => {
    // Q has CP (10,10), ends at (20,0). t with dx=20,dy=0 => end (40,0), reflected CP (30,-10)
    const path = parseSvgPath('M 0,0 Q 10,10 20,0 t 20,0');
    expect(path.segments).toHaveLength(3);
    const t = path.segments[2];
    expect(t.type).toBe('Q');
    if (t.type === 'Q') {
      expect(t.x1).toBeCloseTo(30, 10);
      expect(t.y1).toBeCloseTo(-10, 10);
      expect(t.x).toBeCloseTo(40, 10);
      expect(t.y).toBeCloseTo(0, 10);
    }
  });

  test('parse T without prior quadratic uses current point as CP', () => {
    const path = parseSvgPath('M 5,10 T 20,10');
    expect(path.segments).toHaveLength(2);
    const t = path.segments[1];
    expect(t.type).toBe('Q');
    if (t.type === 'Q') {
      expect(t.x1).toBe(5);
      expect(t.y1).toBe(10);
    }
  });

  // ─── SVG Serialization ───────────────────────────────────────────────

  test('round-trip: parse then serialize', () => {
    const original = 'M 0 0 L 100 0 L 100 100 Z';
    const path = parseSvgPath(original);
    const serialized = pathToSvgString(path);
    // Parse again and compare
    const reparsed = parseSvgPath(serialized);
    expect(reparsed.segments).toEqual(path.segments);
  });

  test('serialize cubic path', () => {
    const path = createPath().moveTo(0, 0).curveTo(10, 20, 30, 40, 50, 0).toPath();
    const svgStr = pathToSvgString(path);
    expect(svgStr).toContain('M 0 0');
    expect(svgStr).toContain('C 10 20 30 40 50 0');
  });

  test('round-trip complex path snapshot', () => {
    const svgData = 'M 10 20 L 30 40 C 50 60 70 80 90 100 Q 110 120 130 140 Z';
    const path = parseSvgPath(svgData);
    const roundTripped = pathToSvgString(path);
    expect(roundTripped).toMatchSnapshot();
  });

  // ─── Bounding Box ────────────────────────────────────────────────────

  test('pathBoundingBox of empty path', () => {
    const box = pathBoundingBox({ segments: [], closed: false });
    expect(box).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  test('pathBoundingBox of rectangle path', () => {
    const path = parseSvgPath('M 0 0 L 100 0 L 100 50 L 0 50 Z');
    const box = pathBoundingBox(path);
    expect(box.x).toBeCloseTo(0, 5);
    expect(box.y).toBeCloseTo(0, 5);
    expect(box.width).toBeCloseTo(100, 5);
    expect(box.height).toBeCloseTo(50, 5);
  });

  test('pathBoundingBox includes curve extrema', () => {
    const path = parseSvgPath('M 0 0 C 0 100 100 100 100 0');
    const box = pathBoundingBox(path);
    expect(box.y + box.height).toBeGreaterThan(0); // Curve extends above
  });

  test('pathBoundingBox of single point', () => {
    const path = parseSvgPath('M 5 10');
    const box = pathBoundingBox(path);
    expect(box.x).toBe(5);
    expect(box.y).toBe(10);
    expect(box.width).toBe(0);
    expect(box.height).toBe(0);
  });

  // ─── Path Length ─────────────────────────────────────────────────────

  test('pathLength of horizontal line', () => {
    const path = parseSvgPath('M 0 0 L 100 0');
    expect(pathLength(path)).toBeCloseTo(100, 5);
  });

  test('pathLength of 3-4-5 triangle sides', () => {
    const path = parseSvgPath('M 0 0 L 3 0 L 3 4');
    // Two segments: 3 + 4 = 7
    expect(pathLength(path)).toBeCloseTo(7, 5);
  });

  test('pathLength of empty path is 0', () => {
    expect(pathLength({ segments: [], closed: false })).toBe(0);
  });

  test('pathLength of MoveTo only is 0', () => {
    const path = parseSvgPath('M 10 20');
    expect(pathLength(path)).toBe(0);
  });

  // ─── Point at Length ─────────────────────────────────────────────────

  test('pointAtLength at start', () => {
    const path = parseSvgPath('M 0 0 L 100 0');
    const result = pointAtLength(path, 0);
    expect(result.point.x).toBeCloseTo(0, 5);
    expect(result.point.y).toBeCloseTo(0, 5);
  });

  test('pointAtLength at midpoint of horizontal line', () => {
    const path = parseSvgPath('M 0 0 L 100 0');
    const result = pointAtLength(path, 50);
    expect(result.point.x).toBeCloseTo(50, 5);
    expect(result.point.y).toBeCloseTo(0, 5);
    expect(result.tangent.x).toBeCloseTo(1, 5);
    expect(result.tangent.y).toBeCloseTo(0, 5);
  });

  test('pointAtLength past end returns last point', () => {
    const path = parseSvgPath('M 0 0 L 100 0');
    const result = pointAtLength(path, 200);
    expect(result.point.x).toBeCloseTo(100, 5);
    expect(result.point.y).toBeCloseTo(0, 5);
  });

  test('pointAtLength of empty path returns origin', () => {
    const result = pointAtLength({ segments: [], closed: false }, 10);
    expect(result.point).toEqual({ x: 0, y: 0 });
  });

  // ─── Reverse Path ───────────────────────────────────────────────────

  test('reversePath reverses line segments', () => {
    const path = parseSvgPath('M 0 0 L 100 0 L 100 100');
    const reversed = reversePath(path);
    // Should start at (100, 100) and end at (0, 0)
    expect(reversed.segments[0]).toEqual({ type: 'M', x: 100, y: 100 });
  });

  test('reversePath preserves closed status', () => {
    const path = parseSvgPath('M 0 0 L 100 0 Z');
    const reversed = reversePath(path);
    expect(reversed.closed).toBe(true);
  });

  test('reversePath of open path preserves open status', () => {
    const path = parseSvgPath('M 0 0 L 100 0');
    const reversed = reversePath(path);
    expect(reversed.closed).toBe(false);
  });

  // ─── Transform Path ─────────────────────────────────────────────────

  test('transformPath with identity is unchanged', () => {
    const path = parseSvgPath('M 0 0 L 100 0');
    const transformed = transformPath(path, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    expect(transformed.segments).toEqual(path.segments);
  });

  test('transformPath with translation shifts all points', () => {
    const path = parseSvgPath('M 0 0 L 100 0');
    const transformed = transformPath(path, translate(10, 20));
    expect(transformed.segments[0]).toEqual({ type: 'M', x: 10, y: 20 });
    expect(transformed.segments[1]).toEqual({ type: 'L', x: 110, y: 20 });
  });

  test('transformPath with scale', () => {
    const path = parseSvgPath('M 10 20 L 30 40');
    const transformed = transformPath(path, scale(2, 3));
    expect(transformed.segments[0]).toEqual({ type: 'M', x: 20, y: 60 });
    expect(transformed.segments[1]).toEqual({ type: 'L', x: 60, y: 120 });
  });

  test('transformPath transforms cubic control points', () => {
    const path = parseSvgPath('M 0 0 C 10 20 30 40 50 0');
    const transformed = transformPath(path, translate(100, 100));
    const cubic = transformed.segments[1];
    expect(cubic.type).toBe('C');
    if (cubic.type === 'C') {
      expect(cubic.x1).toBeCloseTo(110, 10);
      expect(cubic.y1).toBeCloseTo(120, 10);
      expect(cubic.x2).toBeCloseTo(130, 10);
      expect(cubic.y2).toBeCloseTo(140, 10);
      expect(cubic.x).toBeCloseTo(150, 10);
      expect(cubic.y).toBeCloseTo(100, 10);
    }
  });

  test('transformPath preserves Z commands', () => {
    const path = parseSvgPath('M 0 0 L 100 0 Z');
    const transformed = transformPath(path, translate(10, 10));
    expect(transformed.segments[2]).toEqual({ type: 'Z' });
  });

  test('transformPath preserves closed status', () => {
    const path = parseSvgPath('M 0 0 L 100 0 Z');
    const transformed = transformPath(path, translate(10, 10));
    expect(transformed.closed).toBe(path.closed);
  });

  // ─── splitIntoSubPaths ─────────────────────────────────────────────

  test('splitIntoSubPaths returns precomputed subPaths when available', () => {
    const subPaths = [
      {
        segments: [
          { type: 'M' as const, x: 0, y: 0 },
          { type: 'L' as const, x: 10, y: 0 },
          { type: 'Z' as const },
        ],
        closed: true,
      },
      {
        segments: [
          { type: 'M' as const, x: 20, y: 0 },
          { type: 'L' as const, x: 30, y: 0 },
        ],
        closed: false,
      },
    ];
    const path = { segments: [], closed: false, subPaths };
    expect(splitIntoSubPaths(path)).toBe(subPaths);
  });

  test('splitIntoSubPaths splits compound path by M commands', () => {
    const path = parseSvgPath('M 0 0 L 10 0 Z M 20 0 L 30 0');
    const subs = splitIntoSubPaths(path);
    expect(subs).toHaveLength(2);
    expect(subs[0].closed).toBe(true);
    expect(subs[0].segments).toHaveLength(3); // M, L, Z
    expect(subs[1].closed).toBe(false);
    expect(subs[1].segments).toHaveLength(2); // M, L
  });

  test('splitIntoSubPaths returns single subpath for simple path', () => {
    const path = parseSvgPath('M 0 0 L 10 0 L 10 10 Z');
    const subs = splitIntoSubPaths(path);
    expect(subs).toHaveLength(1);
    expect(subs[0].closed).toBe(true);
  });

  test('splitIntoSubPaths returns empty array for empty path', () => {
    const path = { segments: [], closed: false };
    expect(splitIntoSubPaths(path)).toHaveLength(0);
  });
});
