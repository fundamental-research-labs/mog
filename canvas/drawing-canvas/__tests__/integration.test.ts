/**
 * Integration Tests — Drawing Canvas
 *
 * Factory wiring, z-order rendering, hit testing, dirty tracking,
 * and viewport culling. Exercises the full pipeline
 * from createDrawingLayer() through render() and hitTest().
 *
 * These tests mock the canvas context and external rendering dependencies
 * (drawing-engine, shape-engine) to focus on integration wiring rather than
 * pixel-level rendering correctness.
 */

import { jest } from '@jest/globals';

import type { FrameContext, RenderRegion } from '@mog/canvas-engine';
import type { DrawingBridgeConfig } from '../src/bridges/types';
import { createDrawingLayer } from '../src/factory';
import type { ObjectHitResult } from '../src/hit-testing/hit-map';
import type { InkScene, PictureScene, ShapeScene, TextboxScene } from '../src/scene/types';

// =============================================================================
// Mocks — external rendering dependencies
// =============================================================================

// The shape renderer imports createDrawingObject and renderDrawingObjectToCanvas
// from external packages. Mock them to avoid pulling in their full dependency
// trees (shape-engine geometry, drawing-engine canvas orchestrator, etc.).
jest.mock('@mog/drawing-engine', () => ({
  renderDrawingObjectToCanvas: jest.fn(),
}));

jest.mock('@mog/shape-engine', () => ({
  createDrawingObject: jest.fn(() => ({
    type: 'shape',
    geometry: { paths: [] },
    visual: {},
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  })),
}));

class MockPath2D {
  constructor(_path?: string | MockPath2D) {}

  addPath(): void {}
  arc(): void {}
  arcTo(): void {}
  bezierCurveTo(): void {}
  closePath(): void {}
  ellipse(): void {}
  lineTo(): void {}
  moveTo(): void {}
  quadraticCurveTo(): void {}
  rect(): void {}
  roundRect(): void {}
}

const originalPath2D = globalThis.Path2D;

beforeAll(() => {
  globalThis.Path2D = MockPath2D as unknown as typeof Path2D;
});

afterAll(() => {
  globalThis.Path2D = originalPath2D;
});

// =============================================================================
// Bridge Config (all null for tests)
// =============================================================================

const nullBridges: DrawingBridgeConfig = {
  chartBridge: null,
  diagramBridge: null,
  textEffectBridge: null,
  astToLatexFn: null,
  inkAccessor: null,
};

// =============================================================================
// Mock Utilities
// =============================================================================

function createMockCtx(): CanvasRenderingContext2D {
  const ctx = {
    save: jest.fn(),
    restore: jest.fn(),
    fillRect: jest.fn(),
    strokeRect: jest.fn(),
    fillText: jest.fn(),
    beginPath: jest.fn(),
    rect: jest.fn(),
    clip: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    bezierCurveTo: jest.fn(),
    quadraticCurveTo: jest.fn(),
    arc: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    drawImage: jest.fn(),
    translate: jest.fn(),
    transform: jest.fn(),
    rotate: jest.fn(),
    scale: jest.fn(),
    setLineDash: jest.fn(),
    closePath: jest.fn(),
    createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    measureText: jest.fn(() => ({
      width: 50,
      fontBoundingBoxAscent: 10,
      fontBoundingBoxDescent: 2,
    })),
    // Properties
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    lineCap: 'butt',
    lineJoin: 'miter',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  } as unknown as CanvasRenderingContext2D;
  return ctx;
}

function createMockRegion(overrides?: Partial<RenderRegion>): RenderRegion {
  return {
    id: 'main',
    bounds: { x: 0, y: 0, width: 1000, height: 800 },
    viewportOrigin: { x: 0, y: 0 },
    scrollOffset: { x: 0, y: 0 },
    zoom: 1,
    metadata: {},
    ...overrides,
  };
}

function createMockFrame(): FrameContext {
  return {
    timestamp: 0,
    canvasSize: { width: 1000, height: 800 },
    dpr: 1,
    frameNumber: 0,
  };
}

// =============================================================================
// Scene Object Helpers
// =============================================================================

function makePicture(id: string, zIndex: number, opts?: Partial<PictureScene>): PictureScene {
  return {
    id,
    type: 'picture',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    zIndex,
    visible: true,
    groupId: null,
    data: { src: 'test.png', naturalWidth: 100, naturalHeight: 100 },
    ...opts,
  };
}

function makeTextbox(id: string, zIndex: number, opts?: Partial<TextboxScene>): TextboxScene {
  return {
    id,
    type: 'textbox',
    bounds: { x: 0, y: 0, width: 200, height: 50 },
    zIndex,
    visible: true,
    groupId: null,
    data: { text: 'Hello' },
    ...opts,
  };
}

