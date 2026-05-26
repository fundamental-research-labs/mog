/**
 * Tests for canvas overlay rendering modules:
 * - Smart Guides
 * - Rubber Band
 * - Drag Preview
 * - Ink Preview
 */

import { jest } from '@jest/globals';

import { renderDragPreview } from '../drag-preview';
import {
  renderEraserCursor,
  renderInkPreview,
  renderInkStrokePreview,
  renderLassoPreview,
} from '../ink-preview';
import { renderRubberBand } from '../rubber-band';
import { renderSmartGuides } from '../smart-guides';

// =============================================================================
// Mock CanvasRenderingContext2D
// =============================================================================

function createMockContext(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {
    // State
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    lineCap: 'butt',
    lineJoin: 'miter',

    // Methods
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    arc: jest.fn(),
    closePath: jest.fn(),
    setLineDash: jest.fn(),
    strokeRect: jest.fn(),
    fillRect: jest.fn(),
  };

  return ctx as unknown as CanvasRenderingContext2D;
}

// =============================================================================
// Smart Guides Tests
// =============================================================================

describe('renderSmartGuides', () => {
  let ctx: CanvasRenderingContext2D;
  const config = { guideColor: '#FF00FF', guideLineWidth: 1 };

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should not draw anything for empty guides array', () => {
    renderSmartGuides(ctx, [], config);

    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('should draw a horizontal guide line at the correct position', () => {
    const guides = [{ axis: 'horizontal' as const, position: 100, start: 50, end: 200 }];

    renderSmartGuides(ctx, guides, config);

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledWith(50, 100);
    expect(ctx.lineTo).toHaveBeenCalledWith(200, 100);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('should draw a vertical guide line at the correct position', () => {
    const guides = [{ axis: 'vertical' as const, position: 150, start: 20, end: 300 }];

    renderSmartGuides(ctx, guides, config);

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledWith(150, 20);
    expect(ctx.lineTo).toHaveBeenCalledWith(150, 300);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('should draw multiple guides', () => {
    const guides = [
      { axis: 'horizontal' as const, position: 100, start: 50, end: 200 },
      { axis: 'vertical' as const, position: 150, start: 20, end: 300 },
      { axis: 'horizontal' as const, position: 250, start: 10, end: 400 },
    ];

    renderSmartGuides(ctx, guides, config);

    expect(ctx.beginPath).toHaveBeenCalledTimes(3);
    expect(ctx.stroke).toHaveBeenCalledTimes(3);

    // First guide: horizontal at y=100
    expect(ctx.moveTo).toHaveBeenNthCalledWith(1, 50, 100);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(1, 200, 100);

    // Second guide: vertical at x=150
    expect(ctx.moveTo).toHaveBeenNthCalledWith(2, 150, 20);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(2, 150, 300);

    // Third guide: horizontal at y=250
    expect(ctx.moveTo).toHaveBeenNthCalledWith(3, 10, 250);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(3, 400, 250);
  });

  it('should use config for color and line width', () => {
    const customConfig = { guideColor: '#00FF00', guideLineWidth: 2 };
    const guides = [{ axis: 'horizontal' as const, position: 100, start: 0, end: 100 }];

    renderSmartGuides(ctx, guides, customConfig);

    expect(ctx.strokeStyle).toBe('#00FF00');
    expect(ctx.lineWidth).toBe(2);
  });

  it('should set solid line dash (no dash pattern) for guides', () => {
    const guides = [{ axis: 'vertical' as const, position: 50, start: 0, end: 100 }];

    renderSmartGuides(ctx, guides, config);

    expect(ctx.setLineDash).toHaveBeenCalledWith([]);
  });
});

// =============================================================================
// Rubber Band Tests
// =============================================================================

describe('renderRubberBand', () => {
  let ctx: CanvasRenderingContext2D;
  const config = {
    rubberBandBorderColor: '#217346',
    rubberBandFillColor: 'rgba(33,115,70,0.1)',
  };

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should render fill and dashed stroke', () => {
    const bounds = { x: 10, y: 20, width: 100, height: 50 };

    renderRubberBand(ctx, bounds, config);

    expect(ctx.save).toHaveBeenCalledTimes(1);

    // Fill
    expect(ctx.fillStyle).toBe('rgba(33,115,70,0.1)');
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 100, 50);

    // Stroke (dashed)
    expect(ctx.strokeStyle).toBe('#217346');
    expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
    expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 100, 50);

    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('should handle zero-size bounds', () => {
    const bounds = { x: 50, y: 50, width: 0, height: 0 };

    renderRubberBand(ctx, bounds, config);

    expect(ctx.fillRect).toHaveBeenCalledWith(50, 50, 0, 0);
    expect(ctx.strokeRect).toHaveBeenCalledWith(50, 50, 0, 0);
  });
});

// =============================================================================
// Drag Preview Tests
// =============================================================================

describe('renderDragPreview', () => {
  let ctx: CanvasRenderingContext2D;
  const config = { selectionColor: '#217346', dragPreviewOpacity: 0.5 };

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should not render for empty objectIds', () => {
    renderDragPreview(ctx, { objectIds: [], deltaX: 10, deltaY: 20 }, () => null, config);

    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('should render dashed outline offset by delta', () => {
    const getObjectBounds = jest.fn().mockReturnValue({
      x: 100,
      y: 200,
      width: 50,
      height: 30,
    });

    renderDragPreview(
      ctx,
      { objectIds: ['obj-1'], deltaX: 15, deltaY: -10 },
      getObjectBounds,
      config,
    );

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.globalAlpha).toBe(0.5);
    expect(ctx.strokeStyle).toBe('#217346');
    expect(ctx.setLineDash).toHaveBeenCalledWith([5, 5]);

    // Original bounds (100,200) + delta (15,-10) = (115, 190)
    expect(ctx.strokeRect).toHaveBeenCalledWith(115, 190, 50, 30);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('should render multiple objects', () => {
    const boundsMap: Record<string, { x: number; y: number; width: number; height: number }> = {
      'obj-1': { x: 0, y: 0, width: 100, height: 100 },
      'obj-2': { x: 200, y: 200, width: 50, height: 50 },
    };

    const getObjectBounds = jest.fn((id: string) => boundsMap[id] ?? null);

    renderDragPreview(
      ctx,
      { objectIds: ['obj-1', 'obj-2'], deltaX: 10, deltaY: 10 },
      getObjectBounds,
      config,
    );

    expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
    expect(ctx.strokeRect).toHaveBeenNthCalledWith(1, 10, 10, 100, 100);
    expect(ctx.strokeRect).toHaveBeenNthCalledWith(2, 210, 210, 50, 50);
  });

  it('should skip objects with no bounds', () => {
    const getObjectBounds = jest.fn().mockReturnValue(null);

    renderDragPreview(
      ctx,
      { objectIds: ['missing-obj'], deltaX: 10, deltaY: 10 },
      getObjectBounds,
      config,
    );

    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Ink Stroke Preview Tests
// =============================================================================

describe('renderInkStrokePreview', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should not render for empty strokes', () => {
    renderInkStrokePreview(ctx, []);

    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('should render single-point stroke as a dot', () => {
    const strokes = [
      {
        points: [{ x: 50, y: 60 }],
        color: '#000000',
        width: 4,
      },
    ];

    renderInkStrokePreview(ctx, strokes);

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe('#000000');
    expect(ctx.arc).toHaveBeenCalledWith(50, 60, 2, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('should render multi-point stroke as polyline', () => {
    const strokes = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 5 },
        ],
        color: '#FF0000',
        width: 3,
      },
    ];

    renderInkStrokePreview(ctx, strokes);

    expect(ctx.strokeStyle).toBe('#FF0000');
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.lineCap).toBe('round');
    expect(ctx.lineJoin).toBe('round');
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(10, 10);
    expect(ctx.lineTo).toHaveBeenCalledWith(20, 5);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it('should render pressure-sensitive strokes segment by segment', () => {
    const strokes = [
      {
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 1.0 },
          { x: 20, y: 5, pressure: 0.8 },
        ],
        color: '#0000FF',
        width: 4,
      },
    ];

    renderInkStrokePreview(ctx, strokes);

    // Should draw 2 segments (between 3 points)
    // Segment 1: pressure avg = (0.5 + 1.0) / 2 = 0.75, width = 4 * 0.75 = 3
    // Segment 2: pressure avg = (1.0 + 0.8) / 2 = 0.9, width = 4 * 0.9 = 3.6
    expect(ctx.beginPath).toHaveBeenCalledTimes(2);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });

  it('should render single-point stroke with pressure', () => {
    const strokes = [
      {
        points: [{ x: 25, y: 30, pressure: 0.5 }],
        color: '#000000',
        width: 6,
      },
    ];

    renderInkStrokePreview(ctx, strokes);

    // radius = (6 / 2) * 0.5 = 1.5
    expect(ctx.arc).toHaveBeenCalledWith(25, 30, 1.5, 0, Math.PI * 2);
  });
});

// =============================================================================
// Eraser Cursor Tests
// =============================================================================

describe('renderEraserCursor', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should render dashed circle at position', () => {
    renderEraserCursor(ctx, { x: 100, y: 150, radius: 20 });

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.strokeStyle).toBe('#666666');
    expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
    expect(ctx.arc).toHaveBeenCalledWith(100, 150, 20, 0, Math.PI * 2);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('should render inner circle with lower opacity', () => {
    renderEraserCursor(ctx, { x: 50, y: 50, radius: 10 });

    // Two arc calls: outer dashed + inner solid
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    // Second arc should have lower opacity
    expect(ctx.globalAlpha).toBe(0.3);
    // Inner circle has solid line
    expect(ctx.setLineDash).toHaveBeenCalledWith([]);
  });
});

// =============================================================================
// Lasso Preview Tests
// =============================================================================

describe('renderLassoPreview', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should not render for paths with fewer than 2 points', () => {
    renderLassoPreview(ctx, []);
    expect(ctx.save).not.toHaveBeenCalled();

    renderLassoPreview(ctx, [{ x: 10, y: 20 }]);
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('should render closed polygon with fill and dashed stroke', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];

    renderLassoPreview(ctx, path);

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 100);
    expect(ctx.lineTo).toHaveBeenCalledWith(0, 100);
    expect(ctx.closePath).toHaveBeenCalled();

    // Fill
    expect(ctx.fillStyle).toBe('rgba(33,115,70,0.1)');
    expect(ctx.fill).toHaveBeenCalled();

    // Dashed stroke
    expect(ctx.strokeStyle).toBe('#217346');
    expect(ctx.setLineDash).toHaveBeenCalledWith([5, 3]);
    expect(ctx.stroke).toHaveBeenCalled();

    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Combined Ink Preview Tests
// =============================================================================

describe('renderInkPreview', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should render all active ink elements', () => {
    const preview = {
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
      eraserPosition: { x: 50, y: 50, radius: 15 },
      lassoPath: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    };

    renderInkPreview(ctx, preview);

    // Should have called save/restore multiple times (once per sub-renderer)
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();

    // Stroke polyline should be drawn
    expect(ctx.moveTo).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();

    // Eraser circle should be drawn
    expect(ctx.arc).toHaveBeenCalled();

    // Lasso fill should be drawn
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('should handle preview with no active elements', () => {
    const preview = {
      strokes: [],
      eraserPosition: null,
      lassoPath: null,
    };

    renderInkPreview(ctx, preview);

    // Nothing should be drawn
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('should render only strokes when eraser and lasso are inactive', () => {
    const preview = {
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
    };

    renderInkPreview(ctx, preview);

    // Should draw the stroke
    expect(ctx.stroke).toHaveBeenCalled();
    // Should not draw eraser circle
    // arc is only called during stroke rendering (not called at all for polylines)
    // so we just verify save was called once (from renderInkStrokePreview)
    expect(ctx.save).toHaveBeenCalledTimes(1);
  });

  it('should render only eraser when strokes and lasso are inactive', () => {
    const preview = {
      strokes: [],
      eraserPosition: { x: 75, y: 75, radius: 25 },
      lassoPath: null,
    };

    renderInkPreview(ctx, preview);

    // Eraser circle should be drawn
    expect(ctx.arc).toHaveBeenCalledWith(75, 75, 25, 0, Math.PI * 2);
  });
});
