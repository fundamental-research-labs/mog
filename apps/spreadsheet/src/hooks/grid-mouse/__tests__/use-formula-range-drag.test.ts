/**
 * Tests for useFormulaRangeDrag Hook
 *
 * Tests the formula range drag functionality used for editing formula references
 * by dragging range boxes during formula editing (C.3/H.3 feature).
 *
 * @see ../use-formula-range-drag.ts
 */

import { jest } from '@jest/globals';

import type { CoordinateSystem } from '@mog-sdk/contracts/rendering';
import { sheetId } from '@mog-sdk/contracts/core';
import type { ISheetViewGeometry, ISheetViewViewport } from '@mog-sdk/sheet-view';
import { act, renderHook } from '@testing-library/react';
import { createMockCoordinateSystem as createSharedMockCoordinateSystem } from '../../../systems/testing-foundation/mock-coordinate-system';
import { useFormulaRangeDrag, type UseFormulaRangeDragOptions } from '../use-formula-range-drag';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock coordinate system for testing.
 * Uses shared mock with 100px columns and 25px rows to match test expectations.
 */
function createMockCoordinateSystem(scrollLeft = 0, scrollTop = 0): CoordinateSystem {
  const coordSystem = createSharedMockCoordinateSystem({
    cellWidth: 100,
    cellHeight: 25,
    totalRows: 1000,
    totalCols: 260,
    viewportWidth: 1000,
    viewportHeight: 600,
  });
  // Disable header offsets so viewport coordinates map directly to document coordinates,
  // matching the original test expectations (e.g., click at (50,12) → cell A1).
  coordSystem.setHeaderVisibility({ showRowHeaders: false, showColumnHeaders: false });
  coordSystem.setViewport({ scrollLeft, scrollTop, width: 1000, height: 600 });
  return coordSystem;
}

function createMockSheetViewCapabilities(
  scrollLeft = 0,
  scrollTop = 0,
): {
  geometry: ISheetViewGeometry;
  viewport: ISheetViewViewport;
} {
  const coordSystem = createMockCoordinateSystem(scrollLeft, scrollTop);

  const geometry = {
    fromViewportPoint: (point: { x: number; y: number }) =>
      coordSystem.viewportToCell(
        'test-sheet',
        point as Parameters<CoordinateSystem['viewportToCell']>[1],
      ),
    getPositionDimensions: () => coordSystem.getViewportPositionIndex(),
    getCellAreaOffset: () => ({ x: 0, y: 0 }),
  } as unknown as ISheetViewGeometry;

  const viewport = {
    getScrollPosition: () => {
      const viewport = coordSystem.getViewport();
      return { x: viewport.scrollLeft, y: viewport.scrollTop };
    },
  } as unknown as ISheetViewViewport;

  return { geometry, viewport };
}

/**
 * Create mock hook options with default values.
 */
