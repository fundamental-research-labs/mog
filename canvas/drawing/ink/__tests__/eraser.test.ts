import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import type { StrokeId } from '@mog-sdk/contracts/ink';
import { eraseFromStroke, pointErase, strokeErase } from '../src/eraser';
import type { Stroke, StrokePoint } from '../src/stroke';
import { createStroke } from '../src/stroke';

// =============================================================================
// Helpers
// =============================================================================

/** Cast a plain string to StrokeId for testing. */
const testId = (id: string) => id as StrokeId;

function makePoints(coords: [number, number][], pressure = 0.5): StrokePoint[] {
  return coords.map(([x, y], i) => ({
    x,
    y,
    pressure,
    timestamp: i * 10,
  }));
}

function makeStroke(coords: [number, number][], id?: string, width = 2): Stroke {
  return createStroke(makePoints(coords), {
    color: '#000',
    width,
    id: testId(id ?? `stroke-${Math.random()}`),
  });
}

function box(x: number, y: number, w: number, h: number): BoundingBox {
  return { x, y, width: w, height: h };
}

// =============================================================================
// eraseFromStroke
// =============================================================================

describe('eraseFromStroke', () => {
  test('non-overlapping eraser returns original stroke', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      'test',
    );
    const result = eraseFromStroke(stroke, box(100, 100, 10, 10));
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(stroke); // Same reference (untouched)
  });

  test('eraser covering entire stroke returns empty', () => {
    const stroke = makeStroke(
      [
        [5, 5],
        [10, 5],
        [15, 5],
      ],
      'test',
    );
    const result = eraseFromStroke(stroke, box(0, 0, 20, 10));
    expect(result).toHaveLength(0);
  });

  test('eraser in middle splits stroke into two', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
        [40, 0],
      ],
      'test',
    );
    // Erase the middle point at (20, 0)
    const result = eraseFromStroke(stroke, box(15, -5, 10, 10));
    expect(result).toHaveLength(2);
    // First part: points before eraser
    expect(result[0].points.length).toBeGreaterThanOrEqual(1);
    // Second part: points after eraser
    expect(result[1].points.length).toBeGreaterThanOrEqual(1);
  });

  test('eraser at start removes leading points', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
      ],
      'test',
    );
    const result = eraseFromStroke(stroke, box(-5, -5, 16, 10));
    expect(result).toHaveLength(1);
    // With segment clipping, first surviving point is at rect boundary (x=11)
    expect(result[0].points[0].x).toBeGreaterThanOrEqual(11);
    expect(result[0].points[0].x).toBeLessThanOrEqual(20);
  });

  test('eraser at end removes trailing points', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
      ],
      'test',
    );
    const result = eraseFromStroke(stroke, box(15, -5, 20, 10));
    expect(result).toHaveLength(1);
    // With segment clipping, last surviving point is at rect boundary (x=15)
    const lastPt = result[0].points[result[0].points.length - 1];
    expect(lastPt.x).toBeGreaterThanOrEqual(10);
    expect(lastPt.x).toBeLessThanOrEqual(15);
  });

  test('multiple eraser holes produce multiple fragments', () => {
    const coords: [number, number][] = [];
    for (let i = 0; i <= 100; i += 5) {
      coords.push([i, 0]);
    }
    const stroke = makeStroke(coords, 'test');

    // Erase at x=25 and x=75
    const after1 = eraseFromStroke(stroke, box(23, -5, 4, 10));
    expect(after1).toHaveLength(2);

    // Apply second eraser to all fragments
    const after2 = after1.flatMap((s) => eraseFromStroke(s, box(73, -5, 4, 10)));
    expect(after2.length).toBeGreaterThanOrEqual(2);
  });

  test('empty stroke returns empty', () => {
    const stroke = {
      id: testId('test'),
      points: [],
      color: '#000',
      width: 2,
      opacity: 1,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    } as Stroke;
    const result = eraseFromStroke(stroke, box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });

  test('sub-strokes have unique IDs', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
        [40, 0],
      ],
      'original',
    );
    const result = eraseFromStroke(stroke, box(15, -5, 10, 10));
    if (result.length >= 2) {
      expect(result[0].id).not.toBe(result[1].id);
      expect(result[0].id).toContain('original');
    }
  });

  test('sub-strokes preserve color and width', () => {
    const stroke = createStroke(
      makePoints([
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
        [40, 0],
      ]),
      { color: '#ff0000', width: 5, opacity: 0.7, id: testId('test') },
    );
    const result = eraseFromStroke(stroke, box(15, -5, 10, 10));
    for (const sub of result) {
      expect(sub.color).toBe('#ff0000');
      expect(sub.width).toBe(5);
      expect(sub.opacity).toBe(0.7);
    }
  });
});

// =============================================================================
// pointErase
// =============================================================================

