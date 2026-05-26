/**
 * SVG Orchestrator Tests
 *
 * Tests for renderDrawingObjectToSVG — the top-level SVG string renderer.
 */
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type { Path } from '@mog-sdk/contracts/geometry';
import { renderDrawingObjectToSVG } from '../../src/renderer/svg';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSimplePath(): Path {
  return {
    segments: [
      { type: 'M' as const, x: 0, y: 0 },
      { type: 'L' as const, x: 100, y: 0 },
      { type: 'L' as const, x: 100, y: 50 },
      { type: 'L' as const, x: 0, y: 50 },
      { type: 'Z' as const },
    ],
    closed: true,
  };
}

function makeSimpleObject(overrides?: Partial<DrawingObject>): DrawingObject {
  return {
    geometry: makeSimplePath(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('renderDrawingObjectToSVG', () => {
  test('simple object returns valid SVG with <path> element', () => {
    const obj = makeSimpleObject();
    const svg = renderDrawingObjectToSVG(obj);

    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<path');
    expect(svg).toContain('</svg>');
  });

  test('SVG has correct viewBox from geometry bounds', () => {
    const obj = makeSimpleObject();
    const svg = renderDrawingObjectToSVG(obj);

    // Path goes from (0,0) to (100,50), so viewBox should be "0 0 100 50"
    expect(svg).toContain('viewBox="0 0 100 50"');
  });

  test('options.width and height override dimensions', () => {
    const obj = makeSimpleObject();
    const svg = renderDrawingObjectToSVG(obj, { width: 200, height: 100 });

    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="100"');
    // viewBox still uses geometry bounds
    expect(svg).toContain('viewBox="0 0 100 50"');
  });

  test('viewBox has minimum 1px dimensions for vertical line (zero width)', () => {
    // A vertical line has width 0
    const verticalLine: DrawingObject = {
      geometry: {
        segments: [
          { type: 'M' as const, x: 50, y: 0 },
          { type: 'L' as const, x: 50, y: 100 },
        ],
        closed: false,
      },
    };
    const svg = renderDrawingObjectToSVG(verticalLine);

    // viewBox width should be at least 1, not 0
    // bounds: x=50, y=0, width=0->1, height=100
    expect(svg).toContain('viewBox="50 0 1 100"');
    expect(svg).toContain('width="1"');
    expect(svg).toContain('height="100"');
  });

  test('viewBox has minimum 1px dimensions for horizontal line (zero height)', () => {
    const horizontalLine: DrawingObject = {
      geometry: {
        segments: [
          { type: 'M' as const, x: 0, y: 50 },
          { type: 'L' as const, x: 100, y: 50 },
        ],
        closed: false,
      },
    };
    const svg = renderDrawingObjectToSVG(horizontalLine);

    // viewBox height should be at least 1, not 0
    expect(svg).toContain('viewBox="0 50 100 1"');
    expect(svg).toContain('height="1"');
  });

  test('viewBox has minimum 1px for both dimensions for a point', () => {
    const point: DrawingObject = {
      geometry: {
        segments: [{ type: 'M' as const, x: 25, y: 75 }],
        closed: false,
      },
    };
    const svg = renderDrawingObjectToSVG(point);

    // Both width and height should be at least 1
    expect(svg).toContain('viewBox="25 75 1 1"');
    expect(svg).toContain('width="1"');
    expect(svg).toContain('height="1"');
  });

  test('explicit options override minimum dimension fallback', () => {
    // Vertical line with zero width, but explicit width option given
    const verticalLine: DrawingObject = {
      geometry: {
        segments: [
          { type: 'M' as const, x: 50, y: 0 },
          { type: 'L' as const, x: 50, y: 100 },
        ],
        closed: false,
      },
    };
    const svg = renderDrawingObjectToSVG(verticalLine, { width: 200, height: 300 });

    // Options should override the element dimensions
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="300"');
    // viewBox still uses clamped bounds
    expect(svg).toContain('viewBox="50 0 1 100"');
  });

  test('object with solid fill sets fill attribute', () => {
    const obj = makeSimpleObject({
      fill: { type: 'solid', color: '#ff0000' },
    });
    const svg = renderDrawingObjectToSVG(obj);

    expect(svg).toContain('fill="#ff0000"');
  });

  test('object with no fill sets fill="none"', () => {
    const obj = makeSimpleObject();
    const svg = renderDrawingObjectToSVG(obj);

    expect(svg).toContain('fill="none"');
  });

  test('object with stroke sets stroke attributes', () => {
    const obj = makeSimpleObject({
      stroke: { color: '#0000ff', width: 2 },
    });
    const svg = renderDrawingObjectToSVG(obj);

    expect(svg).toContain('stroke="#0000ff"');
    expect(svg).toContain('stroke-width="2"');
  });

  test('object with no stroke sets stroke="none"', () => {
    const obj = makeSimpleObject();
    const svg = renderDrawingObjectToSVG(obj);

    expect(svg).toContain('stroke="none"');
  });

  test('object with linear-gradient fill generates <defs> with gradient', () => {
    const obj = makeSimpleObject({
      fill: {
        type: 'linear-gradient',
        angle: 90,
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
      },
    });
    const svg = renderDrawingObjectToSVG(obj);

    expect(svg).toContain('<defs>');
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('url(#');
  });

  test('object with children generates <g> groups', () => {
    const child = makeSimpleObject();
    const obj = makeSimpleObject({ children: [child] });
    const svg = renderDrawingObjectToSVG(obj);

    expect(svg).toContain('<g');
    expect(svg).toContain('</g>');
    // Should have at least 2 <path elements (parent + child)
    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(2);
  });

  test('object with transform generates transform attribute', () => {
    const obj = makeSimpleObject({
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
    });
    const svg = renderDrawingObjectToSVG(obj);

    expect(svg).toContain('transform="matrix(1,0,0,1,10,20)"');
  });

  test('object with effects generates filter reference', () => {
    const obj = makeSimpleObject({
      effects: {
        outerShadow: [
          {
            blurRadius: 50800,
            distance: 38100,
            direction: 45,
            color: '#000000',
            opacity: 0.4,
          },
        ],
      },
    });
    const svg = renderDrawingObjectToSVG(obj);

    expect(svg).toContain('<filter');
    expect(svg).toContain('filter="url(#');
  });

  test('escapes special XML characters in attributes', () => {
    // Path with specific coords that could generate special chars
    const obj = makeSimpleObject({
      fill: { type: 'solid', color: '#ff0000' },
    });
    const svg = renderDrawingObjectToSVG(obj);

    // Should not contain unescaped quotes within attribute values
    // The SVG should be valid XML
    expect(svg).not.toContain('""');
  });

  test('nested children with transforms generates nested groups', () => {
    const grandchild = makeSimpleObject();
    const child = makeSimpleObject({
      children: [grandchild],
      transform: { a: 2, b: 0, c: 0, d: 2, tx: 0, ty: 0 },
    });
    const obj = makeSimpleObject({
      children: [child],
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 5 },
    });
    const svg = renderDrawingObjectToSVG(obj);

    // Parent has children -> generates <g> with transform
    expect(svg).toContain('<g');
    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(3); // parent + child + grandchild
  });

  // ─── Clip Path Tests ────────────────────────────────────────────────────────

  test('object with clip produces <clipPath> in <defs> and clip-path attribute', () => {
    const clipPath = makeSimplePath();
    const obj = makeSimpleObject({ clip: clipPath });
    const svg = renderDrawingObjectToSVG(obj);

    // Should have a <clipPath> element in <defs>
    expect(svg).toContain('<defs>');
    expect(svg).toContain('<clipPath');
    expect(svg).toMatch(/<clipPath id="clip_\d+">/);
    expect(svg).toContain('</clipPath>');

    // Should have clip-path attribute referencing the clipPath def
    expect(svg).toMatch(/clip-path="url\(#clip_\d+\)"/);
  });

  test('object without clip produces no clip-path elements', () => {
    const obj = makeSimpleObject({
      fill: { type: 'solid', color: '#ff0000' },
    });
    const svg = renderDrawingObjectToSVG(obj);

    expect(svg).not.toContain('<clipPath');
    expect(svg).not.toContain('clip-path=');
  });

  test('object with children and clip applies clip-path to the group', () => {
    const clipPath: Path = {
      segments: [
        { type: 'M' as const, x: 10, y: 10 },
        { type: 'L' as const, x: 90, y: 10 },
        { type: 'L' as const, x: 90, y: 40 },
        { type: 'L' as const, x: 10, y: 40 },
        { type: 'Z' as const },
      ],
      closed: true,
    };
    const child = makeSimpleObject();
    const obj = makeSimpleObject({ clip: clipPath, children: [child] });
    const svg = renderDrawingObjectToSVG(obj);

    // The <g> element should have the clip-path attribute
    expect(svg).toMatch(/<g[^>]*clip-path="url\(#clip_\d+\)"/);

    // <clipPath> should be in <defs>
    expect(svg).toContain('<defs>');
    expect(svg).toContain('<clipPath');
  });

  test('clip path has correct path data inside <clipPath> def', () => {
    const clipPath: Path = {
      segments: [
        { type: 'M' as const, x: 5, y: 5 },
        { type: 'L' as const, x: 50, y: 5 },
        { type: 'L' as const, x: 50, y: 25 },
        { type: 'Z' as const },
      ],
      closed: true,
    };
    const obj = makeSimpleObject({ clip: clipPath });
    const svg = renderDrawingObjectToSVG(obj);

    // The <clipPath> def should contain a <path> with the clip geometry
    expect(svg).toMatch(/<clipPath id="clip_\d+"><path d="[^"]*"\/><\/clipPath>/);

    // The clip path data should be inside the <clipPath> element
    const clipPathMatch = svg.match(/<clipPath[^>]*>(.*?)<\/clipPath>/);
    expect(clipPathMatch).not.toBeNull();
    expect(clipPathMatch![1]).toContain('<path');
    expect(clipPathMatch![1]).toContain('d="');
  });
});
