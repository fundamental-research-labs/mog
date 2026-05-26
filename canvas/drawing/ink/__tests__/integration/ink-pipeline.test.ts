/**
 * Ink Rendering Pipeline Integration Tests
 *
 * End-to-end: createStroke() -> strokeToDrawingObject() -> renderDrawingObjectToSVG().
 * Uses REAL implementations, NOT mocks.
 */
import { renderDrawingObjectToSVG } from '@mog/drawing-engine';
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type { StrokeId } from '@mog-sdk/contracts/ink';
import type { StrokePoint } from '../../src';
import { createStroke, strokeToDrawingObject } from '../../src';

/** Cast a plain string to StrokeId for testing. */
const testId = (id: string) => id as StrokeId;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create an array of stroke points along a diagonal line.
 */
function createDiagonalPoints(count: number, pressure = 0.5): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: i * 10,
      y: i * 10,
      pressure,
      timestamp: i * 16, // ~60fps
    });
  }
  return points;
}

// =============================================================================
// Tests
// =============================================================================

describe('Ink Pipeline Integration', () => {
  // ===========================================================================
  // 1. Basic stroke produces valid SVG
  // ===========================================================================

  it('basic stroke with 5+ points produces valid SVG', () => {
    const points = createDiagonalPoints(6);
    const stroke = createStroke(points, {
      id: testId('stroke-1'),
      color: '#000000',
      width: 4,
    });

    const drawingObj = strokeToDrawingObject(stroke);
    const svg = renderDrawingObjectToSVG(drawingObj as DrawingObject);

    expect(svg).toBeTruthy();
    expect(typeof svg).toBe('string');
    expect(svg.startsWith('<svg')).toBe(true);

    // Verify the stroke color '#000000' appears as the fill in SVG output
    expect(svg).toContain('#000000');
    // Verify SVG has a path element
    expect(svg).toContain('<path');
    // The geometry is filled, not stroked, so stroke should be 'none'
    expect(svg).toContain('stroke="none"');
  });

  // ===========================================================================
  // 2. Stroke color preserved
  // ===========================================================================

  it('stroke color is preserved in DrawingObject fill and rendered SVG', () => {
    const points = createDiagonalPoints(5);
    const stroke = createStroke(points, {
      id: testId('stroke-2'),
      color: '#FF0000',
      width: 3,
    });

    const drawingObj = strokeToDrawingObject(stroke);

    expect(drawingObj.fill).toBeDefined();
    expect((drawingObj.fill as { color: string }).color).toBe('#FF0000');

    // Verify the color appears in the rendered SVG output
    const svg = renderDrawingObjectToSVG(drawingObj as DrawingObject);
    expect(svg).toContain('#FF0000');
    expect(svg).toContain('fill="#FF0000"');
  });

  // ===========================================================================
  // 3. Stroke opacity preserved
  // ===========================================================================

  it('stroke opacity is preserved in DrawingObject fill and rendered SVG', () => {
    const points = createDiagonalPoints(5);
    const stroke = createStroke(points, {
      id: testId('stroke-3'),
      color: '#000000',
      width: 3,
      opacity: 0.5,
    });

    const drawingObj = strokeToDrawingObject(stroke);

    expect(drawingObj.fill).toBeDefined();
    expect((drawingObj.fill as { opacity: number }).opacity).toBe(0.5);

    // Verify the opacity appears in the rendered SVG output
    const svg = renderDrawingObjectToSVG(drawingObj as DrawingObject);
    expect(svg).toContain('fill-opacity="0.5"');
  });

  // ===========================================================================
  // 4. Stroke geometry is filled (not stroked)
  // ===========================================================================

  it('stroke DrawingObject has fill but no stroke, verified in SVG', () => {
    const points = createDiagonalPoints(5);
    const stroke = createStroke(points, {
      id: testId('stroke-4'),
      color: '#0000FF',
      width: 4,
    });

    const drawingObj = strokeToDrawingObject(stroke);

    // The path IS the variable-width outline, so it uses fill, not stroke
    expect(drawingObj.fill).toBeDefined();
    expect(drawingObj.stroke).toBeUndefined();

    // Verify in the rendered SVG: fill is present with correct color, stroke is 'none'
    const svg = renderDrawingObjectToSVG(drawingObj as DrawingObject);
    expect(svg).toContain('fill="#0000FF"');
    expect(svg).toContain('stroke="none"');
  });

  // ===========================================================================
  // 5. Pressure variation produces geometry
  // ===========================================================================

  it('pressure variation produces geometry with segments', () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0.2, timestamp: 0 },
      { x: 10, y: 5, pressure: 0.5, timestamp: 16 },
      { x: 20, y: 10, pressure: 0.8, timestamp: 32 },
      { x: 30, y: 15, pressure: 1.0, timestamp: 48 },
      { x: 40, y: 10, pressure: 0.6, timestamp: 64 },
      { x: 50, y: 5, pressure: 0.3, timestamp: 80 },
    ];

    const stroke = createStroke(points, {
      id: testId('stroke-5'),
      color: '#000000',
      width: 6,
    });

    const drawingObj = strokeToDrawingObject(stroke);

    expect(drawingObj.geometry).toBeDefined();
    expect(drawingObj.geometry.segments).toBeDefined();
    expect(drawingObj.geometry.segments.length).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 6. Single-point stroke doesn't crash
  // ===========================================================================

  it('single-point stroke converts and renders without throwing', () => {
    expect(() => {
      const points: StrokePoint[] = [{ x: 50, y: 50, pressure: 0.5, timestamp: 0 }];

      const stroke = createStroke(points, {
        id: testId('stroke-6'),
        color: '#000000',
        width: 4,
      });

      const drawingObj = strokeToDrawingObject(stroke);
      renderDrawingObjectToSVG(drawingObj as DrawingObject);
    }).not.toThrow();
  });
});
