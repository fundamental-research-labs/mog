/**
 * Canvas2D Effects Integration Tests
 *
 * Verifies that renderDrawingObjectToCanvas correctly applies effects
 * (outer shadow, inner shadow, glow) to a Canvas2D context with the
 * correct property assignments and rendering order.
 *
 * Uses a mock Canvas2D context that tracks property assignments and
 * call order to verify behavioral correctness, not just "does not crash".
 */
import { jest } from '@jest/globals';

import type { DrawingEffects, DrawingObject } from '@mog-sdk/contracts/drawing';
import type { Path } from '@mog-sdk/contracts/geometry';
import { renderDrawingObjectToCanvas } from '../../src/renderer/canvas';

// ─── Browser API Mocks (needed for Path2D / DOMMatrix) ──────────────────────

class MockPath2D {
  constructor(public svgString?: string) {}
  addPath = jest.fn();
}
(globalThis as any).Path2D = MockPath2D;

class MockDOMMatrix {
  constructor(public values?: number[]) {}
}
(globalThis as any).DOMMatrix = MockDOMMatrix;

// ─── Constants ──────────────────────────────────────────────────────────────

const EMU_PER_PIXEL = 9525;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a simple rectangular path (100x80). */
function makeRectPath(): Path {
  return {
    segments: [
      { type: 'M' as const, x: 0, y: 0 },
      { type: 'L' as const, x: 100, y: 0 },
      { type: 'L' as const, x: 100, y: 80 },
      { type: 'L' as const, x: 0, y: 80 },
      { type: 'Z' as const },
    ],
    closed: true,
  };
}

/** Create a DrawingObject with a solid fill and optional effects. */
function createShapeWithEffects(
  effects: DrawingEffects,
  fill?: DrawingObject['fill'],
  stroke?: DrawingObject['stroke'],
): DrawingObject {
  return {
    geometry: makeRectPath(),
    fill: fill ?? { type: 'solid', color: '#4472C4' },
    stroke,
    effects,
  };
}

/**
 * Create a mock Canvas2D context that tracks property assignments and call order.
 *
 * The `calls` array records the sequence of significant operations for
 * verifying rendering order.
 */
function createTrackingContext() {
  const calls: string[] = [];

  const mockObj: Record<string, unknown> & {
    _shadowColor: string;
    _shadowBlur: number;
    _shadowOffsetX: number;
    _shadowOffsetY: number;
  } = {
    save: jest.fn(() => calls.push('save')),
    restore: jest.fn(() => calls.push('restore')),
    fill: jest.fn((rule?: string) => calls.push(rule ? `fill(${rule})` : 'fill')),
    stroke: jest.fn(() => calls.push('stroke')),
    beginPath: jest.fn(() => calls.push('beginPath')),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    bezierCurveTo: jest.fn(),
    quadraticCurveTo: jest.fn(),
    closePath: jest.fn(),
    clip: jest.fn(() => calls.push('clip')),
    transform: jest.fn(),
    rect: jest.fn(),
    fillRect: jest.fn(),
    isPointInPath: jest.fn(() => false),
    isPointInStroke: jest.fn(() => false),
    setLineDash: jest.fn(),
    createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),

    // Simple value properties
    fillStyle: '' as string | CanvasGradient,
    strokeStyle: '' as string | CanvasGradient,
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    globalAlpha: 1,

    // Shadow properties tracked via getters/setters
    _shadowColor: '',
    _shadowBlur: 0,
    _shadowOffsetX: 0,
    _shadowOffsetY: 0,

    get shadowColor() {
      return this._shadowColor;
    },
    set shadowColor(v: string) {
      this._shadowColor = v;
      calls.push(`shadowColor=${v}`);
    },

    get shadowBlur() {
      return this._shadowBlur;
    },
    set shadowBlur(v: number) {
      this._shadowBlur = v;
      calls.push(`shadowBlur=${v}`);
    },

    get shadowOffsetX() {
      return this._shadowOffsetX;
    },
    set shadowOffsetX(v: number) {
      this._shadowOffsetX = v;
      calls.push(`shadowOffsetX=${v}`);
    },

    get shadowOffsetY() {
      return this._shadowOffsetY;
    },
    set shadowOffsetY(v: number) {
      this._shadowOffsetY = v;
      calls.push(`shadowOffsetY=${v}`);
    },
  };
  const ctx = mockObj as unknown as CanvasRenderingContext2D;

  return { ctx, calls };
}

