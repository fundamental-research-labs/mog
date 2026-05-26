/**
 * Tests for scroll handling functions
 *
 * @module canvas/viewports/__tests__/scroll.test
 */

// Jest globals (describe, expect, it) are available globally
import { jest } from '@jest/globals';
import {
  applyScrollBehavior,
  applyScrollToViewports,
  clampScroll,
  computeMaxScroll,
  scrollToCell,
} from '../scroll';
import type { Point, ScrollBehavior, Viewport } from '../types';
import { DEFAULT_VIEWPORT_RENDER_CONFIG } from '../types';

// =============================================================================
// applyScrollBehavior Tests
// =============================================================================

describe('applyScrollBehavior', () => {
  const scrollPosition: Point = { x: 200, y: 150 };

  it('should return full scroll for "free" behavior', () => {
    const result = applyScrollBehavior(scrollPosition, { type: 'free' });
    expect(result).toEqual({ x: 200, y: 150 });
  });

  it('should return horizontal-only scroll for "horizontal-only" behavior', () => {
    const result = applyScrollBehavior(scrollPosition, { type: 'horizontal-only' });
    expect(result).toEqual({ x: 200, y: 0 });
  });

  it('should return vertical-only scroll for "vertical-only" behavior', () => {
    const result = applyScrollBehavior(scrollPosition, { type: 'vertical-only' });
    expect(result).toEqual({ x: 0, y: 150 });
  });

  it('should return zero scroll for "none" behavior', () => {
    const result = applyScrollBehavior(scrollPosition, { type: 'none' });
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('should follow linked viewport X axis', () => {
    const linkedViewport: Viewport = {
      id: 'linked-viewport',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      cellRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 10 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 300, y: 400 },
      scrollBehavior: { type: 'free' },
      zoom: 1.0,
      renderConfig: DEFAULT_VIEWPORT_RENDER_CONFIG,
    };

    const lookup = (id: string) => (id === 'linked-viewport' ? linkedViewport : undefined);

    const result = applyScrollBehavior(
      scrollPosition,
      { type: 'linked', viewportId: 'linked-viewport', axis: 'x' },
      lookup,
    );

    expect(result).toEqual({ x: 300, y: 0 });
  });

  it('should follow linked viewport Y axis', () => {
    const linkedViewport: Viewport = {
      id: 'linked-viewport',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      cellRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 10 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 300, y: 400 },
      scrollBehavior: { type: 'free' },
      zoom: 1.0,
      renderConfig: DEFAULT_VIEWPORT_RENDER_CONFIG,
    };

    const lookup = (id: string) => (id === 'linked-viewport' ? linkedViewport : undefined);

    const result = applyScrollBehavior(
      scrollPosition,
      { type: 'linked', viewportId: 'linked-viewport', axis: 'y' },
      lookup,
    );

    expect(result).toEqual({ x: 0, y: 400 });
  });

  it('should return zero for linked behavior without lookup', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = applyScrollBehavior(scrollPosition, {
      type: 'linked',
      viewportId: 'missing',
      axis: 'x',
    });

    expect(result).toEqual({ x: 0, y: 0 });
    expect(warnSpy).toHaveBeenCalledWith(
      'applyScrollBehavior: linked viewport lookup not provided',
    );
    warnSpy.mockRestore();
  });

  it('should return zero for linked behavior with missing viewport', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const lookup = () => undefined;

    const result = applyScrollBehavior(
      scrollPosition,
      { type: 'linked', viewportId: 'missing', axis: 'x' },
      lookup,
    );

    expect(result).toEqual({ x: 0, y: 0 });
    expect(warnSpy).toHaveBeenCalledWith(
      'applyScrollBehavior: linked viewport "missing" not found',
    );
    warnSpy.mockRestore();
  });
});

// =============================================================================
// clampScroll Tests
// =============================================================================

