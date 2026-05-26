import type { StrokeId } from '@mog-sdk/contracts/ink';
import { strokeToDrawingObject } from '../src/drawing-object-output';
import type { StrokePoint } from '../src/stroke';
import { createStroke } from '../src/stroke';

/** Cast a plain string to StrokeId for testing. */
const testId = (id: string) => id as StrokeId;

describe('strokeToDrawingObject', () => {
  function makePoints(count: number): StrokePoint[] {
    return Array.from({ length: count }, (_, i) => ({
      x: i * 10,
      y: i * 5,
      pressure: 0.5,
      timestamp: i * 16,
    }));
  }

  it('returns DrawingObject with geometry from strokeToPath', () => {
    const stroke = createStroke(makePoints(5), { color: '#ff0000', width: 3, id: testId('do-1') });
    const obj = strokeToDrawingObject(stroke);

    expect(obj.geometry).toBeDefined();
    expect(obj.geometry.segments.length).toBeGreaterThan(0);
  });

  it('sets solid fill with stroke color and opacity', () => {
    const stroke = createStroke(makePoints(5), {
      color: '#00ff00',
      width: 2,
      opacity: 0.7,
      id: testId('do-2'),
    });
    const obj = strokeToDrawingObject(stroke);

    expect(obj.fill).toEqual({
      type: 'solid',
      color: '#00ff00',
      opacity: 0.7,
    });
  });

  it('does not set stroke (path is already the filled outline)', () => {
    const stroke = createStroke(makePoints(5), { color: '#0000ff', width: 4, id: testId('do-3') });
    const obj = strokeToDrawingObject(stroke);

    expect(obj.stroke).toBeUndefined();
  });

  it('handles default opacity (1.0)', () => {
    const stroke = createStroke(makePoints(3), { color: '#000000', width: 1, id: testId('do-4') });
    const obj = strokeToDrawingObject(stroke);

    expect(obj.fill).toEqual({
      type: 'solid',
      color: '#000000',
      opacity: 1,
    });
  });

  it('single-point stroke produces DrawingObject with circle geometry', () => {
    const points: StrokePoint[] = [{ x: 50, y: 50, pressure: 0.5, timestamp: 0 }];
    const stroke = createStroke(points, { color: '#ff0000', width: 6, id: testId('do-single') });
    const obj = strokeToDrawingObject(stroke);

    expect(obj.geometry).toBeDefined();
    expect(obj.geometry.segments.length).toBeGreaterThan(0);
    // Single-point produces circle via cubic Bezier arcs: M + 4 C segments + Z
    expect(obj.geometry.segments[0].type).toBe('M');
    const cSegments = obj.geometry.segments.filter((s) => s.type === 'C');
    expect(cSegments.length).toBe(4); // 4 cubic arcs form a circle
    expect(obj.geometry.segments[obj.geometry.segments.length - 1].type).toBe('Z');
    // Path should be closed
    expect(obj.geometry.closed).toBe(true);
  });

  it('zero-pressure points produce narrow but valid path', () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0, timestamp: 0 },
      { x: 10, y: 10, pressure: 0, timestamp: 16 },
      { x: 20, y: 20, pressure: 0, timestamp: 32 },
    ];
    const stroke = createStroke(points, {
      color: '#000000',
      width: 4,
      id: testId('do-zero-pressure'),
    });
    const obj = strokeToDrawingObject(stroke);

    expect(obj.geometry).toBeDefined();
    expect(obj.geometry.segments.length).toBeGreaterThan(0);
    // Even with zero pressure, the MIN_PRESSURE_WIDTH_RATIO (0.1) ensures
    // a non-degenerate path width of at least width * 0.1 = 0.4
    expect(obj.fill).toBeDefined();
  });

  it('high-pressure points produce wider path than low-pressure points', () => {
    const lowPressurePoints: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0.2, timestamp: 0 },
      { x: 20, y: 0, pressure: 0.2, timestamp: 16 },
      { x: 40, y: 0, pressure: 0.2, timestamp: 32 },
    ];
    const highPressurePoints: StrokePoint[] = [
      { x: 0, y: 0, pressure: 1.0, timestamp: 0 },
      { x: 20, y: 0, pressure: 1.0, timestamp: 16 },
      { x: 40, y: 0, pressure: 1.0, timestamp: 32 },
    ];

    const lowStroke = createStroke(lowPressurePoints, {
      color: '#000000',
      width: 10,
      id: testId('do-low'),
    });
    const highStroke = createStroke(highPressurePoints, {
      color: '#000000',
      width: 10,
      id: testId('do-high'),
    });

    const lowObj = strokeToDrawingObject(lowStroke);
    const highObj = strokeToDrawingObject(highStroke);

    // Both should have valid geometry
    expect(lowObj.geometry.segments.length).toBeGreaterThan(0);
    expect(highObj.geometry.segments.length).toBeGreaterThan(0);

    // The high-pressure stroke produces a wider path.
    // For horizontal strokes, the outline is offset in the y direction.
    // Extract the y-coordinates of the first M segment (left-side start point).
    // The M point of the low-pressure path should be closer to y=0 center line
    // than the high-pressure M point.
    const lowM = lowObj.geometry.segments[0];
    const highM = highObj.geometry.segments[0];
    expect(lowM.type).toBe('M');
    expect(highM.type).toBe('M');
    if (lowM.type === 'M' && highM.type === 'M') {
      // The offset is half of (width * pressure). For a horizontal line going right,
      // the normal points upward, so the left side M point has y < 0.
      // Low pressure: halfW = 10 * 0.2 / 2 = 1, so y ≈ -1
      // High pressure: halfW = 10 * 1.0 / 2 = 5, so y ≈ -5
      // The high-pressure offset magnitude should be larger
      expect(Math.abs(highM.y)).toBeGreaterThan(Math.abs(lowM.y));
    }
  });
});
