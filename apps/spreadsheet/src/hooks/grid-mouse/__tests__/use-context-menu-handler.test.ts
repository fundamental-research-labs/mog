/**
 * Context Menu Handler Tests
 *
 * Unit tests for the useContextMenuHandler hook and its helper functions.
 * Tests cover:
 * - Helper functions for selection checking
 * - Context menu target classification
 * - Selection updates when clicking outside current selection
 * - Callback invocation with correct parameters
 *
 * @see use-context-menu-handler.ts
 */

import { jest } from '@jest/globals';

import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import type { CellRange } from '../../../systems/shared/types';
import type { ISheetViewHitTest } from '@mog-sdk/sheet-view';
import {
  isCellInSelection,
  isColumnInSelection,
  isMultiCellSelection,
  isRowInSelection,
  useContextMenuHandler,
  type ContextMenuSelectionApi,
  type UseContextMenuHandlerDeps,
} from '../use-context-menu-handler';

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a mock mouse event for context menu (right-click).
 */
function createContextMenuEvent(options: {
  clientX?: number;
  clientY?: number;
}): React.MouseEvent<HTMLDivElement> {
  const { clientX = 100, clientY = 100 } = options;

  return {
    clientX,
    clientY,
    button: 2, // Right-click
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    nativeEvent: {} as MouseEvent,
    currentTarget: document.createElement('div'),
    target: document.createElement('div'),
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    eventPhase: 0,
    isTrusted: true,
    timeStamp: Date.now(),
    type: 'contextmenu',
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    buttons: 2,
    getModifierState: () => false,
    movementX: 0,
    movementY: 0,
    pageX: clientX,
    pageY: clientY,
    relatedTarget: null,
    screenX: clientX,
    screenY: clientY,
    detail: 0,
    view: window,
    isDefaultPrevented: () => false,
    isPropagationStopped: () => false,
    persist: () => {},
  } as unknown as React.MouseEvent<HTMLDivElement>;
}

/**
 * Create a mock container ref with bounding rect.
 */
function createMockContainerRef(): React.RefObject<HTMLDivElement> {
  const div = document.createElement('div');
  div.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  return { current: div };
}

/**
 * Create a mock grid renderer.
 * Uses type assertion since we only need hitTest for this hook.
 */
function createMockHitTest(hitResult: ReturnType<typeof createHitResult>) {
  return {
    atViewportPoint: jest.fn().mockReturnValue(hitResult),
  } as unknown as ISheetViewHitTest;
}

/**
 * Create hit test results for different scenarios.
 */
function createHitResult(
  type:
    | 'cell'
    | 'column-header'
    | 'column-resize-handle'
    | 'row-header'
    | 'row-resize-handle'
    | 'empty'
    | 'floating-object',
  options?: { row?: number; col?: number; objectId?: string; region?: string },
) {
  switch (type) {
    case 'cell':
      return { type: 'cell' as const, row: options?.row ?? 5, col: options?.col ?? 3 };
    case 'column-header':
      return { type: 'column-header' as const, col: options?.col ?? 3 };
    case 'column-resize-handle':
      return { type: 'column-resize-handle' as const, col: options?.col ?? 3 };
    case 'row-header':
      return { type: 'row-header' as const, row: options?.row ?? 5 };
    case 'row-resize-handle':
      return { type: 'row-resize-handle' as const, row: options?.row ?? 5 };
    case 'floating-object':
      return {
        type: 'floating-object' as const,
        objectId: options?.objectId ?? 'shape-123',
        region: options?.region ?? 'body',
      };
    case 'empty':
      return { type: 'empty' as const };
    default:
      return { type: 'empty' as const };
  }
}

/**
 * Create a mock selection API.
 */
function createMockSelectionApi(ranges: CellRange[] = []): ContextMenuSelectionApi {
  return {
    ranges,
    onMouseDown: jest.fn(),
    onMouseUp: jest.fn(),
    selectColumn: jest.fn(),
    selectRow: jest.fn(),
  };
}

/**
 * Create test dependencies.
 */
