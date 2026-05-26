import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import type { StrokeId } from '@mog-sdk/contracts/ink';
import { validateSpatialIndex, validateStroke } from '../src/diagnostics';
import { createSpatialIndex } from '../src/spatial-index';
import type { Stroke, StrokePoint } from '../src/stroke';
import { createStroke, strokeBoundingBox } from '../src/stroke';

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

function makeValidStroke(coords: [number, number][], id = 'test-stroke'): Stroke {
  return createStroke(makePoints(coords), {
    color: '#ff0000',
    width: 3,
    opacity: 0.8,
    id: testId(id),
  });
}

function box(x: number, y: number, w: number, h: number): BoundingBox {
  return { x, y, width: w, height: h };
}

// =============================================================================
// validateStroke - valid strokes
// =============================================================================

describe('validateStroke - valid strokes', () => {
  test('basic valid stroke', () => {
    const stroke = makeValidStroke([
      [0, 0],
      [10, 10],
    ]);
    const result = validateStroke(stroke);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  test('single point stroke is valid', () => {
    const stroke = makeValidStroke([[50, 50]]);
    const result = validateStroke(stroke);
    expect(result.valid).toBe(true);
  });

  test('stroke with varying pressure is valid', () => {
    const pts: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0, timestamp: 0 },
      { x: 10, y: 10, pressure: 0.5, timestamp: 10 },
      { x: 20, y: 20, pressure: 1, timestamp: 20 },
    ];
    const stroke = createStroke(pts, { color: '#000', width: 5, id: testId('test') });
    const result = validateStroke(stroke);
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// validateStroke - empty stroke
// =============================================================================

describe('validateStroke - empty stroke', () => {
  test('empty points triggers warning', () => {
    const stroke: Stroke = {
      id: testId('empty'),
      points: [],
      color: '#000',
      width: 3,
      opacity: 1,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
    const result = validateStroke(stroke);
    expect(result.valid).toBe(true); // Warning, not error
    expect(result.issues.some((i) => i.code === 'STROKE_EMPTY')).toBe(true);
  });
});

// =============================================================================
// validateStroke - NaN detection
// =============================================================================

describe('validateStroke - NaN detection', () => {
  test('NaN x coordinate', () => {
    const pts: StrokePoint[] = [{ x: NaN, y: 10, pressure: 0.5, timestamp: 0 }];
    const stroke: Stroke = {
      id: testId('nan-test'),
      points: pts,
      color: '#000',
      width: 3,
      opacity: 1,
      bounds: box(0, 0, 10, 10),
    };
    const result = validateStroke(stroke);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'STROKE_NAN_COORDINATE')).toBe(true);
  });

  test('NaN y coordinate', () => {
    const pts: StrokePoint[] = [{ x: 10, y: NaN, pressure: 0.5, timestamp: 0 }];
    const stroke: Stroke = {
      id: testId('nan-test'),
      points: pts,
      color: '#000',
      width: 3,
      opacity: 1,
      bounds: box(0, 0, 10, 10),
    };
    const result = validateStroke(stroke);
    expect(result.valid).toBe(false);
  });

  test('Infinity coordinate', () => {
    const pts: StrokePoint[] = [{ x: Infinity, y: 10, pressure: 0.5, timestamp: 0 }];
    const stroke: Stroke = {
      id: testId('inf-test'),
      points: pts,
      color: '#000',
      width: 3,
      opacity: 1,
      bounds: box(0, 0, 10, 10),
    };
    const result = validateStroke(stroke);
    expect(result.valid).toBe(false);
  });

  test('NaN pressure', () => {
    const pts: StrokePoint[] = [{ x: 0, y: 0, pressure: NaN, timestamp: 0 }];
    const stroke: Stroke = {
      id: testId('nan-pressure'),
      points: pts,
      color: '#000',
      width: 3,
      opacity: 1,
      bounds: strokeBoundingBox(pts, 3),
    };
    const result = validateStroke(stroke);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'STROKE_NAN_PRESSURE')).toBe(true);
  });

  test('NaN timestamp', () => {
    const pts: StrokePoint[] = [{ x: 0, y: 0, pressure: 0.5, timestamp: NaN }];
    const stroke: Stroke = {
      id: testId('nan-ts'),
      points: pts,
      color: '#000',
      width: 3,
      opacity: 1,
      bounds: strokeBoundingBox(pts, 3),
    };
    const result = validateStroke(stroke);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'STROKE_NAN_TIMESTAMP')).toBe(true);
  });
});

// =============================================================================
// validateStroke - pressure range
// =============================================================================