describe('pointErase', () => {
  test('non-overlapping circle returns original', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      'test',
    );
    const result = pointErase(stroke, { x: 100, y: 100 }, 5);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(stroke);
  });

  test('circle covering all points returns empty', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      'test',
    );
    const result = pointErase(stroke, { x: 1, y: 0 }, 10);
    expect(result).toHaveLength(0);
  });

  test('circle in middle splits stroke', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
        [40, 0],
      ],
      'test',
    );
    const result = pointErase(stroke, { x: 20, y: 0 }, 3);
    expect(result).toHaveLength(2);
  });

  test('point erase at start', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
      ],
      'test',
    );
    const result = pointErase(stroke, { x: 0, y: 0 }, 3);
    expect(result).toHaveLength(1);
    expect(result[0].points[0].x).toBeGreaterThan(0);
  });

  test('point erase at end', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
      ],
      'test',
    );
    const result = pointErase(stroke, { x: 30, y: 0 }, 3);
    expect(result).toHaveLength(1);
    const lastPt = result[0].points[result[0].points.length - 1];
    expect(lastPt.x).toBeLessThan(30);
  });

  test('empty stroke returns empty', () => {
    const stroke = {
      id: testId('test'),
      points: [],
      color: '#000',
      width: 2,
      opacity: 1,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    } as Stroke;
    const result = pointErase(stroke, { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  test('zero radius is a no-op', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      'test',
    );
    // Zero radius: no-op, returns stroke unchanged
    const result = pointErase(stroke, { x: 10, y: 0 }, 0);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(stroke);
  });

  test('zero radius with multi-point stroke is a no-op', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [5, 0],
        [10, 0],
        [15, 0],
        [20, 0],
      ],
      'test',
    );
    // Zero radius: no-op, returns stroke unchanged
    const result = pointErase(stroke, { x: 10, y: 0 }, 0);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(stroke);
  });

  test('sub-strokes have correct bounds', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
        [40, 0],
      ],
      'test',
      4,
    );
    const result = pointErase(stroke, { x: 20, y: 0 }, 3);
    for (const sub of result) {
      expect(sub.bounds).toBeDefined();
      expect(sub.bounds.width).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// strokeErase
// =============================================================================

describe('strokeErase', () => {
  test('no strokes in eraser rect: all remaining', () => {
    const strokes = [
      makeStroke(
        [
          [0, 0],
          [10, 0],
        ],
        'a',
      ),
      makeStroke(
        [
          [20, 0],
          [30, 0],
        ],
        'b',
      ),
    ];
    const { remaining, removed } = strokeErase(strokes, box(100, 100, 10, 10));
    expect(remaining).toHaveLength(2);
    expect(removed).toHaveLength(0);
  });

  test('one stroke in eraser rect: removes it', () => {
    const strokes = [
      makeStroke(
        [
          [5, 5],
          [10, 5],
        ],
        'a',
      ),
      makeStroke(
        [
          [200, 200],
          [210, 200],
        ],
        'b',
      ),
    ];
    const { remaining, removed } = strokeErase(strokes, box(0, 0, 20, 20));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('b');
    expect(removed).toEqual(['a']);
  });

  test('all strokes in eraser rect: removes all', () => {
    const strokes = [
      makeStroke(
        [
          [5, 5],
          [10, 5],
        ],
        'a',
      ),
      makeStroke(
        [
          [5, 15],
          [10, 15],
        ],
        'b',
      ),
    ];
    const { remaining, removed } = strokeErase(strokes, box(0, 0, 20, 20));
    expect(remaining).toHaveLength(0);
    expect(removed).toHaveLength(2);
  });

  test('empty strokes array', () => {
    const { remaining, removed } = strokeErase([], box(0, 0, 10, 10));
    expect(remaining).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  test('stroke with bounds overlapping but no points inside', () => {
    // Stroke bounds overlap the eraser rect, but no actual points are inside
    const stroke = makeStroke(
      [
        [0, 0],
        [100, 0],
      ],
      'a',
      10,
    );
    // Stroke bounds: x=-5, y=-5, w=110, h=10
    // Eraser rect at y=50: no points inside
    const { remaining, removed } = strokeErase([stroke], box(40, 50, 20, 20));
    expect(remaining).toHaveLength(1);
    expect(removed).toHaveLength(0);
  });

  test('stroke with one point barely inside rect', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [50, 0],
        [100, 0],
      ],
      'a',
    );
    // Rect covering exactly the middle point
    const { remaining, removed } = strokeErase([stroke], box(49, -1, 2, 2));
    expect(remaining).toHaveLength(0);
    expect(removed).toEqual(['a']);
  });

  test('removed IDs are correct', () => {
    const strokes = [
      makeStroke([[5, 5]], 'alpha'),
      makeStroke([[50, 50]], 'beta'),
      makeStroke([[100, 100]], 'gamma'),
    ];
    const { removed } = strokeErase(strokes, box(0, 0, 60, 60));
    expect(removed.sort()).toEqual(['alpha', 'beta']);
  });

  test('segment crossing through eraser rect without any point inside is erased', () => {
    // Two points far apart, with a segment that crosses a small eraser rect in between.
    // No point is inside the rect, but the segment visually passes through it.
    const stroke = makeStroke(
      [
        [0, 0],
        [100, 100],
      ],
      'crossing',
    );
    // Small rect at (45, 45) size 10x10 - the diagonal segment passes through it
    const { remaining, removed } = strokeErase([stroke], box(45, 45, 10, 10));
    expect(removed).toEqual(['crossing']);
    expect(remaining).toHaveLength(0);
  });

  test('vertical segment crossing horizontal eraser rect is erased', () => {
    // Vertical stroke from top to bottom, crossing a horizontal eraser rect
    const stroke = makeStroke(
      [
        [50, 0],
        [50, 100],
      ],
      'vertical',
    );
    // Eraser rect in the middle that the segment crosses
    const { remaining, removed } = strokeErase([stroke], box(40, 40, 20, 20));
    expect(removed).toEqual(['vertical']);
    expect(remaining).toHaveLength(0);
  });

  test('segment that does not cross eraser rect is not erased', () => {
    // Diagonal stroke that passes to the side of the eraser rect
    const stroke = makeStroke(
      [
        [0, 0],
        [100, 0],
      ],
      'horizontal',
    );
    // Eraser rect below the stroke - no intersection
    const { remaining, removed } = strokeErase([stroke], box(40, 10, 20, 20));
    expect(remaining).toHaveLength(1);
    expect(removed).toHaveLength(0);
  });

  test('multiple strokes: only crossing segments are erased', () => {
    // One stroke crosses the rect, the other does not
    const crossingStroke = makeStroke(
      [
        [0, 0],
        [100, 100],
      ],
      'crosses',
    );
    const safeStroke = makeStroke(
      [
        [200, 200],
        [300, 200],
      ],
      'safe',
    );
    const { remaining, removed } = strokeErase([crossingStroke, safeStroke], box(45, 45, 10, 10));
    expect(removed).toEqual(['crosses']);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('safe');
  });
});