function createMockOptions(
  overrides: Partial<UseFormulaRangeDragOptions> = {},
): UseFormulaRangeDragOptions {
  const mockContainer = document.createElement('div');
  const { geometry, viewport } = createMockSheetViewCapabilities();

  return {
    activeSheetId: sheetId('test-sheet'),
    getEditorState: () => ({
      isFormulaEditing: false,
      value: '',
    }),
    getActiveSheetName: () => 'Sheet1',
    onUpdateFormulaRange: jest.fn(),
    getGeometry: () => geometry,
    getViewport: () => viewport,
    getCellIdAtPosition: (row: number, col: number) => `cell-${row}-${col}`,
    containerRef: { current: mockContainer },
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('useFormulaRangeDrag', () => {
  describe('initial state', () => {
    it('should not be dragging initially', () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      expect(result.current.isFormulaRangeDragging()).toBe(false);
      expect(result.current.formulaRangeDragRef.current).toBeNull();
      expect(result.current.getCurrentDragState()).toBeNull();
    });
  });

  describe('tryStartFormulaRangeDrag', () => {
    it('should return false when not formula editing', () => {
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: false, value: '' }),
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      let started: boolean = false;
      act(() => {
        started = result.current.tryStartFormulaRangeDrag(50, 12);
      });

      expect(started).toBe(false);
      expect(result.current.isFormulaRangeDragging()).toBe(false);
    });

    it('should return false when formula does not start with =', () => {
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: 'A1' }),
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      let started: boolean = false;
      act(() => {
        started = result.current.tryStartFormulaRangeDrag(50, 12);
      });

      expect(started).toBe(false);
    });

    it('should return false when formula has no ranges', () => {
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=1+2' }),
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      let started: boolean = false;
      act(() => {
        started = result.current.tryStartFormulaRangeDrag(50, 12);
      });

      expect(started).toBe(false);
    });

    it('should return false when click is not on a range box', () => {
      // Formula =A1 creates a range at A1 (row=0, col=0)
      // With 100px columns and 25px rows, A1 is at x=0-100, y=0-25
      // Click at x=500 is well outside the range box
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=A1' }),
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      let started: boolean = false;
      act(() => {
        started = result.current.tryStartFormulaRangeDrag(500, 500);
      });

      expect(started).toBe(false);
    });

    it('should start drag when clicking on a range box center', () => {
      // Formula =A1 creates a range at A1 (row=0, col=0)
      // With 100px columns and 25px rows, A1 center is at approximately x=50, y=12
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=A1' }),
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      let started: boolean = false;
      act(() => {
        // Click in the center of cell A1
        started = result.current.tryStartFormulaRangeDrag(50, 12);
      });

      expect(started).toBe(true);
      expect(result.current.isFormulaRangeDragging()).toBe(true);

      const dragState = result.current.getCurrentDragState();
      expect(dragState).not.toBeNull();
      expect(dragState?.originalRange).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      });
      expect(dragState?.hitResult.handleType).toBe('center');
    });

    it('should return false for a cross-sheet range box when active sheet differs', () => {
      // Formula =Sheet2!A1 has a range at A1 (row=0, col=0) but belongs to Sheet2.
      // When the active sheet is Sheet1 (not Sheet2), clicking at A1 coordinates
      // should NOT start a drag — the cross-sheet box must not intercept the click.
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=Sheet2!A1' }),
        getActiveSheetName: () => 'Sheet1',
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      let started: boolean = false;
      act(() => {
        // Click at A1 center — same pixel coordinates as Sheet2!A1 range box
        started = result.current.tryStartFormulaRangeDrag(50, 12);
      });

      expect(started).toBe(false);
    });

    it('should start drag for same-sheet ref regardless of other cross-sheet refs', () => {
      // Formula =Sheet2!A1+B2: Sheet2!A1 belongs to Sheet2, B2 belongs to Sheet1.
      // When active sheet is Sheet1, clicking at B2 (col=1, row=1 -> x=150, y=37)
      // should start a drag for B2 and must not be blocked by Sheet2!A1.
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=Sheet2!A1+B2' }),
        getActiveSheetName: () => 'Sheet1',
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      let started: boolean = false;
      act(() => {
        started = result.current.tryStartFormulaRangeDrag(150, 37);
      });

      expect(started).toBe(true);
      const dragState = result.current.getCurrentDragState();
      expect(dragState).not.toBeNull();
      // B2 is row=1, col=1
      expect(dragState?.originalRange).toEqual({
        startRow: 1,
        startCol: 1,
        endRow: 1,
        endCol: 1,
      });
    });

    it('should update cursor when starting drag', () => {
      const mockContainer = document.createElement('div');
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=A1' }),
        containerRef: { current: mockContainer },
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      act(() => {
        result.current.tryStartFormulaRangeDrag(50, 12);
      });

      // Center handle should set move cursor
      expect(mockContainer.style.cursor).toBe('move');
    });
  });

  describe('moveFormulaRangeDrag', () => {
    it('should do nothing when not dragging', () => {
      const options = createMockOptions();
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      act(() => {
        result.current.moveFormulaRangeDrag(200, 100);
      });

      expect(result.current.getCurrentDragState()).toBeNull();
    });

    it('should update currentRange when dragging', () => {
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=A1' }),
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      // Start drag at A1 center
      act(() => {
        result.current.tryStartFormulaRangeDrag(50, 12);
      });

      // Move to B2 (col=1, row=1 -> x=150, y=37)
      act(() => {
        result.current.moveFormulaRangeDrag(150, 37);
      });

      const dragState = result.current.getCurrentDragState();
      expect(dragState).not.toBeNull();
      // Center drag on a single-cell reference expands to include the target cell
      // Original was A1 (0,0)-(0,0), dragging to B2 should expand to A1:B2
      expect(dragState?.currentRange).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      });
      // Original range should be unchanged
      expect(dragState?.originalRange).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      });
    });
  });

  describe('endFormulaRangeDrag', () => {
    it('should do nothing when not dragging', () => {
      const onUpdateFormulaRange = jest.fn();
      const options = createMockOptions({ onUpdateFormulaRange });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      act(() => {
        result.current.endFormulaRangeDrag();
      });

      expect(onUpdateFormulaRange).not.toHaveBeenCalled();
    });

    it('should not call onUpdateFormulaRange when range did not change', () => {
      const onUpdateFormulaRange = jest.fn();
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=A1' }),
        onUpdateFormulaRange,
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      // Start and immediately end drag without moving
      act(() => {
        result.current.tryStartFormulaRangeDrag(50, 12);
      });

      act(() => {
        result.current.endFormulaRangeDrag();
      });

      expect(onUpdateFormulaRange).not.toHaveBeenCalled();
      expect(result.current.isFormulaRangeDragging()).toBe(false);
    });

    it('should call onUpdateFormulaRange when range changed', async () => {
      const onUpdateFormulaRange = jest.fn();
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=A1' }),
        onUpdateFormulaRange,
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      // Start drag at A1
      act(() => {
        result.current.tryStartFormulaRangeDrag(50, 12);
      });

      // Move to B2
      act(() => {
        result.current.moveFormulaRangeDrag(150, 37);
      });

      // End drag
      act(() => {
        result.current.endFormulaRangeDrag();
      });

      // Flush async IIFE inside endFormulaRangeDrag (getCellIdAtPosition may be async)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(onUpdateFormulaRange).toHaveBeenCalledTimes(1);
      expect(onUpdateFormulaRange).toHaveBeenCalledWith(
        0, // rangeIndex
        'cell-0-0', // startCellId (A1 - anchored for single-cell expansion)
        'cell-1-1', // endCellId (B2)
      );
      expect(result.current.isFormulaRangeDragging()).toBe(false);
    });

    it('should reset cursor when drag ends', () => {
      const mockContainer = document.createElement('div');
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=A1' }),
        containerRef: { current: mockContainer },
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      act(() => {
        result.current.tryStartFormulaRangeDrag(50, 12);
      });

      expect(mockContainer.style.cursor).toBe('move');

      act(() => {
        result.current.endFormulaRangeDrag();
      });

      expect(mockContainer.style.cursor).toBe('');
    });

    it('should not call onUpdateFormulaRange when getCellIdAtPosition returns null', () => {
      const onUpdateFormulaRange = jest.fn();
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=A1' }),
        onUpdateFormulaRange,
        getCellIdAtPosition: () => null,
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      // Start drag at A1
      act(() => {
        result.current.tryStartFormulaRangeDrag(50, 12);
      });

      // Move to B2
      act(() => {
        result.current.moveFormulaRangeDrag(150, 37);
      });

      // End drag
      act(() => {
        result.current.endFormulaRangeDrag();
      });

      expect(onUpdateFormulaRange).not.toHaveBeenCalled();
    });
  });

  describe('range reference drag with multiple ranges', () => {
    it('should handle formula with multiple ranges', () => {
      const onUpdateFormulaRange = jest.fn();
      // =A1+B2 has two ranges: A1 at index 0, B2 at index 1
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=A1+B2' }),
        onUpdateFormulaRange,
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      // Click on B2 (col=1, row=1 -> center at x=150, y=37)
      let started: boolean = false;
      act(() => {
        started = result.current.tryStartFormulaRangeDrag(150, 37);
      });

      expect(started).toBe(true);
      const dragState = result.current.getCurrentDragState();
      expect(dragState?.originalRange).toEqual({
        startRow: 1,
        startCol: 1,
        endRow: 1,
        endCol: 1,
      });
      // The hit result should identify this as the second range (index 1)
      expect(dragState?.hitResult.rangeIndex).toBe(1);
    });
  });

  describe('resize handles', () => {
    it('should detect corner handle hit on range', () => {
      // Formula =A1:C3 creates a range from (0,0) to (2,2)
      // Bottom-right corner is at C3 (col=2, row=2)
      // With 100px columns and 25px rows, C3 bottom-right is at x=300, y=75
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=A1:C3' }),
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      // Click near bottom-right corner
      let started: boolean = false;
      act(() => {
        started = result.current.tryStartFormulaRangeDrag(300, 75);
      });

      expect(started).toBe(true);
      const dragState = result.current.getCurrentDragState();
      expect(dragState?.hitResult.handleType).toBe('bottom-right');
    });
  });

  describe('geometry unavailable', () => {
    it('should return false when geometry is null', () => {
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=A1' }),
        getGeometry: () => null,
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      let started: boolean = false;
      act(() => {
        started = result.current.tryStartFormulaRangeDrag(50, 12);
      });

      expect(started).toBe(false);
    });

    it('should not update during move when geometry is null', () => {
      const options = createMockOptions({
        getEditorState: () => ({ isFormulaEditing: true, value: '=A1' }),
      });
      const { result } = renderHook(() => useFormulaRangeDrag(options));

      // Start drag successfully
      act(() => {
        result.current.tryStartFormulaRangeDrag(50, 12);
      });

      const originalRange = { ...result.current.getCurrentDragState()?.currentRange };

      // Change geometry to return null during move
      // We need to rerender with new options - this tests the edge case
      const { result: result2 } = renderHook(() =>
        useFormulaRangeDrag({
          ...options,
          getGeometry: () => null,
        }),
      );

      // Manually set the drag state (simulating an ongoing drag)
      result2.current.formulaRangeDragRef.current = result.current.formulaRangeDragRef.current;

      act(() => {
        result2.current.moveFormulaRangeDrag(200, 100);
      });

      // Current range should not have changed
      expect(result2.current.getCurrentDragState()?.currentRange).toEqual(originalRange);
    });
  });
});