function createTestDeps(
  overrides: Partial<UseContextMenuHandlerDeps> = {},
): UseContextMenuHandlerDeps {
  const containerRef = createMockContainerRef();
  const hitResult = createHitResult('cell', { row: 5, col: 3 });
  const hitTest = createMockHitTest(hitResult);

  return {
    activeSheetId: 'test-sheet',
    containerRef,
    getHitTest: () => hitTest,
    selection: createMockSelectionApi(),
    onContextMenu: jest.fn(),
    ...overrides,
  };
}

// =============================================================================
// HELPER FUNCTION TESTS
// =============================================================================

describe('isCellInSelection', () => {
  it('returns false for empty ranges', () => {
    expect(isCellInSelection(5, 3, [])).toBe(false);
  });

  it('returns true when cell is within a range', () => {
    const ranges: CellRange[] = [{ startRow: 0, endRow: 10, startCol: 0, endCol: 10 }];
    expect(isCellInSelection(5, 5, ranges)).toBe(true);
  });

  it('returns false when cell is outside all ranges', () => {
    const ranges: CellRange[] = [{ startRow: 0, endRow: 3, startCol: 0, endCol: 3 }];
    expect(isCellInSelection(5, 5, ranges)).toBe(false);
  });

  it('returns true when cell is on range boundary', () => {
    const ranges: CellRange[] = [{ startRow: 0, endRow: 5, startCol: 0, endCol: 5 }];
    expect(isCellInSelection(5, 5, ranges)).toBe(true); // End corner
    expect(isCellInSelection(0, 0, ranges)).toBe(true); // Start corner
  });

  it('handles multiple ranges', () => {
    const ranges: CellRange[] = [
      { startRow: 0, endRow: 2, startCol: 0, endCol: 2 },
      { startRow: 5, endRow: 7, startCol: 5, endCol: 7 },
    ];
    expect(isCellInSelection(1, 1, ranges)).toBe(true); // In first range
    expect(isCellInSelection(6, 6, ranges)).toBe(true); // In second range
    expect(isCellInSelection(3, 3, ranges)).toBe(false); // In neither
  });
});

describe('isColumnInSelection', () => {
  it('returns false for empty ranges', () => {
    expect(isColumnInSelection(5, [])).toBe(false);
  });

  it('returns true when column is within a range', () => {
    const ranges: CellRange[] = [{ startRow: 0, endRow: 10, startCol: 0, endCol: 10 }];
    expect(isColumnInSelection(5, ranges)).toBe(true);
  });

  it('returns false when column is outside all ranges', () => {
    const ranges: CellRange[] = [{ startRow: 0, endRow: 10, startCol: 0, endCol: 3 }];
    expect(isColumnInSelection(5, ranges)).toBe(false);
  });

  it('returns true when column is on range boundary', () => {
    const ranges: CellRange[] = [{ startRow: 0, endRow: 10, startCol: 3, endCol: 7 }];
    expect(isColumnInSelection(3, ranges)).toBe(true); // Start
    expect(isColumnInSelection(7, ranges)).toBe(true); // End
  });
});

describe('isRowInSelection', () => {
  it('returns false for empty ranges', () => {
    expect(isRowInSelection(5, [])).toBe(false);
  });

  it('returns true when row is within a range', () => {
    const ranges: CellRange[] = [{ startRow: 0, endRow: 10, startCol: 0, endCol: 10 }];
    expect(isRowInSelection(5, ranges)).toBe(true);
  });

  it('returns false when row is outside all ranges', () => {
    const ranges: CellRange[] = [{ startRow: 0, endRow: 3, startCol: 0, endCol: 10 }];
    expect(isRowInSelection(5, ranges)).toBe(false);
  });

  it('returns true when row is on range boundary', () => {
    const ranges: CellRange[] = [{ startRow: 3, endRow: 7, startCol: 0, endCol: 10 }];
    expect(isRowInSelection(3, ranges)).toBe(true); // Start
    expect(isRowInSelection(7, ranges)).toBe(true); // End
  });
});