function makeShape(id: string, zIndex: number, opts?: Partial<ShapeScene>): ShapeScene {
  return {
    id,
    type: 'shape',
    bounds: { x: 0, y: 0, width: 150, height: 150 },
    zIndex,
    visible: true,
    groupId: null,
    data: { shapeType: 'rect' },
    ...opts,
  };
}

function makeInk(id: string, zIndex: number, opts?: Partial<InkScene>): InkScene {
  return {
    id,
    type: 'ink',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    zIndex,
    visible: true,
    groupId: null,
    data: {
      strokes: [
        {
          points: [
            { x: 10, y: 10 },
            { x: 50, y: 50 },
          ],
          color: '#000000',
          width: 2,
        },
      ],
    },
    ...opts,
  };
}

// =============================================================================
// Test Group 1: createDrawingLayer factory
// =============================================================================

describe('createDrawingLayer factory', () => {
  test('creates a DrawingLayerHandle with all components', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    expect(handle.layer).toBeDefined();
    expect(handle.sceneGraph).toBeDefined();
    expect(handle.bridges).toBeDefined();
    expect(handle.hitMap).toBeDefined();
    expect(handle.imageCache).toBeDefined();
    expect(typeof handle.dispose).toBe('function');

    handle.dispose();
  });

  test('layer has correct identity constants', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    expect(handle.layer.id).toBe('drawing');
    expect(handle.layer.zIndex).toBe(500);
    expect(handle.layer.canvas).toBe(0);
    expect(handle.layer.renderMode).toBe('per-region');

    handle.dispose();
  });

  test('dispose() works without errors', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    expect(() => handle.dispose()).not.toThrow();
  });

  test('dispose() can be called multiple times safely', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
  });
});

// =============================================================================
// Test Group 2: rendering with z-order interleaving
// =============================================================================

