/**
 * Unit Tests for useCursorManager Hook
 *
 * Tests cursor management functionality including:
 * - Cursor computation based on format painter, object interaction state
 * - Direct DOM manipulation for performance
 * - Stable callback references
 * - Utility functions for cursor styles
 *
 * @see use-cursor-manager.ts - Implementation
 */

import { jest } from '@jest/globals';

import { act, renderHook } from '@testing-library/react';

import type { ObjectHitRegion } from '@mog-sdk/contracts/floating-objects';
import {
  FORMAT_PAINTER_CURSOR,
  INK_ERASER_CURSOR,
  INK_HIGHLIGHTER_CURSOR,
  INK_PEN_CURSOR,
} from '../../../infra/styles/cursors';
import {
  CURSOR_STYLES,
  getCursorForDrag,
  getCursorForHitType,
  useCursorManager,
  type CursorManagerDeps,
} from '../use-cursor-manager';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock container element for testing DOM manipulation.
 */
function createMockContainer(): HTMLDivElement {
  const div = document.createElement('div');
  div.style.cursor = '';
  return div;
}

/**
 * Create mock object interaction state.
 */
function createMockObjectInteraction(
  overrides: Partial<CursorManagerDeps['objectInteraction']> = {},
): CursorManagerDeps['objectInteraction'] {
  return {
    isDragging: false,
    isResizing: false,
    isRotating: false,
    activeHandle: null,
    getCursor: jest.fn((handle: ObjectHitRegion | null) => {
      if (!handle) return '';
      switch (handle) {
        case 'resize-nw':
        case 'resize-se':
          return 'nwse-resize';
        case 'resize-ne':
        case 'resize-sw':
          return 'nesw-resize';
        case 'resize-n':
        case 'resize-s':
          return 'ns-resize';
        case 'resize-e':
        case 'resize-w':
          return 'ew-resize';
        case 'rotation':
          return 'crosshair';
        case 'body':
        case 'border':
          return 'move';
        default:
          return 'default';
      }
    }),
    ...overrides,
  };
}

/**
 * Create mock format painter state.
 */
function createMockFormatPainter(
  overrides: Partial<CursorManagerDeps['formatPainter']> = {},
): CursorManagerDeps['formatPainter'] {
  return {
    isActive: false,
    ...overrides,
  };
}

/**
 * Create mock ink state.
 */
function createMockInk(
  overrides: Partial<CursorManagerDeps['ink']> = {},
): CursorManagerDeps['ink'] {
  return {
    isActive: false,
    tool: 'pen',
    ...overrides,
  };
}

/**
 * Create full mock dependencies for the hook.
 */
function createMockDeps(overrides: Partial<CursorManagerDeps> = {}): CursorManagerDeps {
  const container = createMockContainer();
  return {
    containerRef: { current: container },
    formatPainter: createMockFormatPainter(),
    ink: createMockInk(),
    objectInteraction: createMockObjectInteraction(),
    ...overrides,
  };
}

// =============================================================================
// Hook Tests
// =============================================================================