describe('isMultiCellSelection', () => {
  it('returns false for empty ranges', () => {
    expect(isMultiCellSelection([])).toBe(false);
  });

  it('returns false for single cell selection', () => {
    const ranges: CellRange[] = [{ startRow: 5, endRow: 5, startCol: 3, endCol: 3 }];
    expect(isMultiCellSelection(ranges)).toBe(false);
  });

  it('returns true for multi-row selection', () => {
    const ranges: CellRange[] = [{ startRow: 5, endRow: 7, startCol: 3, endCol: 3 }];
    expect(isMultiCellSelection(ranges)).toBe(true);
  });

  it('returns true for multi-column selection', () => {
    const ranges: CellRange[] = [{ startRow: 5, endRow: 5, startCol: 3, endCol: 5 }];
    expect(isMultiCellSelection(ranges)).toBe(true);
  });

  it('returns true for multi-row-and-column selection', () => {
    const ranges: CellRange[] = [{ startRow: 5, endRow: 7, startCol: 3, endCol: 5 }];
    expect(isMultiCellSelection(ranges)).toBe(true);
  });
});

// =============================================================================
// HOOK TESTS
// =============================================================================

describe('useContextMenuHandler', () => {
  describe('basic functionality', () => {
    it('returns a stable handleContextMenu callback', () => {
      const deps = createTestDeps();
      const { result, rerender } = renderHook(() => useContextMenuHandler(deps));

      const firstCallback = result.current.handleContextMenu;
      rerender();
      const secondCallback = result.current.handleContextMenu;

      expect(firstCallback).toBe(secondCallback);
    });

    it('lets Radix handle default context menu events for positioning', () => {
      const deps = createTestDeps();
      const { result } = renderHook(() => useContextMenuHandler(deps));

      const event = createContextMenuEvent({ clientX: 100, clientY: 100 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('does nothing if container ref is null', () => {
      const deps = createTestDeps({
        containerRef: { current: null },
      });
      const { result } = renderHook(() => useContextMenuHandler(deps));

      const event = createContextMenuEvent({ clientX: 100, clientY: 100 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(deps.onContextMenu).not.toHaveBeenCalled();
    });

    it('does nothing if onContextMenu callback is not provided', () => {
      const deps = createTestDeps({ onContextMenu: undefined });
      const { result } = renderHook(() => useContextMenuHandler(deps));

      const event = createContextMenuEvent({ clientX: 100, clientY: 100 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      // Should not throw
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('does nothing if grid renderer is not available', () => {
      const deps = createTestDeps({
        getHitTest: () => null,
      });
      const { result } = renderHook(() => useContextMenuHandler(deps));

      const event = createContextMenuEvent({ clientX: 100, clientY: 100 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(deps.onContextMenu).not.toHaveBeenCalled();
    });
  });

  describe('cell context menu', () => {
    it('calls onContextMenu with cell target when clicking on a cell', () => {
      const hitResult = createHitResult('cell', { row: 5, col: 3 });
      const hitTest = createMockHitTest(hitResult);
      const onContextMenu = jest.fn();

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        onContextMenu,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 150, clientY: 200 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(onContextMenu).toHaveBeenCalledWith({
        x: 150,
        y: 200,
        target: 'cell',
        targetRow: 5,
        targetCol: 3,
      });
    });

    it('updates selection when clicking outside current selection', () => {
      const hitResult = createHitResult('cell', { row: 5, col: 3 });
      const hitTest = createMockHitTest(hitResult);
      const selection = createMockSelectionApi([
        { startRow: 0, endRow: 2, startCol: 0, endCol: 2 },
      ]);

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        selection,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 150, clientY: 200 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(selection.onMouseDown).toHaveBeenCalledWith({ row: 5, col: 3 }, false, false);
      expect(selection.onMouseUp).toHaveBeenCalled();
    });

    it('does not update selection when clicking inside current selection', () => {
      const hitResult = createHitResult('cell', { row: 5, col: 3 });
      const hitTest = createMockHitTest(hitResult);
      const selection = createMockSelectionApi([
        { startRow: 0, endRow: 10, startCol: 0, endCol: 10 },
      ]);

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        selection,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 150, clientY: 200 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(selection.onMouseDown).not.toHaveBeenCalled();
      expect(selection.onMouseUp).not.toHaveBeenCalled();
    });

    it('returns target=selection for multi-cell selection when clicking inside', () => {
      const hitResult = createHitResult('cell', { row: 5, col: 3 });
      const hitTest = createMockHitTest(hitResult);
      const onContextMenu = jest.fn();
      const selection = createMockSelectionApi([
        { startRow: 0, endRow: 10, startCol: 0, endCol: 10 }, // Multi-cell
      ]);

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        selection,
        onContextMenu,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 150, clientY: 200 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(onContextMenu).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'selection',
        }),
      );
    });

    it('returns target=cell for single-cell selection when clicking inside', () => {
      const hitResult = createHitResult('cell', { row: 5, col: 3 });
      const hitTest = createMockHitTest(hitResult);
      const onContextMenu = jest.fn();
      const selection = createMockSelectionApi([
        { startRow: 5, endRow: 5, startCol: 3, endCol: 3 }, // Single cell
      ]);

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        selection,
        onContextMenu,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 150, clientY: 200 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(onContextMenu).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'cell',
        }),
      );
    });
  });

  describe('column header context menu', () => {
    it('calls onContextMenu with column-header target', () => {
      const hitResult = createHitResult('column-header', { col: 5 });
      const hitTest = createMockHitTest(hitResult);
      const onContextMenu = jest.fn();

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        onContextMenu,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 200, clientY: 15 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(onContextMenu).toHaveBeenCalledWith({
        x: 200,
        y: 15,
        target: 'column-header',
        targetRow: undefined,
        targetCol: 5,
      });
    });

    it('selects column when clicking outside current selection', () => {
      const hitResult = createHitResult('column-header', { col: 5 });
      const hitTest = createMockHitTest(hitResult);
      const selection = createMockSelectionApi([
        { startRow: 0, endRow: 100, startCol: 0, endCol: 2 },
      ]);

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        selection,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 200, clientY: 15 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(selection.selectColumn).toHaveBeenCalledWith(5, false, false);
    });

    it('selects column when a partial cell selection contains the column', () => {
      const hitResult = createHitResult('column-header', { col: 5 });
      const hitTest = createMockHitTest(hitResult);
      const selection = createMockSelectionApi([
        { startRow: 0, endRow: 100, startCol: 0, endCol: 10 },
      ]);

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        selection,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 200, clientY: 15 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(selection.selectColumn).toHaveBeenCalledWith(5, false, false);
    });

    it('does not select column when column is in a full-column selection', () => {
      const hitResult = createHitResult('column-header', { col: 5 });
      const hitTest = createMockHitTest(hitResult);
      const selection = createMockSelectionApi([
        { startRow: 0, endRow: 1048575, startCol: 0, endCol: 10, isFullColumn: true },
      ]);

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        selection,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 200, clientY: 15 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(selection.selectColumn).not.toHaveBeenCalled();
    });

    it('treats column resize-handle right-clicks as column-header context menus', () => {
      const hitResult = createHitResult('column-resize-handle', { col: 5 });
      const hitTest = createMockHitTest(hitResult);
      const selection = createMockSelectionApi();
      const onContextMenu = jest.fn();

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        selection,
        onContextMenu,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 200, clientY: 15 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(selection.selectColumn).toHaveBeenCalledWith(5, false, false);
      expect(onContextMenu).toHaveBeenCalledWith({
        x: 200,
        y: 15,
        target: 'column-header',
        targetRow: undefined,
        targetCol: 5,
      });
    });
  });

  describe('row header context menu', () => {
    it('calls onContextMenu with row-header target', () => {
      const hitResult = createHitResult('row-header', { row: 7 });
      const hitTest = createMockHitTest(hitResult);
      const onContextMenu = jest.fn();

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        onContextMenu,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 25, clientY: 200 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(onContextMenu).toHaveBeenCalledWith({
        x: 25,
        y: 200,
        target: 'row-header',
        targetRow: 7,
        targetCol: undefined,
      });
    });

    it('selects row when clicking outside current selection', () => {
      const hitResult = createHitResult('row-header', { row: 7 });
      const hitTest = createMockHitTest(hitResult);
      const selection = createMockSelectionApi([
        { startRow: 0, endRow: 5, startCol: 0, endCol: 100 },
      ]);

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        selection,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 25, clientY: 200 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(selection.selectRow).toHaveBeenCalledWith(7, false, false);
    });

    it('does not select row when row is in current selection', () => {
      const hitResult = createHitResult('row-header', { row: 7 });
      const hitTest = createMockHitTest(hitResult);
      const selection = createMockSelectionApi([
        { startRow: 0, endRow: 10, startCol: 0, endCol: 100, isFullRow: true },
      ]);

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        selection,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 25, clientY: 200 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(selection.selectRow).not.toHaveBeenCalled();
    });

    it('treats row resize-handle right-clicks as row-header context menus', () => {
      const hitResult = createHitResult('row-resize-handle', { row: 7 });
      const hitTest = createMockHitTest(hitResult);
      const selection = createMockSelectionApi();
      const onContextMenu = jest.fn();

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        selection,
        onContextMenu,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 25, clientY: 200 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(selection.selectRow).toHaveBeenCalledWith(7, false, false);
      expect(onContextMenu).toHaveBeenCalledWith({
        x: 25,
        y: 200,
        target: 'row-header',
        targetRow: 7,
        targetCol: undefined,
      });
    });
  });

  describe('empty area context menu', () => {
    it('does not call onContextMenu for empty areas', () => {
      const hitResult = createHitResult('empty');
      const hitTest = createMockHitTest(hitResult);
      const onContextMenu = jest.fn();

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        onContextMenu,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 900, clientY: 700 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(onContextMenu).not.toHaveBeenCalled();
    });
  });

  describe('floating object context menu', () => {
    it('calls onObjectContextMenu when right-clicking on a floating object', () => {
      const hitResult = createHitResult('floating-object', { objectId: 'shape-456' });
      const hitTest = createMockHitTest(hitResult);
      const onContextMenu = jest.fn();
      const onObjectContextMenu = jest.fn();

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        onContextMenu,
        onObjectContextMenu,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 300, clientY: 200 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      // Should call object context menu
      expect(onObjectContextMenu).toHaveBeenCalledWith(300, 200, 'shape-456');
      // Should NOT call cell context menu
      expect(onContextMenu).not.toHaveBeenCalled();
    });

    it('does not call onContextMenu (cell menu) when clicking on floating object', () => {
      const hitResult = createHitResult('floating-object', { objectId: 'chart-789' });
      const hitTest = createMockHitTest(hitResult);
      const onContextMenu = jest.fn();
      const onObjectContextMenu = jest.fn();

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        onContextMenu,
        onObjectContextMenu,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 400, clientY: 300 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      expect(onContextMenu).not.toHaveBeenCalled();
    });

    it('does nothing if onObjectContextMenu callback is not provided', () => {
      const hitResult = createHitResult('floating-object', { objectId: 'shape-999' });
      const hitTest = createMockHitTest(hitResult);
      const onContextMenu = jest.fn();

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        onContextMenu,
        onObjectContextMenu: undefined,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 500, clientY: 400 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      // Should not throw, and should not call cell context menu
      expect(event.preventDefault).toHaveBeenCalled();
      expect(onContextMenu).not.toHaveBeenCalled();
    });

    it('does not update cell selection when right-clicking on floating object', () => {
      const hitResult = createHitResult('floating-object', { objectId: 'image-123' });
      const hitTest = createMockHitTest(hitResult);
      const selection = createMockSelectionApi([
        { startRow: 0, endRow: 10, startCol: 0, endCol: 10 },
      ]);
      const onObjectContextMenu = jest.fn();

      const deps = createTestDeps({
        getHitTest: () => hitTest,
        selection,
        onObjectContextMenu,
      });

      const { result } = renderHook(() => useContextMenuHandler(deps));
      const event = createContextMenuEvent({ clientX: 250, clientY: 150 });

      act(() => {
        result.current.handleContextMenu(event);
      });

      // Should not update cell selection
      expect(selection.onMouseDown).not.toHaveBeenCalled();
      expect(selection.onMouseUp).not.toHaveBeenCalled();
      expect(selection.selectColumn).not.toHaveBeenCalled();
      expect(selection.selectRow).not.toHaveBeenCalled();
    });
  });
});