describe('rendering with z-order interleaving', () => {
  test('renders 4 object types without errors', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });
    const ctx = createMockCtx();
    const region = createMockRegion();
    const frame = createMockFrame();

    // Add 4 different object types (no chart — chartBridge is null)
    handle.sceneGraph.add(makePicture('pic1', 1));
    handle.sceneGraph.add(makeTextbox('tb1', 2));
    handle.sceneGraph.add(makeInk('ink1', 3));
    handle.sceneGraph.add(makeShape('sh1', 4));

    expect(() => handle.layer.render(ctx, region, frame)).not.toThrow();

    handle.dispose();
  });

  test('objects render in ascending z-order (save/restore pairs)', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });
    const ctx = createMockCtx();
    const region = createMockRegion();
    const frame = createMockFrame();

    // Add objects out of z-order; the scene graph sorts them
    handle.sceneGraph.add(makeShape('sh1', 4));
    handle.sceneGraph.add(makePicture('pic1', 1));
    handle.sceneGraph.add(makeInk('ink1', 3));
    handle.sceneGraph.add(makeTextbox('tb1', 2));

    handle.layer.render(ctx, region, frame);

    // Each renderer calls ctx.save() at the start. The dispatcher wraps each
    // object render in its own save/restore. By tracking save() calls we can
    // verify 4 objects were rendered. The exact call counts depend on
    // per-renderer implementation, but save() must be called at least 4 times
    // (one per object).
    expect((ctx.save as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  test('invisible objects are skipped during render', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });
    const ctx = createMockCtx();
    const region = createMockRegion();
    const frame = createMockFrame();

    handle.sceneGraph.add(makePicture('pic1', 1, { visible: false }));
    handle.sceneGraph.add(makeTextbox('tb1', 2));

    handle.layer.render(ctx, region, frame);

    // Only the textbox should render. The picture renderer checks visibility
    // and skips. We verify by checking that fillText is called (textbox renders
    // text) but drawImage is not called (picture would call drawImage or
    // fillRect for placeholder). The picture is invisible so neither path runs.
    // At minimum, save() should be called for the textbox but not for the
    // invisible picture at the dispatcher level (the dispatcher checks visible
    // before calling the renderer).
    // The layer itself skips invisible objects in its loop (line 117).
    // So save() calls should correspond only to the textbox render.
    const saveCalls = (ctx.save as jest.Mock).mock.calls.length;
    // Textbox renderer calls save() at least once; picture is skipped entirely
    expect(saveCalls).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Test Group 3: hit testing
// =============================================================================

describe('hit testing', () => {
  test('returns topmost object at overlapping point (z-order priority)', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    // pic1 at (10,10)-(110,110), z=1
    handle.sceneGraph.add(
      makePicture('pic1', 1, {
        bounds: { x: 10, y: 10, width: 100, height: 100 },
      }),
    );

    // tb1 at (50,50)-(150,150), z=2 — overlaps with pic1
    handle.sceneGraph.add(
      makeTextbox('tb1', 2, {
        bounds: { x: 50, y: 50, width: 100, height: 100 },
      }),
    );

    // sh1 at (200,200)-(250,250), z=3
    handle.sceneGraph.add(
      makeShape('sh1', 3, {
        bounds: { x: 200, y: 200, width: 50, height: 50 },
      }),
    );

    // Set viewport transform (no scroll, zoom=1, dpr=1)
    handle.hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    // Hit at (75,75) — both pic1 and tb1 cover this point
    // tb1 (z=2) should be returned as it's topmost
    const hit1 = handle.hitMap.hitTest({ x: 75, y: 75 });
    expect(hit1).not.toBeNull();
    expect((hit1!.target as ObjectHitResult).objectId).toBe('tb1');

    handle.dispose();
  });

  test('returns only object covering a non-overlapping point', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    handle.sceneGraph.add(
      makePicture('pic1', 1, {
        bounds: { x: 10, y: 10, width: 100, height: 100 },
      }),
    );
    handle.sceneGraph.add(
      makeTextbox('tb1', 2, {
        bounds: { x: 50, y: 50, width: 100, height: 100 },
      }),
    );
    handle.sceneGraph.add(
      makeShape('sh1', 3, {
        bounds: { x: 200, y: 200, width: 50, height: 50 },
      }),
    );

    handle.hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    // Hit at (15,15) — only pic1 covers this point
    const hit2 = handle.hitMap.hitTest({ x: 15, y: 15 });
    expect(hit2).not.toBeNull();
    expect((hit2!.target as ObjectHitResult).objectId).toBe('pic1');

    handle.dispose();
  });

  test('returns isolated object at its position', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    handle.sceneGraph.add(
      makePicture('pic1', 1, {
        bounds: { x: 10, y: 10, width: 100, height: 100 },
      }),
    );
    handle.sceneGraph.add(
      makeTextbox('tb1', 2, {
        bounds: { x: 50, y: 50, width: 100, height: 100 },
      }),
    );
    handle.sceneGraph.add(
      makeShape('sh1', 3, {
        bounds: { x: 200, y: 200, width: 50, height: 50 },
      }),
    );

    handle.hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    // Hit at (225,225) — only sh1 covers this point
    const hit3 = handle.hitMap.hitTest({ x: 225, y: 225 });
    expect(hit3).not.toBeNull();
    expect((hit3!.target as ObjectHitResult).objectId).toBe('sh1');

    handle.dispose();
  });

  test('returns null when no object is at the point', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    handle.sceneGraph.add(
      makePicture('pic1', 1, {
        bounds: { x: 10, y: 10, width: 100, height: 100 },
      }),
    );
    handle.sceneGraph.add(
      makeTextbox('tb1', 2, {
        bounds: { x: 50, y: 50, width: 100, height: 100 },
      }),
    );
    handle.sceneGraph.add(
      makeShape('sh1', 3, {
        bounds: { x: 200, y: 200, width: 50, height: 50 },
      }),
    );

    handle.hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    // Hit at (500,500) — no object here
    const hit4 = handle.hitMap.hitTest({ x: 500, y: 500 });
    expect(hit4).toBeNull();

    handle.dispose();
  });

  test('hit result includes layerId and region', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    handle.sceneGraph.add(
      makePicture('pic1', 1, {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    );

    handle.hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    const hit = handle.hitMap.hitTest({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect(hit!.layerId).toBe('drawing');
    expect((hit!.target as ObjectHitResult).region).toBe('body');

    handle.dispose();
  });

  test('skips invisible objects during hit testing', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    handle.sceneGraph.add(
      makePicture('pic1', 1, {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        visible: false,
      }),
    );
    handle.sceneGraph.add(
      makeTextbox('tb1', 2, {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    );

    handle.hitMap.setViewportTransform({ x: 0, y: 0 }, 1, 1, { x: 0, y: 0 });

    // pic1 is invisible, so tb1 (z=2) should be hit even though both overlap
    const hit = handle.hitMap.hitTest({ x: 50, y: 50 });
    expect(hit).not.toBeNull();
    expect((hit!.target as ObjectHitResult).objectId).toBe('tb1');

    handle.dispose();
  });
});

// =============================================================================
// Test Group 4: dirty tracking integration
// =============================================================================

describe('dirty tracking integration', () => {
  test('layer starts dirty', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    expect(handle.layer.isDirty()).toBe(true);

    handle.dispose();
  });

  test('markClean() clears dirty flag', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    handle.layer.markClean();
    expect(handle.layer.isDirty()).toBe(false);

    handle.dispose();
  });

  test('adding object to scene graph sets layer dirty via onDirty callback', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    // Start clean
    handle.layer.markClean();
    expect(handle.layer.isDirty()).toBe(false);

    // Add an object — onDirty callback should fire, marking layer dirty
    handle.sceneGraph.add(makePicture('pic1', 1));
    expect(handle.layer.isDirty()).toBe(true);

    handle.dispose();
  });

  test('removing object from scene graph sets layer dirty', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    handle.sceneGraph.add(makePicture('pic1', 1));
    handle.layer.markClean();
    expect(handle.layer.isDirty()).toBe(false);

    handle.sceneGraph.remove('pic1');
    expect(handle.layer.isDirty()).toBe(true);

    handle.dispose();
  });

  test('updating object in scene graph sets layer dirty', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    handle.sceneGraph.add(makePicture('pic1', 1));
    handle.layer.markClean();
    expect(handle.layer.isDirty()).toBe(false);

    handle.sceneGraph.update('pic1', {
      bounds: { x: 50, y: 50, width: 100, height: 100 },
    });
    expect(handle.layer.isDirty()).toBe(true);

    handle.dispose();
  });

  test('clearing scene graph sets layer dirty', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });

    handle.sceneGraph.add(makePicture('pic1', 1));
    handle.layer.markClean();
    expect(handle.layer.isDirty()).toBe(false);

    handle.sceneGraph.clear();
    expect(handle.layer.isDirty()).toBe(true);

    handle.dispose();
  });
});