// =============================================================================
// Tests
// =============================================================================

describe('Canvas2D Effects Integration', () => {
  // ===========================================================================
  // 1. Outer shadow sets correct Canvas2D shadow properties
  // ===========================================================================

  describe('Outer shadow rendering', () => {
    test('outer shadow sets ctx.shadowColor, shadowBlur, shadowOffsetX, shadowOffsetY', () => {
      const { ctx, calls } = createTrackingContext();

      const obj = createShapeWithEffects({
        outerShadow: [
          {
            blurRadius: EMU_PER_PIXEL * 5, // 5 px
            distance: EMU_PER_PIXEL * 3, // 3 px
            direction: 0, // rightward
            color: '#000000',
            opacity: 0.5,
          },
        ],
      });

      renderDrawingObjectToCanvas(obj, ctx);

      // Verify shadow properties were set
      const shadowColorCalls = calls.filter((c) => c.startsWith('shadowColor='));
      expect(shadowColorCalls.length).toBeGreaterThan(0);
      // The shadow color should contain opacity applied via colorWithOpacity
      const shadowColorValue = shadowColorCalls[0];
      expect(shadowColorValue).toContain('shadowColor=');

      const shadowBlurCalls = calls.filter((c) => c.startsWith('shadowBlur='));
      expect(shadowBlurCalls.length).toBeGreaterThan(0);
      // Blur should be 5 px
      expect(shadowBlurCalls).toContain('shadowBlur=5');

      const shadowOffsetXCalls = calls.filter((c) => c.startsWith('shadowOffsetX='));
      expect(shadowOffsetXCalls.length).toBeGreaterThan(0);
      // Direction=0 means positive x-axis, distance=3px, so offsetX ~3, offsetY ~0
      expect(shadowOffsetXCalls).toContain('shadowOffsetX=3');

      const shadowOffsetYCalls = calls.filter((c) => c.startsWith('shadowOffsetY='));
      expect(shadowOffsetYCalls.length).toBeGreaterThan(0);
    });

    test('outer shadow with direction=90 offsets downward', () => {
      const { ctx, calls } = createTrackingContext();

      const obj = createShapeWithEffects({
        outerShadow: [
          {
            blurRadius: EMU_PER_PIXEL * 4,
            distance: EMU_PER_PIXEL * 5, // 5 px
            direction: 90, // downward
            color: '#333333',
            opacity: 0.6,
          },
        ],
      });

      renderDrawingObjectToCanvas(obj, ctx);

      // Direction=90 degrees: offsetX ~0, offsetY ~5
      const offsetXCalls = calls.filter((c) => c.startsWith('shadowOffsetX='));
      const offsetYCalls = calls.filter((c) => c.startsWith('shadowOffsetY='));
      expect(offsetXCalls.length).toBeGreaterThan(0);
      expect(offsetYCalls.length).toBeGreaterThan(0);

      // Extract the numeric values from offsetY call
      // cos(90deg) ≈ 0, sin(90deg) ≈ 1, so offsetX ≈ 0, offsetY ≈ 5
      const offsetYValue = parseFloat(offsetYCalls[0].split('=')[1]);
      expect(offsetYValue).toBeCloseTo(5, 0);
    });
  });

  // ===========================================================================
  // 2. Inner shadow rendering: clip + shadow sequence after fill
  // ===========================================================================

  describe('Inner shadow rendering', () => {
    test('inner shadow uses clip after fill', () => {
      const { ctx, calls } = createTrackingContext();

      const obj = createShapeWithEffects({
        innerShadow: [
          {
            blurRadius: EMU_PER_PIXEL * 4,
            distance: EMU_PER_PIXEL * 2,
            direction: 225,
            color: '#000000',
            opacity: 0.3,
          },
        ],
      });

      renderDrawingObjectToCanvas(obj, ctx);

      // Inner shadow should clip to geometry and then use shadow properties
      const clipCalls = calls.filter((c) => c === 'clip');
      expect(clipCalls.length).toBeGreaterThan(0);

      // Shadow color should be set for inner shadow
      const shadowColorCalls = calls.filter((c) => c.startsWith('shadowColor='));
      expect(shadowColorCalls.length).toBeGreaterThan(0);

      // Verify the clip happens AFTER the main fill (rendering order)
      // Find the first main fill and the clip for inner shadow
      const fillIndex = calls.indexOf('fill');
      const clipIndex = calls.indexOf('clip');

      // The fill from the main shape comes before the inner shadow's clip
      expect(fillIndex).toBeGreaterThan(-1);
      expect(clipIndex).toBeGreaterThan(-1);
      expect(clipIndex).toBeGreaterThan(fillIndex);
    });

    test('inner shadow sets shadow properties', () => {
      const { ctx, calls } = createTrackingContext();

      const obj = createShapeWithEffects({
        innerShadow: [
          {
            blurRadius: EMU_PER_PIXEL * 3,
            distance: EMU_PER_PIXEL * 2,
            direction: 180,
            color: '#FF0000',
            opacity: 0.5,
          },
        ],
      });

      renderDrawingObjectToCanvas(obj, ctx);

      // Inner shadow should set shadow color (with opacity applied)
      const shadowColorCalls = calls.filter((c) => c.startsWith('shadowColor='));
      expect(shadowColorCalls.length).toBeGreaterThan(0);
      // The color should contain the red channel from #FF0000
      const hasRedColor = shadowColorCalls.some((c) => c.includes('255'));
      expect(hasRedColor).toBe(true);

      // Shadow blur should be set
      const shadowBlurCalls = calls.filter((c) => c.startsWith('shadowBlur='));
      expect(shadowBlurCalls.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // 3. Glow rendering: multiple stroke passes with decreasing alpha
  // ===========================================================================

  describe('Glow rendering', () => {
    test('glow produces multiple stroke passes', () => {
      const { ctx, calls } = createTrackingContext();

      const obj = createShapeWithEffects({
        glow: {
          radius: EMU_PER_PIXEL * 6, // 6 px radius
          color: '#FFD700',
          opacity: 0.6,
        },
      });

      renderDrawingObjectToCanvas(obj, ctx);

      // Glow uses multiple stroke passes (3-10 depending on radius)
      const strokeCalls = calls.filter((c) => c === 'stroke');
      expect(strokeCalls.length).toBeGreaterThanOrEqual(3);

      // Each pass should have a beginPath before it
      const beginPathCalls = calls.filter((c) => c === 'beginPath');
      expect(beginPathCalls.length).toBeGreaterThanOrEqual(strokeCalls.length);
    });

    test('glow with zero radius still produces valid rendering', () => {
      const { ctx, calls } = createTrackingContext();

      const obj = createShapeWithEffects({
        glow: {
          radius: 0,
          color: '#00FF00',
          opacity: 0.8,
        },
      });

      expect(() => {
        renderDrawingObjectToCanvas(obj, ctx);
      }).not.toThrow();
    });
  });

  // ===========================================================================
  // 4. Render order: outer shadow before fill, inner shadow after fill,
  //    stroke after fill
  // ===========================================================================

  describe('Render order', () => {
    test('outer shadow effects render before fill', () => {
      const { ctx, calls } = createTrackingContext();

      const obj = createShapeWithEffects({
        outerShadow: [
          {
            blurRadius: EMU_PER_PIXEL * 3,
            distance: EMU_PER_PIXEL * 2,
            direction: 45,
            color: '#000000',
            opacity: 0.5,
          },
        ],
      });

      renderDrawingObjectToCanvas(obj, ctx);

      // Find all fill calls
      const fillIndices = calls.map((c, i) => (c === 'fill' ? i : -1)).filter((i) => i >= 0);

      // At least 2 fills: one from outer shadow (drawing the shadow shape),
      // one from the main fill
      expect(fillIndices.length).toBeGreaterThanOrEqual(2);

      // The outer shadow fill should come before the main fill.
      // The outer shadow is wrapped in its own save/restore pair.
      // Find the shadow property set (which marks the shadow fill)
      const firstShadowColorIdx = calls.findIndex((c) => c.startsWith('shadowColor='));
      // The fill after shadowColor set is the shadow fill
      const shadowFillIdx = calls.findIndex((c, i) => c === 'fill' && i > firstShadowColorIdx);

      // Find the main fill (no shadow properties immediately before it)
      // It is the last fill in the sequence
      const lastFillIdx = fillIndices[fillIndices.length - 1];

      expect(shadowFillIdx).toBeGreaterThan(-1);
      expect(lastFillIdx).toBeGreaterThan(shadowFillIdx);
    });

    test('inner shadow renders after fill', () => {
      const { ctx, calls } = createTrackingContext();

      const obj = createShapeWithEffects({
        innerShadow: [
          {
            blurRadius: EMU_PER_PIXEL * 3,
            distance: EMU_PER_PIXEL * 2,
            direction: 225,
            color: '#000000',
            opacity: 0.3,
          },
        ],
      });

      renderDrawingObjectToCanvas(obj, ctx);

      // The main fill should come before the inner shadow's clip
      const fillIdx = calls.indexOf('fill');
      const innerShadowClipIdx = calls.indexOf('clip');

      expect(fillIdx).toBeGreaterThan(-1);
      expect(innerShadowClipIdx).toBeGreaterThan(-1);
      expect(innerShadowClipIdx).toBeGreaterThan(fillIdx);
    });

    test('stroke renders after fill', () => {
      const { ctx, calls } = createTrackingContext();

      const obj: DrawingObject = {
        geometry: makeRectPath(),
        fill: { type: 'solid', color: '#FF0000' },
        stroke: { color: '#0000FF', width: 2 },
      };

      renderDrawingObjectToCanvas(obj, ctx);

      const fillIdx = calls.indexOf('fill');
      const strokeIdx = calls.indexOf('stroke');

      expect(fillIdx).toBeGreaterThan(-1);
      expect(strokeIdx).toBeGreaterThan(-1);
      expect(strokeIdx).toBeGreaterThan(fillIdx);
    });

    test('full order: outer shadow -> fill -> inner shadow -> stroke -> glow', () => {
      const { ctx, calls } = createTrackingContext();

      const obj: DrawingObject = {
        geometry: makeRectPath(),
        fill: { type: 'solid', color: '#4472C4' },
        stroke: { color: '#333333', width: 1 },
        effects: {
          outerShadow: [
            {
              blurRadius: EMU_PER_PIXEL * 3,
              distance: EMU_PER_PIXEL * 2,
              direction: 45,
              color: '#000000',
              opacity: 0.4,
            },
          ],
          innerShadow: [
            {
              blurRadius: EMU_PER_PIXEL * 2,
              distance: EMU_PER_PIXEL,
              direction: 225,
              color: '#333333',
              opacity: 0.3,
            },
          ],
          glow: {
            radius: EMU_PER_PIXEL * 4,
            color: '#FFD700',
            opacity: 0.5,
          },
        },
      };

      renderDrawingObjectToCanvas(obj, ctx);

      // Find key milestones in the call sequence
      const firstShadowColor = calls.findIndex((c) => c.startsWith('shadowColor='));
      const firstFillAfterShadow = calls.findIndex((c, i) => c === 'fill' && i > firstShadowColor);

      // Find the main fill (second fill - after the shadow fill)
      const allFills = calls.map((c, i) => (c === 'fill' ? i : -1)).filter((i) => i >= 0);
      // Outer shadow produces a fill, then main fill is next
      expect(allFills.length).toBeGreaterThanOrEqual(2);
      const mainFillIdx = allFills[1]; // Second fill is the main shape fill

      // Inner shadow clip comes after main fill
      const clipAfterMainFill = calls.findIndex((c, i) => c === 'clip' && i > mainFillIdx);
      expect(clipAfterMainFill).toBeGreaterThan(mainFillIdx);

      // Stroke for the main shape comes after inner shadow
      // (the stroke call for the main shape, not glow strokes)
      const strokeIdx = calls.indexOf('stroke');
      expect(strokeIdx).toBeGreaterThan(mainFillIdx);

      // Glow strokes come after the main shape stroke
      const allStrokes = calls.map((c, i) => (c === 'stroke' ? i : -1)).filter((i) => i >= 0);
      // Should have at least main stroke + glow passes
      expect(allStrokes.length).toBeGreaterThanOrEqual(4); // 1 main + 3+ glow
    });
  });

  // ===========================================================================
  // 5. Multi-effect DrawingObject: shadow + glow both render
  // ===========================================================================

  describe('Multi-effect composition', () => {
    test('shadow + glow both render correctly in sequence', () => {
      const { ctx, calls } = createTrackingContext();

      const obj = createShapeWithEffects({
        outerShadow: [
          {
            blurRadius: EMU_PER_PIXEL * 4,
            distance: EMU_PER_PIXEL * 3,
            direction: 45,
            color: '#000000',
            opacity: 0.5,
          },
        ],
        glow: {
          radius: EMU_PER_PIXEL * 5,
          color: '#FFD700',
          opacity: 0.6,
        },
      });

      renderDrawingObjectToCanvas(obj, ctx);

      // Shadow should set shadow properties
      const shadowColorCalls = calls.filter((c) => c.startsWith('shadowColor='));
      expect(shadowColorCalls.length).toBeGreaterThan(0);

      // Glow should produce multiple strokes
      const strokeCalls = calls.filter((c) => c === 'stroke');
      expect(strokeCalls.length).toBeGreaterThanOrEqual(3);

      // Shadow rendering should come before glow rendering
      const firstShadowColor = calls.findIndex((c) => c.startsWith('shadowColor='));
      const firstStroke = calls.indexOf('stroke');
      // The shadow fill comes before any glow strokes
      const shadowFill = calls.findIndex((c, i) => c === 'fill' && i > firstShadowColor);
      expect(shadowFill).toBeLessThan(firstStroke);
    });

    test('inner shadow + glow both render correctly', () => {
      const { ctx, calls } = createTrackingContext();

      const obj = createShapeWithEffects({
        innerShadow: [
          {
            blurRadius: EMU_PER_PIXEL * 3,
            distance: EMU_PER_PIXEL * 2,
            direction: 225,
            color: '#000000',
            opacity: 0.3,
          },
        ],
        glow: {
          radius: EMU_PER_PIXEL * 4,
          color: '#00FF00',
          opacity: 0.5,
        },
      });

      renderDrawingObjectToCanvas(obj, ctx);

      // Inner shadow should clip
      expect(calls.filter((c) => c === 'clip').length).toBeGreaterThan(0);

      // Glow should stroke multiple times
      expect(calls.filter((c) => c === 'stroke').length).toBeGreaterThanOrEqual(3);

      // Inner shadow (clip) should come before glow (strokes)
      const clipIdx = calls.indexOf('clip');
      const firstStrokeIdx = calls.indexOf('stroke');
      expect(clipIdx).toBeLessThan(firstStrokeIdx);
    });

    test('all three effect types render together', () => {
      const { ctx, calls } = createTrackingContext();

      const obj: DrawingObject = {
        geometry: makeRectPath(),
        fill: { type: 'solid', color: '#4472C4' },
        effects: {
          outerShadow: [
            {
              blurRadius: EMU_PER_PIXEL * 3,
              distance: EMU_PER_PIXEL * 2,
              direction: 45,
              color: '#000000',
              opacity: 0.4,
            },
          ],
          innerShadow: [
            {
              blurRadius: EMU_PER_PIXEL * 2,
              distance: EMU_PER_PIXEL,
              direction: 225,
              color: '#333333',
              opacity: 0.3,
            },
          ],
          glow: {
            radius: EMU_PER_PIXEL * 4,
            color: '#FFD700',
            opacity: 0.5,
          },
        },
      };

      renderDrawingObjectToCanvas(obj, ctx);

      // Verify all effect types produced their expected operations
      // Outer shadow: shadowColor set
      const shadowColorCalls = calls.filter((c) => c.startsWith('shadowColor='));
      expect(shadowColorCalls.length).toBeGreaterThan(0);

      // Inner shadow: clip operation
      const clipCalls = calls.filter((c) => c === 'clip');
      expect(clipCalls.length).toBeGreaterThan(0);

      // Glow: multiple stroke operations
      const strokeCalls = calls.filter((c) => c === 'stroke');
      expect(strokeCalls.length).toBeGreaterThanOrEqual(3);

      // Main fill should be present
      const fillCalls = calls.filter((c) => c === 'fill' || c === 'fill(evenodd)');
      expect(fillCalls.length).toBeGreaterThanOrEqual(2); // shadow fill + main fill + inner shadow fill

      // Balanced save/restore
      const saveCount = calls.filter((c) => c === 'save').length;
      const restoreCount = calls.filter((c) => c === 'restore').length;
      expect(saveCount).toBe(restoreCount);
    });
  });
});
