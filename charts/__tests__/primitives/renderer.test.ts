/**
 * Renderer Unit Tests
 *
 * Tests for the canvas renderer, mark rendering, and hit testing.
 * Uses mock canvas context to verify rendering operations.
 */

import {
  CanvasRenderer,
  createCanvasRenderer,
  createHitTester,
  getBoundingBox,
  getMarkCenter,
  GridHitTester,
  parseColor,
  pointInMark,
  renderMark,
  renderMarks,
} from '../../src/primitives/renderer';
import type {
  AnyMark,
  ArcMark,
  PathMark,
  RectMark,
  SymbolMark,
  TextMark,
} from '../../src/primitives/types';

// =============================================================================
// Mock Canvas Context
// =============================================================================

function createMockCanvas(): HTMLCanvasElement {
  const canvas = {
    width: 800,
    height: 600,
    style: { width: '', height: '' },
    getContext: jest.fn(() => createMockContext()),
  };
  return canvas as unknown as HTMLCanvasElement;
}

function createMockContext(): CanvasRenderingContext2D {
  return {
    canvas: { width: 800, height: 600 },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',

    // Methods
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    closePath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    quadraticCurveTo: jest.fn(),
    bezierCurveTo: jest.fn(),
    arc: jest.fn(),
    ellipse: jest.fn(),
    rect: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    fillRect: jest.fn(),
    strokeRect: jest.fn(),
    fillText: jest.fn(),
    strokeText: jest.fn(),
    clearRect: jest.fn(),
    setLineDash: jest.fn(),
    setTransform: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    measureText: jest.fn(() => ({ width: 100 })),
  } as unknown as CanvasRenderingContext2D;
}

// =============================================================================
// Test Data - Using new type structure
// =============================================================================

const rectMark: RectMark = {
  type: 'rect',
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  style: { fill: '#4472C4', stroke: '#264478', strokeWidth: 2 },
  datum: { category: 'A', value: 100 },
};

const arcMark: ArcMark = {
  type: 'arc',
  x: 300,
  y: 300,
  innerRadius: 0,
  outerRadius: 100,
  startAngle: 0,
  endAngle: Math.PI / 2,
  style: { fill: '#ED7D31' },
  datum: { label: 'Slice 1', value: 25 },
};

const doughnutMark: ArcMark = {
  type: 'arc',
  x: 300,
  y: 300,
  innerRadius: 50,
  outerRadius: 100,
  startAngle: 0,
  endAngle: Math.PI,
  style: { fill: '#70AD47' },
};

const symbolMark: SymbolMark = {
  type: 'symbol',
  x: 200,
  y: 200,
  size: 100,
  shape: 'circle',
  style: { fill: '#5B9BD5' },
  datum: { x: 10, y: 20 },
};

const textMark: TextMark = {
  type: 'text',
  x: 100,
  y: 100,
  text: 'Hello World',
  fontSize: 14,
  fontFamily: 'Arial',
  textAlign: 'center',
  textBaseline: 'middle',
  style: { fill: '#000000' },
};

const pathMark: PathMark = {
  type: 'path',
  x: 0,
  y: 0,
  path: 'M0,0 L100,0 L100,100 L0,100 Z',
  style: { stroke: '#000000', strokeWidth: 2 },
};

// =============================================================================
// Canvas Renderer Tests
// =============================================================================

describe('CanvasRenderer', () => {
  describe('constructor', () => {
    it('should create a renderer from canvas element', () => {
      const canvas = createMockCanvas();
      const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1 });

      expect(renderer).toBeInstanceOf(CanvasRenderer);
      expect(renderer.getCanvas()).toBe(canvas);
    });

    it('should throw if canvas context is unavailable', () => {
      const canvas = {
        getContext: jest.fn(() => null),
      } as unknown as HTMLCanvasElement;

      expect(() => new CanvasRenderer(canvas)).toThrow('Failed to get 2D rendering context');
    });
  });

  describe('resize', () => {
    it('should set canvas dimensions with DPR scaling', () => {
      const canvas = createMockCanvas();
      const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 2 });

      renderer.resize(400, 300);

      expect(canvas.width).toBe(800); // 400 * 2
      expect(canvas.height).toBe(600); // 300 * 2
      expect(canvas.style.width).toBe('400px');
      expect(canvas.style.height).toBe('300px');
      expect(renderer.getWidth()).toBe(400);
      expect(renderer.getHeight()).toBe(300);
    });
  });

  describe('render', () => {
    it('should render marks to canvas', () => {
      const canvas = createMockCanvas();
      const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1 });
      const ctx = renderer.getContext();

      renderer.render([rectMark, symbolMark]);

      // Verify context methods were called
      expect(ctx.clearRect).toHaveBeenCalled();
      expect(ctx.save).toHaveBeenCalled();
    });

    it('should clear canvas before rendering', () => {
      const canvas = createMockCanvas();
      const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1 });
      const ctx = renderer.getContext();

      renderer.render([]);

      expect(ctx.clearRect).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should clear the canvas', () => {
      const canvas = createMockCanvas();
      const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1 });
      const ctx = renderer.getContext();

      renderer.clear();

      expect(ctx.clearRect).toHaveBeenCalled();
    });
  });

  describe('factory function', () => {
    it('should create renderer via factory', () => {
      const canvas = createMockCanvas();
      const renderer = createCanvasRenderer(canvas);

      expect(renderer).toBeInstanceOf(CanvasRenderer);
    });
  });
});

