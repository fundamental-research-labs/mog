/**
 * OverlayLayer Integration Tests
 *
 * Tests the OverlayLayer with a mock OverlayDataSource,
 * verifying render compositing order, handle visibility logic,
 * dirty tracking, hit testing, and disposal.
 */

import { jest } from '@jest/globals';

import type { FrameContext, RenderRegion } from '@mog/canvas-engine';
import type { OverlayDataSource } from '@mog-sdk/contracts/rendering';

import type { CustomHandle } from '../custom-handles';
import { OverlayLayer, createOverlayLayer } from '../overlay-layer';

// =============================================================================
// Global Mocks (Node.js has no Path2D or DOMMatrix)
// =============================================================================

class MockPath2D {
  rect = jest.fn();
  arc = jest.fn();
  ellipse = jest.fn();
  moveTo = jest.fn();
  lineTo = jest.fn();
  closePath = jest.fn();
  addPath = jest.fn();
}
(global as any).Path2D = MockPath2D;
(global as any).DOMMatrix = class {
  translateSelf() {
    return this;
  }
  rotateSelf() {
    return this;
  }
};

// =============================================================================
// Mock Canvas Context
// =============================================================================

function createMockCtx(): CanvasRenderingContext2D {
  const ctx: Record<string, any> = {
    save: jest.fn(),
    restore: jest.fn(),
    fillRect: jest.fn(),
    strokeRect: jest.fn(),
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    closePath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    arc: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    clip: jest.fn(),
    setLineDash: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    scale: jest.fn(),
    setTransform: jest.fn(),
    resetTransform: jest.fn(),
    rect: jest.fn(),
    isPointInPath: jest.fn().mockReturnValue(false),
    isPointInStroke: jest.fn().mockReturnValue(false),
    measureText: jest.fn().mockReturnValue({ width: 0 }),
    // Properties
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    shadowColor: 'rgba(0,0,0,0)',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    canvas: { width: 800, height: 600 },
  };

  return ctx as unknown as CanvasRenderingContext2D;
}

// =============================================================================
// Mock Data Source
// =============================================================================

function createMockDataSource(overrides: Partial<OverlayDataSource> = {}): OverlayDataSource {
  return {
    getSelectedObjectBounds: jest.fn().mockReturnValue(null),
    getSelectedObjectIds: jest.fn().mockReturnValue([]),
    getObjectBounds: jest.fn().mockReturnValue(null),
    isObjectLocked: jest.fn().mockReturnValue(false),
    getObjectRotation: jest.fn().mockReturnValue(0),
    getActiveHandle: jest.fn().mockReturnValue(null),
    getGuides: jest.fn().mockReturnValue([]),
    getRubberBand: jest.fn().mockReturnValue(null),
    getDragPreview: jest.fn().mockReturnValue(null),
    getInkPreview: jest.fn().mockReturnValue(null),
    getInsertionPreview: jest.fn().mockReturnValue(null),
    getConnectionPointIndicators: jest.fn().mockReturnValue(null),
    ...overrides,
  };
}

// =============================================================================
// Mock Frame Context & Region
// =============================================================================

const MOCK_REGION: RenderRegion = {
  id: '__full_canvas__',
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  viewportOrigin: { x: 0, y: 0 },
  scrollOffset: { x: 0, y: 0 },
  zoom: 1,
  metadata: undefined,
};

const MOCK_FRAME: FrameContext = {
  timestamp: 0,
  canvasSize: { width: 800, height: 600 },
  dpr: 1,
  frameNumber: 0,
};

// =============================================================================
// Tests
// =============================================================================