// =============================================================================
// Additional eraser.test.ts tests (5aa)
// =============================================================================

describe('eraseFromStroke - segment clipping', () => {
  test('segment crossing through rect is clipped at boundaries', () => {
    // Diagonal stroke from (-50, 0) to (150, 0) with eraser rect in middle
    const stroke = makeStroke(
      [
        [-50, 0],
        [150, 0],
      ],
      'clip-test',
    );
    const result = eraseFromStroke(stroke, box(40, -5, 20, 10));
    // Should produce 2 fragments: before and after the eraser
    expect(result).toHaveLength(2);
    // First fragment should end near x=40
    const lastOfFirst = result[0].points[result[0].points.length - 1];
    expect(lastOfFirst.x).toBeCloseTo(40, 0);
    // Second fragment should start near x=60
    const firstOfSecond = result[1].points[0];
    expect(firstOfSecond.x).toBeCloseTo(60, 0);
  });

  test('single-point stroke inside eraser is removed', () => {
    const stroke = makeStroke([[50, 50]], 'single-in');
    const result = eraseFromStroke(stroke, box(40, 40, 20, 20));
    expect(result).toHaveLength(0);
  });

  test('single-point stroke outside eraser is preserved', () => {
    const stroke = makeStroke([[100, 100]], 'single-out');
    const result = eraseFromStroke(stroke, box(0, 0, 10, 10));
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(stroke);
  });
});

describe('pointErase - segment clipping', () => {
  test('segment crossing through circle is clipped at boundaries', () => {
    const stroke = makeStroke(
      [
        [-50, 0],
        [50, 0],
      ],
      'circle-clip',
    );
    const result = pointErase(stroke, { x: 0, y: 0 }, 10);
    // Should produce 2 fragments
    expect(result).toHaveLength(2);
    // Fragments should start/end near circle boundary
    const lastOfFirst = result[0].points[result[0].points.length - 1];
    expect(Math.abs(lastOfFirst.x)).toBeCloseTo(10, 0);
    const firstOfSecond = result[1].points[0];
    expect(Math.abs(firstOfSecond.x)).toBeCloseTo(10, 0);
  });

  test('negative radius is a no-op', () => {
    const stroke = makeStroke(
      [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      'neg-r',
    );
    const result = pointErase(stroke, { x: 10, y: 0 }, -5);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(stroke);
  });

  test('single-point stroke inside circle is removed', () => {
    const stroke = makeStroke([[5, 5]], 'sp-in');
    const result = pointErase(stroke, { x: 5, y: 5 }, 1);
    expect(result).toHaveLength(0);
  });

  test('single-point stroke outside circle is preserved', () => {
    const stroke = makeStroke([[100, 100]], 'sp-out');
    const result = pointErase(stroke, { x: 0, y: 0 }, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(stroke);
  });
});