// =============================================================================
// Mark Rendering Tests
// =============================================================================

describe('renderMark', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('rect marks', () => {
    it('should render rectangle with fill and stroke', () => {
      renderMark(ctx, rectMark);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it('should render rounded rectangle when cornerRadius is set', () => {
      const roundedRect: RectMark = {
        ...rectMark,
        style: { ...rectMark.style, cornerRadius: 10 },
      };

      renderMark(ctx, roundedRect);

      expect(ctx.quadraticCurveTo).toHaveBeenCalled();
    });
  });

  describe('arc marks', () => {
    it('should render pie slice (innerRadius = 0)', () => {
      renderMark(ctx, arcMark);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.arc).toHaveBeenCalled();
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it('should render doughnut slice (innerRadius > 0)', () => {
      renderMark(ctx, doughnutMark);

      expect(ctx.arc).toHaveBeenCalledTimes(2); // Outer and inner arcs
    });
  });

  describe('symbol marks', () => {
    it('should render circle symbol', () => {
      renderMark(ctx, symbolMark);

      expect(ctx.arc).toHaveBeenCalled();
    });

    it('should render different symbol shapes', () => {
      const shapes: SymbolMark['shape'][] = [
        'circle',
        'square',
        'cross',
        'diamond',
        'triangle-up',
        'triangle-down',
      ];

      for (const shape of shapes) {
        const mark: SymbolMark = { ...symbolMark, shape };
        const localCtx = createMockContext();
        renderMark(localCtx, mark);
        expect(localCtx.save).toHaveBeenCalled();
      }
    });
  });

  describe('text marks', () => {
    it('should render text', () => {
      renderMark(ctx, textMark);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it('should apply rotation when set', () => {
      const rotatedText: TextMark = {
        ...textMark,
        rotation: Math.PI / 4,
      };

      renderMark(ctx, rotatedText);

      expect(ctx.translate).toHaveBeenCalled();
      expect(ctx.rotate).toHaveBeenCalled();
    });
  });

  describe('path marks', () => {
    it('should render path with commands', () => {
      renderMark(ctx, pathMark);

      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.lineTo).toHaveBeenCalled();
    });

    it('should handle bezier curves', () => {
      const curvePath: PathMark = {
        type: 'path',
        x: 0,
        y: 0,
        path: 'M0,0 C50,0 100,50 100,100',
        style: { stroke: '#000' },
      };

      renderMark(ctx, curvePath);

      expect(ctx.bezierCurveTo).toHaveBeenCalled();
    });

    it('should handle quadratic curves', () => {
      const quadPath: PathMark = {
        type: 'path',
        x: 0,
        y: 0,
        path: 'M0,0 Q50,50 100,0',
        style: { stroke: '#000' },
      };

      renderMark(ctx, quadPath);

      expect(ctx.quadraticCurveTo).toHaveBeenCalled();
    });
  });

  describe('renderMarks', () => {
    it('should render multiple marks', () => {
      const marks: AnyMark[] = [rectMark, arcMark, symbolMark];

      renderMarks(ctx, marks);

      // Each mark should trigger save/restore
      expect(ctx.save).toHaveBeenCalledTimes(3);
      expect(ctx.restore).toHaveBeenCalledTimes(3);
    });
  });
});

// =============================================================================
// Bounding Box Tests
// =============================================================================

describe('getBoundingBox', () => {
  it('should return correct bounds for rect mark', () => {
    const bounds = getBoundingBox(rectMark);

    expect(bounds.x).toBe(100);
    expect(bounds.y).toBe(100);
    expect(bounds.width).toBe(200);
    expect(bounds.height).toBe(150);
  });

  it('should return correct bounds for arc mark', () => {
    const bounds = getBoundingBox(arcMark);

    expect(bounds.x).toBe(200); // 300 - 100
    expect(bounds.y).toBe(200); // 300 - 100
    expect(bounds.width).toBe(200); // 100 * 2
    expect(bounds.height).toBe(200); // 100 * 2
  });

  it('should return correct bounds for symbol mark', () => {
    const bounds = getBoundingBox(symbolMark);
    const expectedRadius = Math.sqrt(100 / Math.PI) * 1.5;

    expect(bounds.x).toBeCloseTo(200 - expectedRadius);
    expect(bounds.y).toBeCloseTo(200 - expectedRadius);
    expect(bounds.width).toBeCloseTo(expectedRadius * 2);
    expect(bounds.height).toBeCloseTo(expectedRadius * 2);
  });

  it('should return correct bounds for path mark', () => {
    const bounds = getBoundingBox(pathMark);

    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.width).toBe(100);
    expect(bounds.height).toBe(100);
  });

  it('should return empty bounds for empty path', () => {
    const emptyPath: PathMark = {
      type: 'path',
      x: 50,
      y: 50,
      path: '',
      style: {},
    };
    const bounds = getBoundingBox(emptyPath);

    expect(bounds.x).toBe(50);
    expect(bounds.y).toBe(50);
    expect(bounds.width).toBe(0);
    expect(bounds.height).toBe(0);
  });
});

// =============================================================================
// Mark Center Tests
// =============================================================================

describe('getMarkCenter', () => {
  it('should return center of rect mark', () => {
    const center = getMarkCenter(rectMark);

    expect(center.x).toBe(200); // 100 + 200/2
    expect(center.y).toBe(175); // 100 + 150/2
  });

  it('should return center of symbol mark', () => {
    const center = getMarkCenter(symbolMark);

    expect(center.x).toBe(200);
    expect(center.y).toBe(200);
  });

  it('should return centroid of arc mark', () => {
    const center = getMarkCenter(arcMark);

    // The arc centroid is calculated using the getArcCentroid function
    // which accounts for the angle conversion (0 at top, clockwise)
    expect(center.x).toBeDefined();
    expect(center.y).toBeDefined();
  });

  it('should return text position', () => {
    const center = getMarkCenter(textMark);

    expect(center.x).toBe(100);
    expect(center.y).toBe(100);
  });
});

// =============================================================================
// Point-in-Mark Tests
// =============================================================================

describe('pointInMark', () => {
  describe('rect', () => {
    it('should return true for point inside rect', () => {
      expect(pointInMark(150, 150, rectMark)).toBe(true);
      expect(pointInMark(100, 100, rectMark)).toBe(true); // Edge
      expect(pointInMark(300, 250, rectMark)).toBe(true); // Opposite edge
    });

    it('should return false for point outside rect', () => {
      expect(pointInMark(50, 50, rectMark)).toBe(false);
      expect(pointInMark(350, 150, rectMark)).toBe(false);
    });
  });

  describe('symbol', () => {
    it('should return true for point inside symbol', () => {
      expect(pointInMark(200, 200, symbolMark)).toBe(true);
      expect(pointInMark(202, 202, symbolMark)).toBe(true); // Near center
    });

    it('should return false for point outside symbol', () => {
      expect(pointInMark(100, 100, symbolMark)).toBe(false);
      expect(pointInMark(300, 300, symbolMark)).toBe(false);
    });
  });

  describe('arc', () => {
    it('should return true for point inside arc', () => {
      // The arc uses a different angle system (0 at top, clockwise)
      // We need to test points that are actually inside the arc
      // Arc goes from 0 to PI/2 (top to right quadrant in the new system)
      // At 45 degrees (in the new system), radius 50
      const angle = Math.PI / 8; // 22.5 degrees from top
      // Convert to canvas coordinates (0 at right, counterclockwise)
      const canvasAngle = angle - Math.PI / 2;
      const testX = 300 + Math.cos(canvasAngle) * 50;
      const testY = 300 + Math.sin(canvasAngle) * 50;
      expect(pointInMark(testX, testY, arcMark)).toBe(true);
    });

    it('should return false for point outside radius', () => {
      // Point outside outer radius
      expect(pointInMark(450, 300, arcMark)).toBe(false);
    });

    it('should return false for point inside inner radius', () => {
      // Point at center of doughnut
      expect(pointInMark(300, 300, doughnutMark)).toBe(false);
    });
  });
});

// =============================================================================
// Hit Tester Tests
// =============================================================================

describe('GridHitTester', () => {
  let hitTester: GridHitTester;

  beforeEach(() => {
    hitTester = createHitTester(50);
  });

  describe('build', () => {
    it('should index marks into grid cells', () => {
      hitTester.build([rectMark, symbolMark, arcMark]);

      expect(hitTester.getMarks().length).toBe(3);
      expect(hitTester.getCellCount()).toBeGreaterThan(0);
    });

    it('should handle empty marks array', () => {
      hitTester.build([]);

      expect(hitTester.getMarks().length).toBe(0);
      expect(hitTester.getCellCount()).toBe(0);
    });
  });

  describe('hitTest', () => {
    beforeEach(() => {
      hitTester.build([rectMark, symbolMark, arcMark]);
    });

    it('should find mark at exact point', () => {
      const result = hitTester.hitTest(150, 150);

      expect(result).not.toBeNull();
      expect(result!.mark).toBe(rectMark);
      expect(result!.datum).toEqual({ category: 'A', value: 100 });
    });

    it('should return null when no mark at point', () => {
      const result = hitTester.hitTest(50, 50);

      expect(result).toBeNull();
    });

    it('should find mark within radius', () => {
      // Point near the center of rectMark, within radius search
      // rectMark center is at (200, 175)
      const result = hitTester.hitTest(220, 175, 50);

      // Should find rectMark which is centered near this point
      expect(result).not.toBeNull();
      expect(result!.mark).toBe(rectMark);
    });

    it('should return closest mark when multiple overlap', () => {
      // Create overlapping marks
      const overlappingMarks: AnyMark[] = [
        { type: 'symbol', x: 100, y: 100, size: 400, shape: 'circle', style: { fill: '#000' } },
        { type: 'symbol', x: 100, y: 100, size: 100, shape: 'circle', style: { fill: '#000' } },
      ];
      hitTester.build(overlappingMarks);

      const result = hitTester.hitTest(100, 100);

      expect(result).not.toBeNull();
      expect(result!.distance).toBe(0);
    });
  });

  describe('hitTestAll', () => {
    beforeEach(() => {
      hitTester.build([rectMark, symbolMark, arcMark]);
    });

    it('should find all marks at point', () => {
      // Create overlapping marks
      const overlapping: AnyMark[] = [
        { type: 'rect', x: 0, y: 0, width: 200, height: 200, style: { fill: '#000' } },
        { type: 'rect', x: 50, y: 50, width: 100, height: 100, style: { fill: '#000' } },
      ];
      hitTester.build(overlapping);

      const results = hitTester.hitTestAll(75, 75);

      expect(results.length).toBe(2);
    });

    it('should find all marks within radius', () => {
      const results = hitTester.hitTestAll(200, 200, 100);

      expect(results.length).toBeGreaterThan(0);
    });

    it('should return empty array when no marks found', () => {
      const results = hitTester.hitTestAll(1000, 1000);

      expect(results).toEqual([]);
    });

    it('should sort results by distance', () => {
      const marks: AnyMark[] = [
        { type: 'symbol', x: 100, y: 100, size: 100, shape: 'circle', style: { fill: '#000' } },
        { type: 'symbol', x: 50, y: 50, size: 100, shape: 'circle', style: { fill: '#000' } },
        { type: 'symbol', x: 150, y: 150, size: 100, shape: 'circle', style: { fill: '#000' } },
      ];
      hitTester.build(marks);

      const results = hitTester.hitTestAll(100, 100, 200);

      expect(results.length).toBeGreaterThan(0);
      // First result should have smallest distance
      for (let i = 1; i < results.length; i++) {
        expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
      }
    });
  });

  describe('clear', () => {
    it('should clear all indexed marks', () => {
      hitTester.build([rectMark, symbolMark]);
      hitTester.clear();

      expect(hitTester.getMarks().length).toBe(0);
      expect(hitTester.getCellCount()).toBe(0);
    });
  });

  describe('getBounds', () => {
    it('should return overall bounds of all marks', () => {
      hitTester.build([rectMark, symbolMark]);
      const bounds = hitTester.getBounds();

      expect(bounds.x).toBeLessThanOrEqual(100);
      expect(bounds.y).toBeLessThanOrEqual(100);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
    });
  });

  describe('factory function', () => {
    it('should create hit tester with custom cell size', () => {
      const tester = createHitTester(100);
      expect(tester.getCellSize()).toBe(100);
    });

    it('should create hit tester with default cell size', () => {
      const tester = createHitTester();
      expect(tester.getCellSize()).toBe(50);
    });
  });
});

// =============================================================================
// Style Application Tests
// =============================================================================

describe('style application', () => {
  it('should apply opacity', () => {
    const ctx = createMockContext();
    const mark: RectMark = {
      ...rectMark,
      style: { ...rectMark.style, opacity: 0.5 },
    };

    renderMark(ctx, mark);

    // Opacity should be set before fill
    expect(ctx.save).toHaveBeenCalled();
  });

  it('should handle marks without style', () => {
    const ctx = createMockContext();
    const mark: RectMark = {
      type: 'rect',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      style: {},
    };

    // Should not throw
    expect(() => renderMark(ctx, mark)).not.toThrow();
  });
});

// =============================================================================
// WebGL parseColor tests
//
// parseColor is now exported from webgl-renderer.ts and re-exported through
// the renderer barrel. We import it directly and test the real implementation.
// =============================================================================

describe('WebGL parseColor coverage gaps', () => {
  // ---- Existing format tests (these PASS, confirming baseline works) --------

  describe('hex colors (baseline - should pass)', () => {
    it('should parse 6-digit hex', () => {
      expect(parseColor('#ff0000')).toEqual([1, 0, 0, 1.0]);
    });

    it('should parse 3-digit hex', () => {
      expect(parseColor('#f00')).toEqual([1, 0, 0, 1.0]);
    });

    it('should parse 8-digit hex with alpha', () => {
      expect(parseColor('#ff000080')).toEqual([1, 0, 0, 128 / 255]);
    });

    it('should parse rgba()', () => {
      expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual([1, 0, 0, 0.5]);
    });

    it('should parse rgb()', () => {
      expect(parseColor('rgb(255, 128, 0)')).toEqual([1, 128 / 255, 0, 1.0]);
    });

    it('should return default gray for undefined', () => {
      expect(parseColor(undefined)).toEqual([0.5, 0.5, 0.5, 1.0]);
    });
  });

  // ---- BUG: Named CSS colors silently return default gray ----

  describe('named CSS colors', () => {
    it('should parse "red" to [1, 0, 0, 1]', () => {
      const result = parseColor('red');
      expect(result).toEqual([1, 0, 0, 1.0]);
    });

    it('should parse "steelblue" to correct RGB', () => {
      const result = parseColor('steelblue');
      // steelblue = #4682B4 = rgb(70, 130, 180)
      expect(result).toEqual([70 / 255, 130 / 255, 180 / 255, 1.0]);
    });

    it('should parse "transparent" to [0, 0, 0, 0]', () => {
      const result = parseColor('transparent');
      expect(result).toEqual([0, 0, 0, 0]);
    });
  });

  // ---- BUG: rgb() with out-of-range values are not clamped ----

  describe('rgb() out-of-range values', () => {
    it('should clamp rgb(300, 0, 256) to valid 0-1 range', () => {
      const result = parseColor('rgb(300, 0, 256)');
      // 300/255 = 1.176... clamped to 1, 256/255 = 1.004... clamped to 1
      expect(result[0]).toBeLessThanOrEqual(1.0);
      expect(result[0]).toBeGreaterThanOrEqual(0.0);
      expect(result[2]).toBeLessThanOrEqual(1.0);
      expect(result[2]).toBeGreaterThanOrEqual(0.0);
    });
  });

  // ---- BUG: Empty string falls through to default gray (arguably OK, but should be explicit) ----

  describe('empty string input', () => {
    it('should return a sensible default for empty string — passes but documents the behavior', () => {
      const result = parseColor('');
      // Empty string is falsy in JS, so !color is true, returns default gray.
      // This is arguably acceptable behavior but should be documented.
      expect(result).toEqual([0.5, 0.5, 0.5, 1.0]);
    });
  });

  // ---- BUG: "#" with no hex digits produces NaN ----

  describe('malformed hex input', () => {
    it('should return default gray for "#" with no hex digits', () => {
      const result = parseColor('#');
      expect(result).toEqual([0.5, 0.5, 0.5, 1.0]);
      result.forEach((v) => {
        expect(v).not.toBeNaN();
      });
    });

    it('should return default gray for "#zzz" (invalid hex chars) instead of NaN', () => {
      const result = parseColor('#zzz');
      // Should fall back to default gray, not propagate NaN
      result.forEach((v) => {
        expect(v).not.toBeNaN();
      });
    });
  });
});