describe('validateStroke - pressure range', () => {
  test('pressure above 1 triggers warning', () => {
    const pts: StrokePoint[] = [{ x: 0, y: 0, pressure: 1.5, timestamp: 0 }];
    const stroke: Stroke = {
      id: testId('pressure-high'),
      points: pts,
      color: '#000',
      width: 3,
      opacity: 1,
      bounds: strokeBoundingBox(pts, 3),
    };
    const result = validateStroke(stroke);
    expect(result.issues.some((i) => i.code === 'STROKE_PRESSURE_OUT_OF_RANGE')).toBe(true);
  });

  test('negative pressure triggers warning', () => {
    const pts: StrokePoint[] = [{ x: 0, y: 0, pressure: -0.1, timestamp: 0 }];
    const stroke: Stroke = {
      id: testId('pressure-neg'),
      points: pts,
      color: '#000',
      width: 3,
      opacity: 1,
      bounds: strokeBoundingBox(pts, 3),
    };
    const result = validateStroke(stroke);
    expect(result.issues.some((i) => i.code === 'STROKE_PRESSURE_OUT_OF_RANGE')).toBe(true);
  });
});

// =============================================================================
// validateStroke - bounds mismatch
// =============================================================================

describe('validateStroke - bounds mismatch', () => {
  test('mismatched bounds triggers warning', () => {
    const pts = makePoints([
      [0, 0],
      [100, 100],
    ]);
    const stroke: Stroke = {
      id: testId('bounds-mismatch'),
      points: pts,
      color: '#000',
      width: 4,
      opacity: 1,
      bounds: box(999, 999, 1, 1), // Wrong bounds
    };
    const result = validateStroke(stroke);
    expect(result.issues.some((i) => i.code === 'STROKE_BOUNDS_MISMATCH')).toBe(true);
  });

  test('correct bounds: no mismatch warning', () => {
    const stroke = makeValidStroke([
      [0, 0],
      [100, 100],
    ]);
    const result = validateStroke(stroke);
    expect(result.issues.some((i) => i.code === 'STROKE_BOUNDS_MISMATCH')).toBe(false);
  });
});

// =============================================================================
// validateStroke - zero-length
// =============================================================================

describe('validateStroke - zero-length', () => {
  test('all same position triggers info', () => {
    const pts = makePoints([
      [50, 50],
      [50, 50],
      [50, 50],
    ]);
    const stroke = createStroke(pts, { color: '#000', width: 3, id: testId('zero-len') });
    const result = validateStroke(stroke);
    expect(result.issues.some((i) => i.code === 'STROKE_ZERO_LENGTH')).toBe(true);
  });
});

// =============================================================================
// validateStroke - width and opacity
// =============================================================================

describe('validateStroke - width and opacity', () => {
  test('negative width is error', () => {
    const stroke: Stroke = {
      id: testId('neg-width'),
      points: makePoints([[0, 0]]),
      color: '#000',
      width: -1,
      opacity: 1,
      bounds: box(0, 0, 10, 10),
    };
    const result = validateStroke(stroke);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'STROKE_INVALID_WIDTH')).toBe(true);
  });

  test('zero width is error', () => {
    const stroke: Stroke = {
      id: testId('zero-width'),
      points: makePoints([[0, 0]]),
      color: '#000',
      width: 0,
      opacity: 1,
      bounds: box(0, 0, 10, 10),
    };
    const result = validateStroke(stroke);
    expect(result.valid).toBe(false);
  });

  test('opacity > 1 is warning', () => {
    const stroke: Stroke = {
      id: testId('high-opacity'),
      points: makePoints([[0, 0]]),
      color: '#000',
      width: 3,
      opacity: 1.5,
      bounds: strokeBoundingBox(makePoints([[0, 0]]), 3),
    };
    const result = validateStroke(stroke);
    expect(result.issues.some((i) => i.code === 'STROKE_OPACITY_OUT_OF_RANGE')).toBe(true);
  });

  test('negative opacity is warning', () => {
    const stroke: Stroke = {
      id: testId('neg-opacity'),
      points: makePoints([[0, 0]]),
      color: '#000',
      width: 3,
      opacity: -0.1,
      bounds: strokeBoundingBox(makePoints([[0, 0]]), 3),
    };
    const result = validateStroke(stroke);
    expect(result.issues.some((i) => i.code === 'STROKE_OPACITY_OUT_OF_RANGE')).toBe(true);
  });
});

// =============================================================================
// validateStroke - color and ID
// =============================================================================