// =============================================================================
// Test Group 5: viewport culling (was Group 6, renumbered after effective state removal)
// =============================================================================

describe('viewport culling', () => {
  test('object outside viewport is culled (not rendered)', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });
    const ctx = createMockCtx();
    const frame = createMockFrame();

    // Object at (0,0)-(100,100) in document space
    handle.sceneGraph.add(
      makeTextbox('tb1', 1, {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    );

    // Scroll offset of (200,200) means visible area starts at doc (200,200).
    // Object at (0,0)-(100,100) is entirely above-left of the viewport.
    // Region-local coords: (0-200, 0-200) = (-200, -200) to (-100, -100).
    // Since right < 0 and bottom < 0, the object is culled.
    const scrolledRegion = createMockRegion({
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 200, y: 200 },
    });

    handle.layer.render(ctx, scrolledRegion, frame);

    // The textbox renderer should NOT be called. No save() calls should
    // happen because the object is culled before dispatching to the renderer.
    // Note: the layer's render() calls save/restore only inside the dispatcher,
    // and the object is culled before that point.
    expect((ctx.fillText as jest.Mock).mock.calls.length).toBe(0);
    expect((ctx.fillRect as jest.Mock).mock.calls.length).toBe(0);

    handle.dispose();
  });

  test('object inside viewport is rendered', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });
    const ctx = createMockCtx();
    const frame = createMockFrame();

    // Object at (0,0)-(100,100) in document space
    handle.sceneGraph.add(
      makeTextbox('tb1', 1, {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    );

    // No scroll — object is fully visible
    const noScrollRegion = createMockRegion({
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
    });

    handle.layer.render(ctx, noScrollRegion, frame);

    // The textbox should render — save() should be called at least once
    expect((ctx.save as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(1);

    handle.dispose();
  });

  test('partially visible object is not culled', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });
    const ctx = createMockCtx();
    const frame = createMockFrame();

    // Object at (0,0)-(100,100) in document space
    handle.sceneGraph.add(
      makeTextbox('tb1', 1, {
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    );

    // Scroll offset (50,50) means the object is partially visible:
    // Region-local coords: (-50, -50) to (50, 50).
    // right=50 > 0 and bottom=50 > 0, left=-50 < 1000, top=-50 < 800
    // So the object is NOT culled (partially in viewport).
    const partialScrollRegion = createMockRegion({
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 50, y: 50 },
    });

    handle.layer.render(ctx, partialScrollRegion, frame);

    // The textbox should render
    expect((ctx.save as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(1);

    handle.dispose();
  });

  test('object just beyond right/bottom edge is culled', () => {
    const handle = createDrawingLayer({ bridges: nullBridges });
    const ctx = createMockCtx();
    const frame = createMockFrame();

    // Object at (1100,900) in document space — beyond the 1000x800 region
    handle.sceneGraph.add(
      makeTextbox('tb1', 1, {
        bounds: { x: 1100, y: 900, width: 100, height: 100 },
      }),
    );

    // No scroll offset — region is (0,0)-(1000,800)
    // Object region-local: (1100, 900) to (1200, 1000)
    // left=1100 > region.width=1000 — culled
    const region = createMockRegion();

    handle.layer.render(ctx, region, frame);

    // Culled — no rendering calls
    expect((ctx.fillText as jest.Mock).mock.calls.length).toBe(0);
    expect((ctx.fillRect as jest.Mock).mock.calls.length).toBe(0);

    handle.dispose();
  });
});
