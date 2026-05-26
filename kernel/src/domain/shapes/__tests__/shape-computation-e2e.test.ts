/**
 * Shape Computation End-to-End Integration Tests
 *
 * These tests verify the full pipeline:
 *   computeShape() -> shape-engine -> DrawingObject -> drawing-engine/SVG
 *   createInkStroke() -> ink-engine -> DrawingObject -> drawing-engine/SVG
 *
 * Uses REAL engine implementations (no mocks). The standalone functions
 * replace the former FloatingObjectBridge class.
 */

import { renderDrawingObjectToSVG } from '@mog/drawing-engine';
import type { StrokeId } from '@mog-sdk/contracts/ink';

import { clearShapeCache, computeShape } from '../shape-computation';
import { computeInkDrawingObject, createInkStroke } from '../../drawing/ink-computation';

// =============================================================================
// Sample data
// =============================================================================

const samplePoints = [
  { x: 0, y: 0, pressure: 0.5, timestamp: 0 },
  { x: 10, y: 10, pressure: 0.7, timestamp: 16 },
  { x: 20, y: 5, pressure: 0.6, timestamp: 32 },
  { x: 30, y: 15, pressure: 0.5, timestamp: 48 },
  { x: 40, y: 10, pressure: 0.4, timestamp: 64 },
];

// =============================================================================
// Tests
// =============================================================================

describe('Shape Computation E2E', () => {
  afterEach(() => {
    clearShapeCache();
  });

  // ---------------------------------------------------------------------------
  // Test 1: computeShape -> DrawingObject -> SVG
  // ---------------------------------------------------------------------------

  it('should compute a rect shape as DrawingObject and render to valid SVG', () => {
    const result = computeShape('rect', 200, 100);

    // Must produce a DrawingObject with geometry
    expect(result).not.toBeNull();
    expect(result!.geometry).toBeDefined();
    expect(result!.geometry.segments).toBeDefined();
    expect(result!.geometry.segments.length).toBeGreaterThan(0);

    // Render to SVG
    const svg = renderDrawingObjectToSVG(result!, { width: 200, height: 100 });
    expect(typeof svg).toBe('string');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<path');
  });

  // ---------------------------------------------------------------------------
  // Test 2: computeShape with fill -> colored SVG
  // ---------------------------------------------------------------------------

  it('should produce SVG containing the fill color when fill is specified', () => {
    const result = computeShape('rect', 200, 100, undefined, {
      fill: { color: '#FF0000' },
    });

    expect(result).not.toBeNull();
    expect(result!.fill).toBeDefined();

    const svg = renderDrawingObjectToSVG(result!, { width: 200, height: 100 });
    expect(svg).toContain('<svg');
    // The fill color should appear somewhere in the SVG output
    expect(svg).toContain('#FF0000');
  });

  // ---------------------------------------------------------------------------
  // Test 3: roundRect has different geometry than rect
  // ---------------------------------------------------------------------------

  it('should produce different geometry for roundRect vs rect', () => {
    const rectResult = computeShape('rect', 200, 100);
    const roundResult = computeShape('roundRect', 200, 100);

    expect(rectResult).not.toBeNull();
    expect(roundResult).not.toBeNull();

    // Both should have geometry
    expect(rectResult!.geometry.segments.length).toBeGreaterThan(0);
    expect(roundResult!.geometry.segments.length).toBeGreaterThan(0);

    // The segments should differ (roundRect has curves, rect has only lines)
    const rectSegmentTypes = rectResult!.geometry.segments.map((s) => s.type);
    const roundSegmentTypes = roundResult!.geometry.segments.map((s) => s.type);

    // They should not be identical because roundRect uses curves
    const rectHasCurves = rectSegmentTypes.some((t) => t === 'C' || t === 'Q');
    const roundHasCurves = roundSegmentTypes.some((t) => t === 'C' || t === 'Q');

    // roundRect should have curves; a plain rect should not (or at least they differ)
    expect(
      rectHasCurves !== roundHasCurves || rectSegmentTypes.length !== roundSegmentTypes.length,
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 4: computeShape with adjustments
  // ---------------------------------------------------------------------------

  it('should produce a valid DrawingObject for roundRect with custom adjustments', () => {
    const result = computeShape('roundRect', 200, 100, { adj: 25000 });

    expect(result).not.toBeNull();
    expect(result!.geometry).toBeDefined();
    expect(result!.geometry.segments.length).toBeGreaterThan(0);

    // Should be renderable to SVG without errors
    const svg = renderDrawingObjectToSVG(result!, { width: 200, height: 100 });
    expect(svg).toContain('<svg');
  });

  // ---------------------------------------------------------------------------
  // Test 5: Invalid shape type returns null
  // ---------------------------------------------------------------------------

  it('should return null for an invalid shape type', () => {
    const result = computeShape('nonexistent', 100, 100);
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 6: Caching works
  // ---------------------------------------------------------------------------

  it('should return the same reference on cache hit and different results for different params', () => {
    const result1 = computeShape('rect', 200, 100);
    const result2 = computeShape('rect', 200, 100);

    // Same reference = cache hit
    expect(result1).toBe(result2);

    // Different params should produce different reference
    const result3 = computeShape('rect', 300, 150);
    expect(result3).not.toBe(result1);
    expect(result3).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 7: computeInkDrawingObject -> valid DrawingObject
  // ---------------------------------------------------------------------------

  it('should create an ink stroke and compute a valid DrawingObject from it', () => {
    const stroke = createInkStroke(samplePoints, {
      color: '#000000',
      width: 2,
      id: 'test-ink-1' as StrokeId,
    });

    expect(stroke).toBeDefined();
    expect(stroke.id).toBe('test-ink-1');

    const drawingObj = computeInkDrawingObject(stroke);
    expect(drawingObj).toBeDefined();
    expect(drawingObj.geometry).toBeDefined();
    expect(drawingObj.geometry.segments.length).toBeGreaterThan(0);
    expect(drawingObj.fill).toBeDefined();
    expect(drawingObj.fill!.type).toBe('solid');

    if (drawingObj.fill!.type === 'solid') {
      expect(drawingObj.fill!.color).toBe('#000000');
    }
  });

  // ---------------------------------------------------------------------------
  // Test 8: Ink DrawingObject -> SVG
  // ---------------------------------------------------------------------------

  it('should render an ink DrawingObject to a non-empty SVG string', () => {
    const stroke = createInkStroke(samplePoints, {
      color: '#0000FF',
      width: 3,
      id: 'test-ink-2' as StrokeId,
    });

    const drawingObj = computeInkDrawingObject(stroke);
    const svg = renderDrawingObjectToSVG(drawingObj);

    expect(typeof svg).toBe('string');
    expect(svg.length).toBeGreaterThan(0);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<path');
    // The stroke's fill color should appear in the SVG
    expect(svg).toContain('#0000FF');
  });
});