describe('useCursorManager', () => {
  describe('Cursor Computation', () => {
    it('returns undefined cursor when no special state is active', () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useCursorManager(deps));

      expect(result.current.cursor).toBeUndefined();
    });

    it('returns format painter cursor when format painter is active', () => {
      const deps = createMockDeps({
        formatPainter: createMockFormatPainter({ isActive: true }),
      });
      const { result } = renderHook(() => useCursorManager(deps));

      expect(result.current.cursor).toBe(FORMAT_PAINTER_CURSOR);
    });

    it('returns grabbing cursor when object is being dragged', () => {
      const deps = createMockDeps({
        objectInteraction: createMockObjectInteraction({ isDragging: true }),
      });
      const { result } = renderHook(() => useCursorManager(deps));

      expect(result.current.cursor).toBe(CURSOR_STYLES.GRABBING);
    });

    it('returns resize cursor when object is being resized', () => {
      const mockGetCursor = jest.fn().mockReturnValue('nwse-resize');
      const deps = createMockDeps({
        objectInteraction: createMockObjectInteraction({
          isResizing: true,
          activeHandle: 'resize-se' as ObjectHitRegion,
          getCursor: mockGetCursor,
        }),
      });
      const { result } = renderHook(() => useCursorManager(deps));

      expect(result.current.cursor).toBe('nwse-resize');
      expect(mockGetCursor).toHaveBeenCalledWith('resize-se');
    });

    it('returns rotate cursor when object is being rotated', () => {
      const mockGetCursor = jest.fn().mockReturnValue('crosshair');
      const deps = createMockDeps({
        objectInteraction: createMockObjectInteraction({
          isRotating: true,
          activeHandle: 'rotation' as ObjectHitRegion,
          getCursor: mockGetCursor,
        }),
      });
      const { result } = renderHook(() => useCursorManager(deps));

      expect(result.current.cursor).toBe('crosshair');
      expect(mockGetCursor).toHaveBeenCalledWith('rotation');
    });

    it('format painter cursor takes priority over object dragging', () => {
      const deps = createMockDeps({
        formatPainter: createMockFormatPainter({ isActive: true }),
        objectInteraction: createMockObjectInteraction({ isDragging: true }),
      });
      const { result } = renderHook(() => useCursorManager(deps));

      expect(result.current.cursor).toBe(FORMAT_PAINTER_CURSOR);
    });

    it('returns ink pen cursor when ink mode is active with pen tool', () => {
      const deps = createMockDeps({
        ink: createMockInk({ isActive: true, tool: 'pen' }),
      });
      const { result } = renderHook(() => useCursorManager(deps));

      expect(result.current.cursor).toBe(INK_PEN_CURSOR);
    });

    it('returns ink highlighter cursor when ink mode is active with highlighter tool', () => {
      const deps = createMockDeps({
        ink: createMockInk({ isActive: true, tool: 'highlighter' }),
      });
      const { result } = renderHook(() => useCursorManager(deps));

      expect(result.current.cursor).toBe(INK_HIGHLIGHTER_CURSOR);
    });

    it('returns ink eraser cursor when ink mode is active with eraser tool', () => {
      const deps = createMockDeps({
        ink: createMockInk({ isActive: true, tool: 'eraser' }),
      });
      const { result } = renderHook(() => useCursorManager(deps));

      expect(result.current.cursor).toBe(INK_ERASER_CURSOR);
    });

    it('ink cursor takes priority over format painter', () => {
      const deps = createMockDeps({
        ink: createMockInk({ isActive: true, tool: 'pen' }),
        formatPainter: createMockFormatPainter({ isActive: true }),
      });
      const { result } = renderHook(() => useCursorManager(deps));

      expect(result.current.cursor).toBe(INK_PEN_CURSOR);
    });

    it('ink cursor takes priority over object dragging', () => {
      const deps = createMockDeps({
        ink: createMockInk({ isActive: true, tool: 'pen' }),
        objectInteraction: createMockObjectInteraction({ isDragging: true }),
      });
      const { result } = renderHook(() => useCursorManager(deps));

      expect(result.current.cursor).toBe(INK_PEN_CURSOR);
    });
  });

  describe('Direct DOM Manipulation', () => {
    it('updateCursor sets cursor directly on container', () => {
      const container = createMockContainer();
      const deps = createMockDeps({ containerRef: { current: container } });
      const { result } = renderHook(() => useCursorManager(deps));

      act(() => {
        result.current.updateCursor('pointer');
      });

      expect(container.style.cursor).toBe('pointer');
    });

    it('updateCursor does nothing when containerRef is null', () => {
      const deps = createMockDeps({ containerRef: { current: null } });
      const { result } = renderHook(() => useCursorManager(deps));

      // Should not throw
      expect(() => {
        act(() => {
          result.current.updateCursor('pointer');
        });
      }).not.toThrow();
    });

    it('updateCursorFromObjectHit updates cursor based on handle', () => {
      const container = createMockContainer();
      const mockGetCursor = jest.fn().mockReturnValue('nwse-resize');
      const deps = createMockDeps({
        containerRef: { current: container },
        objectInteraction: createMockObjectInteraction({ getCursor: mockGetCursor }),
      });
      const { result } = renderHook(() => useCursorManager(deps));

      act(() => {
        result.current.updateCursorFromObjectHit('resize-se' as ObjectHitRegion);
      });

      expect(container.style.cursor).toBe('nwse-resize');
      expect(mockGetCursor).toHaveBeenCalledWith('resize-se');
    });

    it('updateCursorFromObjectHit clears cursor when handle is null', () => {
      const container = createMockContainer();
      container.style.cursor = 'pointer'; // Set initial cursor
      const deps = createMockDeps({ containerRef: { current: container } });
      const { result } = renderHook(() => useCursorManager(deps));

      // First set a handle
      act(() => {
        result.current.updateCursorFromObjectHit('resize-se' as ObjectHitRegion);
      });

      // Then clear it
      act(() => {
        result.current.updateCursorFromObjectHit(null);
      });

      expect(container.style.cursor).toBe('');
    });

    it('updateCursorFromObjectHit only updates when handle changes', () => {
      const container = createMockContainer();
      const mockGetCursor = jest.fn().mockReturnValue('nwse-resize');
      const deps = createMockDeps({
        containerRef: { current: container },
        objectInteraction: createMockObjectInteraction({ getCursor: mockGetCursor }),
      });
      const { result } = renderHook(() => useCursorManager(deps));

      // Set handle first time
      act(() => {
        result.current.updateCursorFromObjectHit('resize-se' as ObjectHitRegion);
      });
      expect(mockGetCursor).toHaveBeenCalledTimes(1);

      // Set same handle again - should not call getCursor
      act(() => {
        result.current.updateCursorFromObjectHit('resize-se' as ObjectHitRegion);
      });
      expect(mockGetCursor).toHaveBeenCalledTimes(1);

      // Set different handle - should call getCursor
      act(() => {
        result.current.updateCursorFromObjectHit('resize-nw' as ObjectHitRegion);
      });
      expect(mockGetCursor).toHaveBeenCalledTimes(2);
    });

    it('resetCursor clears cursor and hoveredHandleRef', () => {
      const container = createMockContainer();
      const deps = createMockDeps({ containerRef: { current: container } });
      const { result } = renderHook(() => useCursorManager(deps));

      // Set a handle and cursor
      act(() => {
        result.current.updateCursorFromObjectHit('resize-se' as ObjectHitRegion);
        result.current.updateCursor('pointer');
      });

      // Reset
      act(() => {
        result.current.resetCursor();
      });

      expect(container.style.cursor).toBe('');
      expect(result.current.hoveredHandleRef.current).toBeNull();
    });
  });

  describe('Stable Callback References', () => {
    it('updateCursor maintains stable reference across renders', () => {
      const deps = createMockDeps();
      const { result, rerender } = renderHook(() => useCursorManager(deps));

      const callback1 = result.current.updateCursor;

      rerender();

      const callback2 = result.current.updateCursor;

      expect(callback1).toBe(callback2);
    });

    it('updateCursorFromObjectHit maintains stable reference across renders', () => {
      const deps = createMockDeps();
      const { result, rerender } = renderHook(() => useCursorManager(deps));

      const callback1 = result.current.updateCursorFromObjectHit;

      rerender();

      const callback2 = result.current.updateCursorFromObjectHit;

      expect(callback1).toBe(callback2);
    });

    it('resetCursor maintains stable reference across renders', () => {
      const deps = createMockDeps();
      const { result, rerender } = renderHook(() => useCursorManager(deps));

      const callback1 = result.current.resetCursor;

      rerender();

      const callback2 = result.current.resetCursor;

      expect(callback1).toBe(callback2);
    });
  });

  describe('hoveredHandleRef', () => {
    it('tracks hovered handle without causing re-renders', () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useCursorManager(deps));

      expect(result.current.hoveredHandleRef.current).toBeNull();

      // Update via updateCursorFromObjectHit
      act(() => {
        result.current.updateCursorFromObjectHit('resize-nw' as ObjectHitRegion);
      });

      expect(result.current.hoveredHandleRef.current).toBe('resize-nw');
    });
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('getCursorForHitType', () => {
  it('returns col-resize for columnResize', () => {
    expect(getCursorForHitType('columnResize')).toBe(CURSOR_STYLES.COL_RESIZE);
  });

  it('returns row-resize for rowResize', () => {
    expect(getCursorForHitType('rowResize')).toBe(CURSOR_STYLES.ROW_RESIZE);
  });

  it('returns crosshair for fillHandle without Ctrl', () => {
    expect(getCursorForHitType('fillHandle')).toBe(CURSOR_STYLES.CROSSHAIR);
  });

  it('returns copy for fillHandle with Ctrl', () => {
    expect(getCursorForHitType('fillHandle', { ctrlKey: true })).toBe(CURSOR_STYLES.COPY);
  });

  it('returns copy for fillHandle with Meta (Mac)', () => {
    expect(getCursorForHitType('fillHandle', { metaKey: true })).toBe(CURSOR_STYLES.COPY);
  });

  it('returns move for selectionBorder without Ctrl', () => {
    expect(getCursorForHitType('selectionBorder')).toBe(CURSOR_STYLES.MOVE);
  });

  it('returns copy for selectionBorder with Ctrl', () => {
    expect(getCursorForHitType('selectionBorder', { ctrlKey: true })).toBe(CURSOR_STYLES.COPY);
  });

  it('returns pointer for hyperlink', () => {
    expect(getCursorForHitType('hyperlink')).toBe(CURSOR_STYLES.POINTER);
  });

  it('returns pointer for validationDropdown', () => {
    expect(getCursorForHitType('validationDropdown')).toBe(CURSOR_STYLES.POINTER);
  });

  it('returns nwse-resize for tableResize', () => {
    expect(getCursorForHitType('tableResize')).toBe(CURSOR_STYLES.NWSE_RESIZE);
  });

  it('returns col-resize for hiddenColumnBoundary', () => {
    expect(getCursorForHitType('hiddenColumnBoundary')).toBe(CURSOR_STYLES.COL_RESIZE);
  });

  it('returns row-resize for hiddenRowBoundary', () => {
    expect(getCursorForHitType('hiddenRowBoundary')).toBe(CURSOR_STYLES.ROW_RESIZE);
  });
});

