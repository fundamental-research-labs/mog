/**
 * Shape Rendering Pipeline Integration Tests
 *
 * End-to-end: shape-engine -> DrawingObject -> drawing-engine/renderer -> SVG output.
 * Uses REAL implementations, NOT mocks.
 */
import {
  createDrawingObject,
  getRegisteredShapeTypes,
  type ShapeVisualProperties,
} from '@mog/shape-engine';
import { buildHitTestPath, renderDrawingObjectToSVG } from '../../src';

// ─── Browser API Mocks (needed for hit-test Path2D / DOMMatrix) ─────────────

class MockPath2D {
  addPathCalls: Array<{ path: unknown; matrix?: unknown }> = [];
  constructor(public svgString?: string) {}
  addPath(path: unknown, matrix?: unknown) {
    this.addPathCalls.push({ path, matrix });
  }
}
(globalThis as any).Path2D = MockPath2D;

class MockDOMMatrix {
  constructor(public values?: number[]) {}
}
(globalThis as any).DOMMatrix = MockDOMMatrix;

// =============================================================================
// 1. All registered shapes produce valid SVG
// =============================================================================

describe('Shape Pipeline Integration', () => {
  const registeredTypes = getRegisteredShapeTypes();

  it('has registered shapes available', () => {
    expect(registeredTypes.length).toBeGreaterThan(0);
  });

  it.each(registeredTypes)('shape "%s" produces valid SVG', (shapeType) => {
    const obj = createDrawingObject(shapeType, 100, 80);
    const svg = renderDrawingObjectToSVG(obj, { width: 100, height: 80 });
    expect(svg).toBeTruthy();
    expect(typeof svg).toBe('string');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  // ===========================================================================
  // 2. Shape with fill produces filled SVG
  // ===========================================================================

  it('shape with solid fill contains fill color in SVG', () => {
    const visual: ShapeVisualProperties = {
      fill: { type: 'solid', color: '#FF0000' },
    };
    const obj = createDrawingObject('rect', 100, 80, undefined, visual);
    const svg = renderDrawingObjectToSVG(obj, { width: 100, height: 80 });

    expect(svg).toContain('#FF0000');
  });

  // ===========================================================================
  // 3. Shape with stroke produces stroked SVG
  // ===========================================================================

  it('shape with stroke contains stroke attributes in SVG', () => {
    const visual: ShapeVisualProperties = {
      stroke: { color: '#00FF00', width: 2 },
    };
    const obj = createDrawingObject('rect', 100, 80, undefined, visual);
    const svg = renderDrawingObjectToSVG(obj, { width: 100, height: 80 });

    expect(svg).toContain('#00FF00');
    expect(svg).toContain('stroke=');
  });

  // ===========================================================================
  // 4. Shape with text produces text in DrawingObject
  // ===========================================================================

  it('shape with text produces text body in DrawingObject', () => {
    const visual: ShapeVisualProperties = {
      text: { content: 'Hello' },
    };
    const obj = createDrawingObject('rect', 100, 80, undefined, visual);

    expect(obj.text).toBeDefined();
    expect(obj.text!.paragraphs).toBeDefined();
    expect(obj.text!.paragraphs.length).toBeGreaterThan(0);
    expect(obj.text!.paragraphs[0].runs.length).toBeGreaterThan(0);
    expect(obj.text!.paragraphs[0].runs[0].text).toBe('Hello');
  });

  // ===========================================================================
  // 5. Zero-dimension shape doesn't crash
  // ===========================================================================

  it('zero-dimension shape renders without throwing', () => {
    expect(() => {
      const obj = createDrawingObject('rect', 0, 0);
      renderDrawingObjectToSVG(obj);
    }).not.toThrow();
  });

  // ===========================================================================
  // 6. Adjustments modify geometry
  // ===========================================================================

  it('different adjustment values produce different paths for roundRect', () => {
    // Only test if roundRect is registered
    if (!registeredTypes.includes('roundRect')) {
      // Skip — shape not registered
      return;
    }

    // OOXML adj parameter controls corner radius (in 60000ths of shape size)
    const obj1 = createDrawingObject('roundRect', 100, 80, [{ name: 'adj', value: 5000 }]);
    const obj2 = createDrawingObject('roundRect', 100, 80, [{ name: 'adj', value: 40000 }]);

    const svg1 = renderDrawingObjectToSVG(obj1, { width: 100, height: 80 });
    const svg2 = renderDrawingObjectToSVG(obj2, { width: 100, height: 80 });

    // The paths should differ because different adjustments produce different geometry
    expect(svg1).not.toBe(svg2);
  });

  // ===========================================================================
  // 7. Hit test path can be built for all shapes
  // ===========================================================================

  it.each(registeredTypes)('buildHitTestPath returns truthy for shape "%s"', (shapeType) => {
    const obj = createDrawingObject(shapeType, 100, 80);
    const path = buildHitTestPath(obj);
    expect(path).toBeTruthy();
  });
});