describe('clampScroll', () => {
  it('should not modify scroll within bounds', () => {
    const result = clampScroll({ x: 100, y: 100 }, { x: 200, y: 200 });
    expect(result).toEqual({ x: 100, y: 100 });
  });

  it('should clamp scroll exceeding max', () => {
    const result = clampScroll({ x: 300, y: 400 }, { x: 200, y: 200 });
    expect(result).toEqual({ x: 200, y: 200 });
  });

  it('should clamp negative scroll to zero', () => {
    const result = clampScroll({ x: -50, y: -100 }, { x: 200, y: 200 });
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('should handle zero max scroll', () => {
    const result = clampScroll({ x: 100, y: 100 }, { x: 0, y: 0 });
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('should clamp each axis independently', () => {
    const result = clampScroll({ x: -10, y: 500 }, { x: 200, y: 200 });
    expect(result).toEqual({ x: 0, y: 200 });
  });
});

// =============================================================================
// computeMaxScroll Tests
// =============================================================================

describe('computeMaxScroll', () => {
  it('should compute max scroll from content and viewport size', () => {
    const result = computeMaxScroll({ width: 2000, height: 5000 }, { width: 800, height: 600 });
    expect(result).toEqual({ x: 1200, y: 4400 });
  });

  it('should account for frozen size', () => {
    const result = computeMaxScroll(
      { width: 2000, height: 5000 },
      { width: 800, height: 600 },
      { width: 200, height: 100 },
    );
    // Scrollable width = 800 - 200 = 600
    // Max scroll X = 2000 - 600 = 1400
    // Scrollable height = 600 - 100 = 500
    // Max scroll Y = 5000 - 500 = 4500
    expect(result).toEqual({ x: 1400, y: 4500 });
  });

  it('should return zero when content fits in viewport', () => {
    const result = computeMaxScroll({ width: 500, height: 400 }, { width: 800, height: 600 });
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('should not return negative max scroll', () => {
    const result = computeMaxScroll({ width: 100, height: 100 }, { width: 800, height: 600 });
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// scrollToCell Tests
// =============================================================================

describe('scrollToCell', () => {
  const viewportSize = { width: 800, height: 600 };
  const frozenSize = { width: 0, height: 0 };

  it('should return null if cell is already visible', () => {
    const cellRect = { x: 100, y: 100, width: 100, height: 25 };
    const result = scrollToCell(cellRect, { x: 0, y: 0 }, viewportSize, frozenSize);
    expect(result).toBeNull();
  });

  it('should scroll right to see cell off right edge', () => {
    const cellRect = { x: 900, y: 100, width: 100, height: 25 };
    const result = scrollToCell(cellRect, { x: 0, y: 0 }, viewportSize, frozenSize, 20);
    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThan(0);
    expect(result!.y).toBe(0);
  });

  it('should scroll left to see cell off left edge', () => {
    const cellRect = { x: 50, y: 100, width: 100, height: 25 };
    const result = scrollToCell(cellRect, { x: 200, y: 0 }, viewportSize, frozenSize, 20);
    expect(result).not.toBeNull();
    expect(result!.x).toBeLessThan(200);
  });

  it('should scroll down to see cell off bottom edge', () => {
    const cellRect = { x: 100, y: 700, width: 100, height: 25 };
    const result = scrollToCell(cellRect, { x: 0, y: 0 }, viewportSize, frozenSize, 20);
    expect(result).not.toBeNull();
    expect(result!.y).toBeGreaterThan(0);
  });

  it('should scroll up to see cell off top edge', () => {
    const cellRect = { x: 100, y: 50, width: 100, height: 25 };
    const result = scrollToCell(cellRect, { x: 0, y: 200 }, viewportSize, frozenSize, 20);
    expect(result).not.toBeNull();
    expect(result!.y).toBeLessThan(200);
  });

  it('should account for frozen regions', () => {
    const cellRect = { x: 300, y: 200, width: 100, height: 25 };
    const frozenWithSize = { width: 200, height: 100 };
    const result = scrollToCell(cellRect, { x: 0, y: 0 }, viewportSize, frozenWithSize, 20);
    // Cell is at x=300, frozen width is 200
    // Cell's scrollable position is 300 - 200 = 100
    // Should be visible without scrolling
    expect(result).toBeNull();
  });

  it('should apply padding when scrolling', () => {
    const cellRect = { x: 850, y: 100, width: 100, height: 25 };
    const padding = 50;
    const result = scrollToCell(cellRect, { x: 0, y: 0 }, viewportSize, frozenSize, padding);
    expect(result).not.toBeNull();
    // The cell should be visible with padding from the edge
  });
});

// =============================================================================
// applyScrollToViewports Tests
// =============================================================================

describe('applyScrollToViewports', () => {
  const createViewport = (
    id: string,
    scrollBehavior: ScrollBehavior,
    scrollOffset: Point = { x: 0, y: 0 },
  ): Viewport => ({
    id,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    cellRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 10 },
    viewportOrigin: { x: 0, y: 0 },
    scrollOffset,
    scrollBehavior,
    zoom: 1.0,
    renderConfig: DEFAULT_VIEWPORT_RENDER_CONFIG,
  });

  it('should apply scroll behavior to all viewports', () => {
    const viewports: Viewport[] = [
      createViewport('main', { type: 'free' }),
      createViewport('frozen-rows', { type: 'horizontal-only' }),
      createViewport('frozen-cols', { type: 'vertical-only' }),
      createViewport('corner', { type: 'none' }),
    ];

    const scrollPosition: Point = { x: 200, y: 150 };
    const result = applyScrollToViewports(viewports, scrollPosition);

    expect(result.find((v) => v.id === 'main')?.scrollOffset).toEqual({ x: 200, y: 150 });
    expect(result.find((v) => v.id === 'frozen-rows')?.scrollOffset).toEqual({ x: 200, y: 0 });
    expect(result.find((v) => v.id === 'frozen-cols')?.scrollOffset).toEqual({ x: 0, y: 150 });
    expect(result.find((v) => v.id === 'corner')?.scrollOffset).toEqual({ x: 0, y: 0 });
  });

  it('should handle linked scroll behavior', () => {
    const mainViewport = createViewport('main', { type: 'free' }, { x: 300, y: 400 });
    const linkedViewport = createViewport('linked', {
      type: 'linked',
      viewportId: 'main',
      axis: 'x',
    });

    const viewports: Viewport[] = [mainViewport, linkedViewport];
    const scrollPosition: Point = { x: 300, y: 400 };

    const result = applyScrollToViewports(viewports, scrollPosition);

    // Main viewport gets full scroll
    expect(result.find((v) => v.id === 'main')?.scrollOffset).toEqual({ x: 300, y: 400 });

    // Linked viewport follows main's X
    expect(result.find((v) => v.id === 'linked')?.scrollOffset).toEqual({ x: 300, y: 0 });
  });

  it('should preserve other viewport properties', () => {
    const viewport: Viewport = {
      id: 'test',
      bounds: { x: 50, y: 24, width: 800, height: 600 },
      cellRange: { startRow: 5, startCol: 2, endRow: 30, endCol: 15 },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      scrollBehavior: { type: 'free' },
      sheetId: 'sheet1',
      zoom: 1.5,
      renderConfig: {
        ...DEFAULT_VIEWPORT_RENDER_CONFIG,
        backgroundColor: '#f0f0f0',
      },
    };

    const result = applyScrollToViewports([viewport], { x: 100, y: 50 });

    expect(result[0].bounds).toEqual(viewport.bounds);
    expect(result[0].cellRange).toEqual(viewport.cellRange);
    expect(result[0].sheetId).toBe('sheet1');
    expect(result[0].zoom).toBe(1.5);
    expect(result[0].renderConfig.backgroundColor).toBe('#f0f0f0');
  });
});