describe('getCursorForDrag', () => {
  it('returns empty string when not dragging', () => {
    expect(getCursorForDrag(false, true, false)).toBe(CURSOR_STYLES.DEFAULT);
  });

  it('returns not-allowed when target is invalid', () => {
    expect(getCursorForDrag(true, false, false)).toBe(CURSOR_STYLES.NOT_ALLOWED);
  });

  it('returns move for valid drag without Ctrl', () => {
    expect(getCursorForDrag(true, true, false)).toBe(CURSOR_STYLES.MOVE);
  });

  it('returns copy for valid drag with Ctrl', () => {
    expect(getCursorForDrag(true, true, true)).toBe(CURSOR_STYLES.COPY);
  });
});

// =============================================================================
// Performance Tests
// =============================================================================

describe('useCursorManager Performance', () => {
  it('direct DOM cursor updates are fast', () => {
    const container = createMockContainer();
    const deps = createMockDeps({ containerRef: { current: container } });
    const { result } = renderHook(() => useCursorManager(deps));

    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      result.current.updateCursor(i % 2 === 0 ? 'pointer' : 'default');
    }

    const duration = performance.now() - start;
    const avgTimePerUpdate = duration / iterations;

    console.log(`Direct DOM cursor update: ${avgTimePerUpdate.toFixed(4)}ms per update`);

    // Should be extremely fast (<0.1ms per update)
    expect(avgTimePerUpdate).toBeLessThan(0.1);
  });

  it('callback references do not change across multiple renders', () => {
    const deps = createMockDeps();
    const { result, rerender } = renderHook(() => useCursorManager(deps));

    const callbacks: Array<(cursorStyle: string) => void> = [];

    for (let i = 0; i < 10; i++) {
      callbacks.push(result.current.updateCursor);
      rerender();
    }

    // All callbacks should be the same reference
    const uniqueCallbacks = new Set(callbacks);
    expect(uniqueCallbacks.size).toBe(1);
  });
});

// =============================================================================
// CURSOR_STYLES Constants Tests
// =============================================================================

describe('CURSOR_STYLES', () => {
  it('exports expected cursor values', () => {
    expect(CURSOR_STYLES.DEFAULT).toBe('');
    expect(CURSOR_STYLES.GRABBING).toBe('grabbing');
    expect(CURSOR_STYLES.MOVE).toBe('move');
    expect(CURSOR_STYLES.COPY).toBe('copy');
    expect(CURSOR_STYLES.COL_RESIZE).toBe('col-resize');
    expect(CURSOR_STYLES.ROW_RESIZE).toBe('row-resize');
    expect(CURSOR_STYLES.CROSSHAIR).toBe('crosshair');
    expect(CURSOR_STYLES.POINTER).toBe('pointer');
    expect(CURSOR_STYLES.NOT_ALLOWED).toBe('not-allowed');
    expect(CURSOR_STYLES.NWSE_RESIZE).toBe('nwse-resize');
    expect(CURSOR_STYLES.NESW_RESIZE).toBe('nesw-resize');
  });
});