describe('validateStroke - color and ID', () => {
  test('empty color triggers warning', () => {
    const stroke: Stroke = {
      id: testId('empty-color'),
      points: makePoints([[0, 0]]),
      color: '',
      width: 3,
      opacity: 1,
      bounds: strokeBoundingBox(makePoints([[0, 0]]), 3),
    };
    const result = validateStroke(stroke);
    expect(result.issues.some((i) => i.code === 'STROKE_EMPTY_COLOR')).toBe(true);
  });

  test('empty ID triggers error', () => {
    const stroke: Stroke = {
      id: testId(''),
      points: makePoints([[0, 0]]),
      color: '#000',
      width: 3,
      opacity: 1,
      bounds: strokeBoundingBox(makePoints([[0, 0]]), 3),
    };
    const result = validateStroke(stroke);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'STROKE_EMPTY_ID')).toBe(true);
  });
});

// =============================================================================
// validateSpatialIndex
// =============================================================================

describe('validateSpatialIndex', () => {
  test('empty index is valid with info', () => {
    const idx = createSpatialIndex<string>();
    const result = validateSpatialIndex(idx);
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.code === 'INDEX_EMPTY')).toBe(true);
  });

  test('valid populated index', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 10, 10), 'data1');
    idx.insert('b', box(20, 20, 10, 10), 'data2');
    const result = validateSpatialIndex(idx);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  test('no duplicate IDs in normal usage', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 10, 10), 'data1');
    idx.insert('b', box(10, 10, 10, 10), 'data2');
    const result = validateSpatialIndex(idx);
    expect(result.issues.some((i) => i.code === 'INDEX_DUPLICATE_ID')).toBe(false);
  });

  test('validates bounds are finite', () => {
    // Can't easily create NaN bounds through the normal API since
    // createSpatialIndex stores what you give it. Test via manual construction.
    const idx = createSpatialIndex<string>();
    idx.insert('a', box(0, 0, 10, 10), 'data');
    idx.insert('nan', box(NaN, 0, 10, 10), 'data');
    const result = validateSpatialIndex(idx);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'INDEX_NAN_BOUNDS')).toBe(true);
  });

  test('validates negative bounds dimensions', () => {
    const idx = createSpatialIndex<string>();
    idx.insert('neg', box(0, 0, -10, 5), 'data');
    const result = validateSpatialIndex(idx);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'INDEX_NEGATIVE_BOUNDS')).toBe(true);
  });

  test('large valid index passes', () => {
    const idx = createSpatialIndex<number>();
    for (let i = 0; i < 50; i++) {
      idx.insert(`item-${i}`, box(i * 20, i * 20, 15, 15), i);
    }
    const result = validateSpatialIndex(idx);
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// Additional diagnostics.test.ts tests (5ac)
// =============================================================================

describe('validateStroke - NaN width and opacity', () => {
  test('NaN width is error', () => {
    const stroke: Stroke = {
      id: testId('nan-width'),
      points: makePoints([[0, 0]]),
      color: '#000',
      width: NaN,
      opacity: 1,
      bounds: box(0, 0, 10, 10),
    };
    const result = validateStroke(stroke);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'STROKE_INVALID_WIDTH')).toBe(true);
  });

  test('NaN opacity is warning', () => {
    const stroke: Stroke = {
      id: testId('nan-opacity'),
      points: makePoints([[0, 0]]),
      color: '#000',
      width: 3,
      opacity: NaN,
      bounds: strokeBoundingBox(makePoints([[0, 0]]), 3),
    };
    const result = validateStroke(stroke);
    expect(result.issues.some((i) => i.code === 'STROKE_OPACITY_OUT_OF_RANGE')).toBe(true);
  });
});

describe('validateStroke - bounds mismatch severity', () => {
  test('bounds mismatch is error severity', () => {
    const pts = makePoints([
      [0, 0],
      [100, 100],
    ]);
    const stroke: Stroke = {
      id: testId('bounds-err'),
      points: pts,
      color: '#000',
      width: 4,
      opacity: 1,
      bounds: box(999, 999, 1, 1),
    };
    const result = validateStroke(stroke);
    const mismatch = result.issues.find((i) => i.code === 'STROKE_BOUNDS_MISMATCH');
    expect(mismatch).toBeDefined();
    expect(mismatch!.severity).toBe('error');
  });
});

describe('validateStroke - bounds skip on NaN points', () => {
  test('skips bounds check when points have NaN coordinates', () => {
    const pts: StrokePoint[] = [{ x: NaN, y: 10, pressure: 0.5, timestamp: 0 }];
    const stroke: Stroke = {
      id: testId('nan-skip'),
      points: pts,
      color: '#000',
      width: 3,
      opacity: 1,
      bounds: box(999, 999, 1, 1), // intentionally wrong
    };
    const result = validateStroke(stroke);
    // Should NOT report bounds mismatch since points have NaN
    expect(result.issues.some((i) => i.code === 'STROKE_BOUNDS_MISMATCH')).toBe(false);
    // But should report NaN coordinate
    expect(result.issues.some((i) => i.code === 'STROKE_NAN_COORDINATE')).toBe(true);
  });
});