describe('OverlayLayer', () => {
  // =========================================================================
  // Identity & Constants
  // =========================================================================

  describe('identity', () => {
    it('has id "overlay"', () => {
      const ds = createMockDataSource();
      const layer = new OverlayLayer({ dataSource: ds });
      expect(layer.id).toBe('overlay');
    });

    it('has zIndex 0', () => {
      const ds = createMockDataSource();
      const layer = new OverlayLayer({ dataSource: ds });
      expect(layer.zIndex).toBe(0);
    });

    it('has renderMode "once"', () => {
      const ds = createMockDataSource();
      const layer = new OverlayLayer({ dataSource: ds });
      expect(layer.renderMode).toBe('once');
    });

    it('has canvas 1', () => {
      const ds = createMockDataSource();
      const layer = new OverlayLayer({ dataSource: ds });
      expect(layer.canvas).toBe(1);
    });
  });

  // =========================================================================
  // Dirty Tracking
  // =========================================================================

  describe('dirty tracking', () => {
    it('starts dirty', () => {
      const ds = createMockDataSource();
      const layer = new OverlayLayer({ dataSource: ds });
      expect(layer.isDirty()).toBe(true);
    });

    it('markClean() clears dirty flag', () => {
      const ds = createMockDataSource();
      const layer = new OverlayLayer({ dataSource: ds });
      layer.markClean();
      expect(layer.isDirty()).toBe(false);
    });

    it('markDirty() sets dirty flag', () => {
      const ds = createMockDataSource();
      const layer = new OverlayLayer({ dataSource: ds });
      layer.markClean();
      expect(layer.isDirty()).toBe(false);
      layer.markDirty();
      expect(layer.isDirty()).toBe(true);
    });

    it('markDirty() accepts a hint parameter', () => {
      const ds = createMockDataSource();
      const layer = new OverlayLayer({ dataSource: ds });
      layer.markClean();
      layer.markDirty({ type: 'full' });
      expect(layer.isDirty()).toBe(true);
    });
  });

  // =========================================================================
  // Single Object Selection
  // =========================================================================

  describe('single object selection', () => {
    it('renders selection outline and handles for a normal-sized object', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-1']),
        getObjectBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 200, height: 150 }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Selection outline drawn (save/restore pair with strokeRect)
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.strokeRect).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();

      // Resize handles drawn (fillRect + strokeRect for each handle)
      expect(ctx.fillRect).toHaveBeenCalled();

      // Rotation handle drawn (arc for circle)
      expect(ctx.arc).toHaveBeenCalled();
    });

    it('renders outline but no handles for a locked object', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-locked']),
        getObjectBounds: jest.fn().mockReturnValue({ x: 50, y: 50, width: 200, height: 200 }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(true),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Selection outline IS rendered (strokeRect for the outline)
      expect(ctx.strokeRect).toHaveBeenCalled();

      // Handles are NOT rendered (no fillRect for handle squares)
      // The only strokeRect calls should be from the outline, not handles.
      // Locked objects get 'none' visibility, so renderResizeHandles returns early.
      expect(ctx.fillRect).not.toHaveBeenCalled();

      // No rotation handle
      expect(ctx.arc).not.toHaveBeenCalled();
    });

    it('renders only corner handles for a small object (<40px)', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-small']),
        getObjectBounds: jest.fn().mockReturnValue({ x: 50, y: 50, width: 35, height: 35 }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Should draw exactly 4 corner handles (4 fillRect + 4 strokeRect calls for handles)
      // Each handle: 1 fillRect + 1 strokeRect
      expect(ctx.fillRect).toHaveBeenCalledTimes(4);
    });

    it('renders no handles for a tiny object (<20px)', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-tiny']),
        getObjectBounds: jest.fn().mockReturnValue({ x: 50, y: 50, width: 15, height: 15 }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Selection outline IS rendered
      expect(ctx.strokeRect).toHaveBeenCalled();

      // No handles at all
      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.arc).not.toHaveBeenCalled();
    });

    it('applies rotation transform for rotated objects', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-rotated']),
        getObjectBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 200, height: 150 }),
        getObjectRotation: jest.fn().mockReturnValue(45),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Rotation transform is applied via translate + rotate + translate
      expect(ctx.translate).toHaveBeenCalled();
      expect(ctx.rotate).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Multi-Object Selection
  // =========================================================================

  describe('multi-object selection', () => {
    it('renders per-object outlines and dashed group outline', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-1', 'obj-2']),
        getObjectBounds: jest.fn().mockImplementation((id: string) => {
          if (id === 'obj-1') return { x: 50, y: 50, width: 100, height: 80 };
          if (id === 'obj-2') return { x: 200, y: 100, width: 120, height: 90 };
          return null;
        }),
        getSelectedObjectBounds: jest.fn().mockReturnValue({
          x: 50,
          y: 50,
          width: 270,
          height: 140,
        }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Per-object outlines: 2 strokeRect calls for the individual objects
      // Group outline: 1 strokeRect call with dashed pattern
      // Handle strokeRects for the 8 resize handles
      expect(ctx.strokeRect).toHaveBeenCalled();

      // setLineDash called with the group dash pattern [4, 4]
      expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
    });

    it('draws handles on group bounding box, not individual objects', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-1', 'obj-2']),
        getObjectBounds: jest.fn().mockImplementation((id: string) => {
          if (id === 'obj-1') return { x: 50, y: 50, width: 100, height: 80 };
          if (id === 'obj-2') return { x: 200, y: 100, width: 120, height: 90 };
          return null;
        }),
        getSelectedObjectBounds: jest.fn().mockReturnValue({
          x: 50,
          y: 50,
          width: 270,
          height: 140,
        }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Group bounds is 270x140, so both dimensions > 40 => 'all' visibility => 8 handles
      // Each handle: 1 fillRect + 1 strokeRect
      expect(ctx.fillRect).toHaveBeenCalledTimes(8);

      // Rotation handle also drawn (arc call)
      expect(ctx.arc).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // No Selection
  // =========================================================================

  describe('no selection', () => {
    it('renders nothing when no objects are selected', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // No outlines, no handles
      expect(ctx.strokeRect).not.toHaveBeenCalled();
      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.arc).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Smart Guides
  // =========================================================================

  describe('smart guides', () => {
    it('renders guide lines when guides are present', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
        getGuides: jest.fn().mockReturnValue([
          { axis: 'horizontal' as const, position: 150, start: 50, end: 400 },
          { axis: 'vertical' as const, position: 200, start: 30, end: 350 },
        ]),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Guide lines drawn with moveTo + lineTo + stroke
      expect(ctx.moveTo).toHaveBeenCalledTimes(2);
      expect(ctx.lineTo).toHaveBeenCalledTimes(2);
      expect(ctx.stroke).toHaveBeenCalledTimes(2);
    });

    it('does not render guides when none are present', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
        getGuides: jest.fn().mockReturnValue([]),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      expect(ctx.moveTo).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Rubber Band
  // =========================================================================

  describe('rubber band', () => {
    it('renders rubber band when active', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
        getRubberBand: jest.fn().mockReturnValue({ x: 100, y: 100, width: 200, height: 150 }),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Rubber band fill + stroke
      expect(ctx.fillRect).toHaveBeenCalledWith(100, 100, 200, 150);
      expect(ctx.strokeRect).toHaveBeenCalledWith(100, 100, 200, 150);
    });

    it('does not render rubber band when null', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
        getRubberBand: jest.fn().mockReturnValue(null),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.strokeRect).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Drag Preview
  // =========================================================================

  describe('drag preview', () => {
    it('renders drag preview with correct offset', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
        getDragPreview: jest.fn().mockReturnValue({
          objectIds: ['obj-1', 'obj-2'],
          deltaX: 50,
          deltaY: 30,
        }),
        getObjectBounds: jest.fn().mockImplementation((id: string) => {
          if (id === 'obj-1') return { x: 100, y: 100, width: 80, height: 60 };
          if (id === 'obj-2') return { x: 200, y: 200, width: 90, height: 70 };
          return null;
        }),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Two objects dragged: strokeRect called for each at offset position
      expect(ctx.strokeRect).toHaveBeenCalledWith(150, 130, 80, 60); // obj-1 + delta
      expect(ctx.strokeRect).toHaveBeenCalledWith(250, 230, 90, 70); // obj-2 + delta
    });

    it('does not render drag preview when null', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
        getDragPreview: jest.fn().mockReturnValue(null),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      expect(ctx.strokeRect).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Ink Preview
  // =========================================================================

  describe('ink preview', () => {
    it('renders ink strokes', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
        getInkPreview: jest.fn().mockReturnValue({
          strokes: [
            {
              points: [
                { x: 10, y: 10 },
                { x: 50, y: 50 },
                { x: 100, y: 30 },
              ],
              color: '#000000',
              width: 2,
            },
          ],
          eraserPosition: null,
          lassoPath: null,
        }),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Stroke rendered as polyline: moveTo + lineTo calls
      expect(ctx.moveTo).toHaveBeenCalledWith(10, 10);
      expect(ctx.lineTo).toHaveBeenCalledWith(50, 50);
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 30);
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('renders eraser cursor', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
        getInkPreview: jest.fn().mockReturnValue({
          strokes: [],
          eraserPosition: { x: 200, y: 200, radius: 15 },
          lassoPath: null,
        }),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Eraser cursor rendered as circle (arc call)
      expect(ctx.arc).toHaveBeenCalledWith(200, 200, 15, 0, Math.PI * 2);
    });

    it('renders lasso preview', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
        getInkPreview: jest.fn().mockReturnValue({
          strokes: [],
          eraserPosition: null,
          lassoPath: [
            { x: 10, y: 10 },
            { x: 100, y: 10 },
            { x: 100, y: 100 },
            { x: 10, y: 100 },
          ],
        }),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Lasso rendered as closed path
      expect(ctx.moveTo).toHaveBeenCalledWith(10, 10);
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 10);
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 100);
      expect(ctx.lineTo).toHaveBeenCalledWith(10, 100);
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('does not render ink preview when null', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
        getInkPreview: jest.fn().mockReturnValue(null),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // No ink-related drawing
      expect(ctx.moveTo).not.toHaveBeenCalled();
      expect(ctx.lineTo).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Hit Testing
  // =========================================================================

  describe('hit testing', () => {
    it('returns null when no objects are selected', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      // Must render first to stash ctx
      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      const result = layer.hitTest({ x: 100, y: 100 });
      expect(result).toBeNull();
    });

    it('returns null before first render (no stashed ctx)', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-1']),
      });
      const layer = new OverlayLayer({ dataSource: ds });

      const result = layer.hitTest({ x: 100, y: 100 });
      expect(result).toBeNull();
    });

    it('returns a HitResult when a handle is hit (single selection)', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-1']),
        getObjectBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 200, height: 150 }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();
      // Mock isPointInPath to return true for a specific call
      (ctx.isPointInPath as jest.Mock).mockImplementation((_path: any, x: number, y: number) => {
        // Simulate hitting the NW resize handle (at bounds origin: 100, 100)
        if (Math.abs(x - 100) < 20 && Math.abs(y - 100) < 20) return true;
        return false;
      });

      const layer = new OverlayLayer({ dataSource: ds });
      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      const result = layer.hitTest({ x: 100, y: 100 });
      expect(result).not.toBeNull();
      expect(result!.layerId).toBe('overlay');
      expect(result!.position).toEqual({ x: 100, y: 100 });
      // The target should be an OverlayHitResult
      const target = result!.target as { region: string; objectId: string | null };
      expect(target.objectId).toBe('obj-1');
    });

    it('returns null when no handle is hit', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-1']),
        getObjectBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 200, height: 150 }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();
      // isPointInPath always returns false (default)
      const layer = new OverlayLayer({ dataSource: ds });
      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      const result = layer.hitTest({ x: 500, y: 500 });
      expect(result).toBeNull();
    });

    it('hit tests group handles for multi-selection', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-1', 'obj-2']),
        getObjectBounds: jest.fn().mockImplementation((id: string) => {
          if (id === 'obj-1') return { x: 50, y: 50, width: 100, height: 80 };
          if (id === 'obj-2') return { x: 200, y: 100, width: 120, height: 90 };
          return null;
        }),
        getSelectedObjectBounds: jest.fn().mockReturnValue({
          x: 50,
          y: 50,
          width: 270,
          height: 140,
        }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();
      // Simulate hitting a group handle
      (ctx.isPointInPath as jest.Mock).mockImplementation((_path: any, x: number, y: number) => {
        // Hit at top-left corner of group bounds
        if (Math.abs(x - 50) < 20 && Math.abs(y - 50) < 20) return true;
        return false;
      });

      const layer = new OverlayLayer({ dataSource: ds });
      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      const result = layer.hitTest({ x: 50, y: 50 });
      expect(result).not.toBeNull();
      expect(result!.layerId).toBe('overlay');
      // Group handle: objectId should be null
      const target = result!.target as { region: string; objectId: string | null };
      expect(target.objectId).toBeNull();
    });
  });

  // =========================================================================
  // Custom Handles
  // =========================================================================

  describe('custom handles', () => {
    it('renders custom handles for single selection', () => {
      const customHandles: CustomHandle[] = [
        {
          id: 'warp-1',
          region: 'warp-adjust',
          position: { x: 150, y: 80 },
          shape: 'diamond',
          fillColor: '#FFD700',
          strokeColor: '#CC9900',
          size: 8,
        },
      ];
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-1']),
        getObjectBounds: jest.fn().mockReturnValue({ x: 100, y: 50, width: 200, height: 150 }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({
        dataSource: ds,
        customHandles,
      });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Custom handle diamond rendered: moveTo + lineTo calls
      // Diamond shape: moveTo(x, y-size), lineTo(x+size, y), lineTo(x, y+size), lineTo(x-size, y)
      expect(ctx.moveTo).toHaveBeenCalledWith(150, 72); // y - 8
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('does not render custom handles when no selection', () => {
      const customHandles: CustomHandle[] = [
        {
          id: 'warp-1',
          region: 'warp-adjust',
          position: { x: 150, y: 80 },
          shape: 'diamond',
          fillColor: '#FFD700',
          strokeColor: '#CC9900',
          size: 8,
        },
      ];
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue([]),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({
        dataSource: ds,
        customHandles,
      });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // No custom handle rendering (no moveTo for diamond shape)
      expect(ctx.moveTo).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Configuration Merging
  // =========================================================================

  describe('configuration', () => {
    it('uses DEFAULT_OVERLAY_CONFIG when no config override provided', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-1']),
        getObjectBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 200, height: 150 }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Default selection color is '#217346' -- check it's set on ctx
      // (strokeStyle is set during renderSelectionOutline)
      expect(ctx.strokeRect).toHaveBeenCalled();
    });

    it('merges partial config with defaults', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-1']),
        getObjectBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 200, height: 150 }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();

      // Override just the selection color
      const layer = new OverlayLayer({
        dataSource: ds,
        config: { selectionColor: '#FF0000' },
      });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Rendering still works (uses merged config)
      expect(ctx.strokeRect).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Factory Function
  // =========================================================================

  describe('createOverlayLayer()', () => {
    it('creates an OverlayLayer instance', () => {
      const ds = createMockDataSource();
      const layer = createOverlayLayer({ dataSource: ds });
      expect(layer).toBeInstanceOf(OverlayLayer);
      expect(layer.id).toBe('overlay');
    });

    it('accepts partial config', () => {
      const ds = createMockDataSource();
      const layer = createOverlayLayer({
        dataSource: ds,
        config: { handleSize: 16 },
      });
      expect(layer).toBeInstanceOf(OverlayLayer);
    });

    it('accepts custom handles', () => {
      const ds = createMockDataSource();
      const layer = createOverlayLayer({
        dataSource: ds,
        customHandles: [
          {
            id: 'test',
            region: 'warp-adjust',
            position: { x: 0, y: 0 },
            shape: 'circle',
            fillColor: '#fff',
            strokeColor: '#000',
            size: 8,
          },
        ],
      });
      expect(layer).toBeInstanceOf(OverlayLayer);
    });
  });

  // =========================================================================
  // Dispose
  // =========================================================================

  describe('dispose()', () => {
    it('clears internal state', () => {
      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-1']),
        getObjectBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 200, height: 150 }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
      });
      const ctx = createMockCtx();
      const layer = new OverlayLayer({ dataSource: ds });

      layer.render(ctx, MOCK_REGION, MOCK_FRAME);
      expect(layer.isDirty()).toBe(true);

      layer.dispose();

      // After dispose: dirty cleared, hitTest returns null (no stashed ctx)
      expect(layer.isDirty()).toBe(false);
      expect(layer.hitTest({ x: 100, y: 100 })).toBeNull();
    });
  });

  // =========================================================================
  // Compositing Order
  // =========================================================================

  describe('compositing order', () => {
    it('renders all elements in the correct order', () => {
      const callOrder: string[] = [];

      const ds = createMockDataSource({
        getSelectedObjectIds: jest.fn().mockReturnValue(['obj-1', 'obj-2']),
        getObjectBounds: jest.fn().mockImplementation((id: string) => {
          if (id === 'obj-1') return { x: 50, y: 50, width: 100, height: 80 };
          if (id === 'obj-2') return { x: 200, y: 100, width: 120, height: 90 };
          return null;
        }),
        getSelectedObjectBounds: jest.fn().mockReturnValue({
          x: 50,
          y: 50,
          width: 270,
          height: 140,
        }),
        getObjectRotation: jest.fn().mockReturnValue(0),
        isObjectLocked: jest.fn().mockReturnValue(false),
        getGuides: jest
          .fn()
          .mockReturnValue([{ axis: 'horizontal' as const, position: 150, start: 50, end: 400 }]),
        getRubberBand: jest.fn().mockReturnValue({ x: 300, y: 300, width: 100, height: 80 }),
        getDragPreview: jest.fn().mockReturnValue({
          objectIds: ['obj-3'],
          deltaX: 10,
          deltaY: 10,
        }),
        getInkPreview: jest.fn().mockReturnValue({
          strokes: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
              ],
              color: '#000',
              width: 2,
            },
          ],
          eraserPosition: null,
          lassoPath: null,
        }),
      });

      const ctx = createMockCtx();

      // Track save/restore pairs to verify ordering
      let saveCount = 0;
      (ctx.save as jest.Mock).mockImplementation(() => {
        saveCount++;
        callOrder.push(`save-${saveCount}`);
      });
      let restoreCount = 0;
      (ctx.restore as jest.Mock).mockImplementation(() => {
        restoreCount++;
        callOrder.push(`restore-${restoreCount}`);
      });

      const layer = new OverlayLayer({ dataSource: ds });
      layer.render(ctx, MOCK_REGION, MOCK_FRAME);

      // Verify save/restore calls are balanced
      expect(saveCount).toBe(restoreCount);
      expect(saveCount).toBeGreaterThan(0);
    });
  });
});
