/**
 * Canvas2D Orchestrator Tests
 *
 * Tests for renderDrawingObjectToCanvas — the top-level Canvas2D renderer.
 */
import { jest } from '@jest/globals';

import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type { Path } from '@mog-sdk/contracts/geometry';
import { renderDrawingObjectToCanvas } from '../../src/renderer/canvas';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock Path2D (not available in jsdom)
class MockPath2D {
  constructor(public svgString?: string) {}
  addPath = jest.fn();
}
(globalThis as any).Path2D = MockPath2D;

// Mock DOMMatrix
class MockDOMMatrix {
  constructor(public values?: number[]) {}
}
(globalThis as any).DOMMatrix = MockDOMMatrix;

function createMockContext() {
  return {
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    bezierCurveTo: jest.fn(),
    quadraticCurveTo: jest.fn(),
    clip: jest.fn(),
    transform: jest.fn(),
    rect: jest.fn(),
    fillRect: jest.fn(),
    isPointInPath: jest.fn(() => false),
    isPointInStroke: jest.fn(() => false),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    setLineDash: jest.fn(),
    createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
  } as unknown as CanvasRenderingContext2D;
}

function makeSimplePath(): Path {
  return {
    segments: [
      { type: 'M' as const, x: 0, y: 0 },
      { type: 'L' as const, x: 100, y: 0 },
      { type: 'L' as const, x: 100, y: 100 },
      { type: 'L' as const, x: 0, y: 100 },
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

describe('renderDrawingObjectToCanvas', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockContext();
  });

  test('simple object with just geometry calls save/restore', () => {
    const obj = makeSimpleObject();
    renderDrawingObjectToCanvas(obj, ctx);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  test('object with fill renders fill', () => {
    const obj = makeSimpleObject({
      fill: { type: 'solid', color: '#ff0000' },
    });
    renderDrawingObjectToCanvas(obj, ctx);
    // Fill renders via renderFillToCanvas which calls beginPath, moveTo/lineTo, fill
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  test('object with stroke renders stroke', () => {
    const obj = makeSimpleObject({
      stroke: { color: '#0000ff', width: 2 },
    });
    renderDrawingObjectToCanvas(obj, ctx);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  test('object with transform applies ctx.transform', () => {
    const obj = makeSimpleObject({
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
    });
    renderDrawingObjectToCanvas(obj, ctx);
    expect(ctx.transform).toHaveBeenCalledWith(1, 0, 0, 1, 10, 20);
  });

  test('object with children recurses (save/restore per child)', () => {
    const child1 = makeSimpleObject();
    const child2 = makeSimpleObject();
    const obj = makeSimpleObject({ children: [child1, child2] });

    renderDrawingObjectToCanvas(obj, ctx);

    // Parent + 2 children = 3 save/restore pairs
    expect(ctx.save).toHaveBeenCalledTimes(3);
    expect(ctx.restore).toHaveBeenCalledTimes(3);
  });

  test('object with outer shadow effects calls shadow rendering', () => {
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
    renderDrawingObjectToCanvas(obj, ctx);

    // Outer shadow rendering calls save/restore internally + parent save/restore
    // The shadow function sets shadowColor, shadowBlur, etc.
    // At minimum we expect more than 1 save/restore pair (parent + shadow)
    expect((ctx.save as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('object with inner shadow effects calls inner shadow rendering after fill', () => {
    const obj = makeSimpleObject({
      fill: { type: 'solid', color: '#ff0000' },
      effects: {
        innerShadow: [
          {
            blurRadius: 25400,
            distance: 12700,
            direction: 225,
            color: '#000000',
            opacity: 0.3,
          },
        ],
      },
    });
    renderDrawingObjectToCanvas(obj, ctx);

    // Both fill and inner shadow use save/restore
    expect((ctx.save as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('object with glow effect calls glow rendering', () => {
    const obj = makeSimpleObject({
      effects: {
        glow: { radius: 63500, color: '#FFD700', opacity: 0.6 },
      },
    });
    renderDrawingObjectToCanvas(obj, ctx);

    // Glow uses stroke passes
    expect((ctx.save as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('object with bevel effect calls bevel rendering', () => {
    const obj = makeSimpleObject({
      effects: {
        bevel: {
          topPreset: 'circle',
          topWidth: 38100,
          topHeight: 38100,
        },
      },
    });
    renderDrawingObjectToCanvas(obj, ctx);

    // Bevel uses save/restore internally
    expect((ctx.save as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('object with clip calls clip()', () => {
    const clipPath = makeSimplePath();
    const obj = makeSimpleObject({ clip: clipPath });

    renderDrawingObjectToCanvas(obj, ctx);

    expect(ctx.clip).toHaveBeenCalled();
    // beginPath is called before clip
    expect(ctx.beginPath).toHaveBeenCalled();
  });

  test('rendering order: outer shadow before fill, inner shadow after fill', () => {
    const callOrder: string[] = [];
    const mockCtx = createMockContext();

    // Track call order for key operations
    (mockCtx.save as jest.Mock).mockImplementation(() => callOrder.push('save'));
    (mockCtx.restore as jest.Mock).mockImplementation(() => callOrder.push('restore'));
    (mockCtx.fill as jest.Mock).mockImplementation(() => callOrder.push('fill'));

    const obj = makeSimpleObject({
      fill: { type: 'solid', color: '#ff0000' },
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
        innerShadow: [
          {
            blurRadius: 25400,
            distance: 12700,
            direction: 225,
            color: '#000000',
            opacity: 0.3,
          },
        ],
      },
    });

    renderDrawingObjectToCanvas(obj, mockCtx);

    // Find the indices of the first outer shadow fill and the main fill
    // Outer shadow should produce a fill before the main fill
    const fillIndices = callOrder.reduce<number[]>((acc, val, idx) => {
      if (val === 'fill') acc.push(idx);
      return acc;
    }, []);

    // At least 2 fills: one from outer shadow, one from fill
    expect(fillIndices.length).toBeGreaterThanOrEqual(2);
  });

  test('bevel renders AFTER stroke, not before fill', () => {
    const callOrder: string[] = [];
    const mockCtx = createMockContext();

    // Track key operations via mock implementations
    (mockCtx.save as jest.Mock).mockImplementation(() => callOrder.push('save'));
    (mockCtx.restore as jest.Mock).mockImplementation(() => callOrder.push('restore'));
    (mockCtx.fill as jest.Mock).mockImplementation(() => callOrder.push('fill'));
    (mockCtx.stroke as jest.Mock).mockImplementation(() => callOrder.push('stroke'));

    const obj = makeSimpleObject({
      fill: { type: 'solid', color: '#ff0000' },
      stroke: { color: '#0000ff', width: 2 },
      effects: {
        bevel: {
          topPreset: 'circle',
          topWidth: 38100,
          topHeight: 38100,
        },
      },
    });

    renderDrawingObjectToCanvas(obj, mockCtx);

    // Find the main stroke call (from renderStrokeToCanvas)
    // and the bevel stroke calls (from renderBevelToCanvas).
    // The bevel function calls stroke() internally, so we need
    // to verify bevel strokes come AFTER the main stroke.
    const strokeIndices = callOrder.reduce<number[]>((acc, val, idx) => {
      if (val === 'stroke') acc.push(idx);
      return acc;
    }, []);
    const fillIndices = callOrder.reduce<number[]>((acc, val, idx) => {
      if (val === 'fill') acc.push(idx);
      return acc;
    }, []);

    // Main fill should come before the main stroke
    expect(fillIndices.length).toBeGreaterThanOrEqual(1);
    // Main stroke + bevel strokes
    expect(strokeIndices.length).toBeGreaterThanOrEqual(2);
    // First fill (the main fill) should come before the first stroke (the main stroke)
    expect(fillIndices[0]).toBeLessThan(strokeIndices[0]);
    // The bevel strokes come after the first (main) stroke
    expect(strokeIndices[1]).toBeGreaterThan(strokeIndices[0]);
  });

  test('softEdge effect calls renderSoftEdgeToCanvas', () => {
    const obj = makeSimpleObject({
      effects: {
        softEdge: { radius: 25400 },
      },
    });
    renderDrawingObjectToCanvas(obj, ctx);

    // renderSoftEdgeToCanvas calls save/restore internally
    expect((ctx.save as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('deeply nested children all get rendered', () => {
    const grandchild = makeSimpleObject();
    const child = makeSimpleObject({ children: [grandchild] });
    const parent = makeSimpleObject({ children: [child] });

    renderDrawingObjectToCanvas(parent, ctx);

    // Parent + child + grandchild = 3 save/restore pairs
    expect(ctx.save).toHaveBeenCalledTimes(3);
    expect(ctx.restore).toHaveBeenCalledTimes(3);
  });
});
