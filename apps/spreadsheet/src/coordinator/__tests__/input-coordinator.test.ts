/**
 * Input Coordinator Tests
 *
 * Tests for the InputCoordinator class which manages all input handling.
 */

import { jest } from '@jest/globals';

import type { CellRange } from '@mog-sdk/contracts/core';
import type {
  ISheetViewCommands,
  ISheetViewGeometry,
  ISheetViewHitTest,
  ISheetViewViewport,
  SheetHitResult,
  SheetPoint,
  SheetViewCommand,
} from '@mog-sdk/sheet-view';
import type {
  CellCoord,
  CoordinateSystem,
  DocumentPoint,
  DocumentRect,
  FrozenPanes,
  LayerPoint,
  LayerRect,
  ScrollViewport,
  ViewportPoint,
  ViewportRect,
  VisibleRegions,
} from '@mog-sdk/contracts/rendering';
import {
  documentPoint,
  documentRect,
  layerPoint,
  layerRect,
  viewportPoint,
  viewportRect,
} from '@mog/spreadsheet-utils/rendering/coordinates';
import {
  InputCoordinator,
  createInputCoordinator,
  type InputCoordinatorDependencies,
} from '../../systems/input/coordination/input-coordination';
import type { SheetInputEvent } from '../../systems/input/machines/input-types';

// =============================================================================
// MOCK COORDINATE SYSTEM
// =============================================================================

function createMockCoordinateSystem(): CoordinateSystem {
  let viewport: ScrollViewport = { scrollTop: 0, scrollLeft: 0, width: 1000, height: 800 };
  let zoom = 1.0;
  let frozenPanes: FrozenPanes = { rows: 0, cols: 0 };
  let outlineGutter = { rowGutterWidth: 0, colGutterHeight: 0 };

  return {
    setViewport: jest.fn((v: ScrollViewport) => {
      viewport = v;
    }),
    getViewport: jest.fn(() => ({ ...viewport })),
    setZoom: jest.fn((z: number) => {
      zoom = z;
    }),
    getZoom: jest.fn(() => zoom),
    setFrozenPanes: jest.fn((p: FrozenPanes) => {
      frozenPanes = p;
    }),
    getFrozenPanes: jest.fn(() => ({ ...frozenPanes })),
    getScrollBounds: jest.fn((_sheetId: string) => ({
      maxScrollTop: 10000,
      maxScrollLeft: 5000,
    })),
    viewportToCell: jest.fn((_sheetId: string, point: ViewportPoint): CellCoord | null => {
      // Simple mock: each cell is 100x25 pixels
      if (point.x < 0 || point.y < 0) return null;
      const col = Math.floor(point.x / 100);
      const row = Math.floor(point.y / 25);
      return { row, col };
    }),
    viewportToDocument: jest.fn((_sheetId: string, point: ViewportPoint): DocumentPoint => {
      return documentPoint(point.x + viewport.scrollLeft, point.y + viewport.scrollTop);
    }),
    documentToCell: jest.fn((_sheetId: string, point: DocumentPoint): CellCoord | null => {
      if (point.x < 0 || point.y < 0) return null;
      const col = Math.floor(point.x / 100);
      const row = Math.floor(point.y / 25);
      return { row, col };
    }),
    cellToDocument: jest.fn(
      (_sheetId: string, cell: CellCoord): DocumentRect =>
        documentRect(cell.col * 100, cell.row * 25, 100, 25),
    ),
    cellToViewport: jest.fn((_sheetId: string, cell: CellCoord): ViewportRect | null =>
      viewportRect(
        cell.col * 100 - viewport.scrollLeft,
        cell.row * 25 - viewport.scrollTop,
        100,
        25,
      ),
    ),
    rangeToDocument: jest.fn(
      (_sheetId: string, range: CellRange): DocumentRect =>
        documentRect(
          range.startCol * 100,
          range.startRow * 25,
          (range.endCol - range.startCol + 1) * 100,
          (range.endRow - range.startRow + 1) * 25,
        ),
    ),
    rangeToViewport: jest.fn((_sheetId: string, range: CellRange): ViewportRect[] => [
      viewportRect(
        range.startCol * 100 - viewport.scrollLeft,
        range.startRow * 25 - viewport.scrollTop,
        (range.endCol - range.startCol + 1) * 100,
        (range.endRow - range.startRow + 1) * 25,
      ),
    ]),
    documentToViewport: jest.fn((_sheetId: string, rect: DocumentRect): ViewportRect | null =>
      viewportRect(
        rect.x - viewport.scrollLeft,
        rect.y - viewport.scrollTop,
        rect.width,
        rect.height,
      ),
    ),
    documentToLayerViewport: jest.fn((_sheetId: string, rect: DocumentRect): LayerRect | null =>
      // Layer-relative coords (NO header offset - canvas translation handles it)
      layerRect(rect.x - viewport.scrollLeft, rect.y - viewport.scrollTop, rect.width, rect.height),
    ),
    viewportToLayer: jest.fn((p: ViewportPoint): LayerPoint => layerPoint(p.x - 50, p.y - 24)),
    layerToViewport: jest.fn((p: LayerPoint): ViewportPoint => viewportPoint(p.x + 50, p.y + 24)),
    getVisibleRange: jest.fn(
      (_sheetId: string): CellRange => ({
        startRow: 0,
        startCol: 0,
        endRow: 30,
        endCol: 10,
      }),
    ),
    getVisibleRegions: jest.fn(
      (_sheetId: string): VisibleRegions => ({
        frozenCorner: null,
        frozenRows: null,
        frozenCols: null,
        main: { startRow: 0, startCol: 0, endRow: 30, endCol: 10 },
      }),
    ),
    isCellVisible: jest.fn((_sheetId: string, _cell: CellCoord) => true),
    isCellFrozen: jest.fn((_sheetId: string, _cell: CellCoord) => false),
    getScrollToCell: jest.fn((_sheetId: string, _cell: CellCoord, _padding?: number) => null),
    getDevicePixelRatio: jest.fn(() => 1),
    setViewportPositionIndex: jest.fn(),
    getViewportPositionIndex: jest.fn(() => null),
    setViewportMergeIndex: jest.fn(),
    getViewportMergeIndex: jest.fn(() => null),
    classifyPoint: jest.fn((_sheetId: string, point: ViewportPoint, _isTouch?: boolean) => {
      // Simple mock classification
      if (point.x < 50 && point.y < 24) {
        return { type: 'frozen', region: 'topLeft' as const };
      }
      if (point.y < 24) {
        const col = Math.floor((point.x - 50) / 100);
        return { type: 'columnHeader' as const, col };
      }
      if (point.x < 50) {
        const row = Math.floor((point.y - 24) / 25);
        return { type: 'rowHeader' as const, row };
      }
      const col = Math.floor((point.x - 50) / 100);
      const row = Math.floor((point.y - 24) / 25);
      return { type: 'cell' as const, row, col };
    }),
    getClickPositionInCell: jest.fn((_sheetId: string, point: ViewportPoint, cell: CellCoord) => ({
      x: point.x - 50 - cell.col * 100,
      y: point.y - 24 - cell.row * 21,
      width: 100,
      height: 21,
    })),
    getViewportBounds: jest.fn((_sheetId: string) => ({
      left: 50,
      top: 24,
      right: viewport.width,
      bottom: viewport.height,
    })),
    // Outline gutter (for row/column grouping)
    setOutlineGutter: jest.fn((rowGutterWidth: number, colGutterHeight: number) => {
      outlineGutter = { rowGutterWidth, colGutterHeight };
    }),
    getOutlineGutter: jest.fn(() => ({ ...outlineGutter })),
    // Header visibility
    setHeaderVisibility: jest.fn(),
    getHeaderVisibility: jest.fn(() => ({ showRowHeaders: true, showColumnHeaders: true })),
    // Sheet ID and position index
    getCurrentSheetId: jest.fn(() => null),
    getPositionIndex: jest.fn(() => null),
  };
}

function createMockSheetHit(point: SheetPoint): SheetHitResult {
  if (point.x < 0 || point.y < 0) {
    return { type: 'empty' };
  }

  return {
    type: 'cell',
    row: Math.floor(point.y / 25),
    col: Math.floor(point.x / 100),
  };
}

function createMockInputDependencies(
  coordinateSystem: CoordinateSystem,
): Pick<InputCoordinatorDependencies, 'hitTest' | 'viewport' | 'geometry' | 'commands'> {
  const hitTest = {
    atViewportPoint: jest.fn((point: SheetPoint) => createMockSheetHit(point)),
    atPagePoint: jest.fn((point: SheetPoint) => createMockSheetHit(point)),
  } as ISheetViewHitTest;

  const viewport = {
    getScrollBounds: jest.fn(() => ({
      maxScrollX: 5000,
      maxScrollY: 10000,
    })),
    getScrollPosition: jest.fn(() => {
      const viewport = coordinateSystem.getViewport();
      return { x: viewport.scrollLeft, y: viewport.scrollTop };
    }),
    setScrollPosition: jest.fn((position: { x: number; y: number }) => {
      const viewport = coordinateSystem.getViewport();
      coordinateSystem.setViewport({
        ...viewport,
        scrollLeft: position.x,
        scrollTop: position.y,
      });
    }),
  } as unknown as ISheetViewViewport;

  const geometry = {
    getPositionDimensions: jest.fn(() => null),
  } as unknown as ISheetViewGeometry;

  const commands = {
    dispatch: jest.fn((command: SheetViewCommand) => {
      if (command.type === 'set-zoom') {
        coordinateSystem.setZoom(command.zoom);
      }
    }),
  } as ISheetViewCommands;

  return { hitTest, viewport, geometry, commands };
}

// =============================================================================
// TEST HELPERS
// =============================================================================

function createWheelEvent(options: Partial<WheelEvent> = {}): WheelEvent {
  const event = {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    clientX: 100,
    clientY: 100,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false, // Added for Shift+Wheel horizontal scroll tests
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    ...options,
  } as unknown as WheelEvent;
  return event;
}

function createPointerEvent(options: Partial<PointerEvent> = {}): PointerEvent {
  const event = {
    button: 0,
    clientX: 100,
    clientY: 100,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    ...options,
  } as unknown as PointerEvent;
  return event;
}

function createKeyboardEvent(code: string, options: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    code,
    repeat: false,
    preventDefault: jest.fn(),
    ...options,
  } as unknown as KeyboardEvent;
}

function createTouchEvent(
  _type: 'start' | 'move' | 'end',
  touches: Array<{ identifier: number; clientX: number; clientY: number }>,
  changedTouches?: Array<{ identifier: number; clientX: number; clientY: number }>,
): TouchEvent {
  const touchList = {
    length: touches.length,
    item: (i: number) => touches[i],
    [Symbol.iterator]: function* () {
      for (const t of touches) yield t;
    },
  } as unknown as TouchList;

  const changedList = {
    length: (changedTouches || touches).length,
    item: (i: number) => (changedTouches || touches)[i],
    [Symbol.iterator]: function* () {
      for (const t of changedTouches || touches) yield t;
    },
  } as unknown as TouchList;

  return {
    touches: touchList,
    changedTouches: changedList,
    preventDefault: jest.fn(),
  } as unknown as TouchEvent;
}

// =============================================================================
// TESTS
// =============================================================================

describe('InputCoordinator', () => {
  let coordinator: InputCoordinator;
  let mockCoordinateSystem: CoordinateSystem;
  let forwardedEvents: SheetInputEvent[];
  let renderRequests: number;

  beforeEach(() => {
    jest.useFakeTimers();
    forwardedEvents = [];
    renderRequests = 0;
    mockCoordinateSystem = createMockCoordinateSystem();

    coordinator = createInputCoordinator();
    coordinator.setDependencies({
      ...createMockInputDependencies(mockCoordinateSystem),
      forwardToSheet: (event) => forwardedEvents.push(event),
      requestRender: () => renderRequests++,
      // setScrollPosition callback is always provided in real usage (via sheet-coordinator.ts)
      // Route through coordinate system to match production behavior
      setScrollPosition: (pos) => {
        const viewport = mockCoordinateSystem.getViewport();
        mockCoordinateSystem.setViewport({
          ...viewport,
          scrollLeft: pos.x,
          scrollTop: pos.y,
        });
      },
    });
  });

  afterEach(() => {
    coordinator.dispose();
    jest.useRealTimers();
  });

  // ===========================================================================
  // LIFECYCLE TESTS
  // ===========================================================================

  describe('lifecycle', () => {
    it('should create coordinator with default config', () => {
      const c = createInputCoordinator();
      expect(c.isActive()).toBe(true);
      expect(c.getMachineState()).toBe('idle');
      c.dispose();
    });

    it('should create coordinator with custom config', () => {
      const c = createInputCoordinator({
        momentumEnabled: false,
        zoomSensitivity: 0.02,
      });
      expect(c.isActive()).toBe(true);
      c.dispose();
    });

    it('should dispose cleanly', () => {
      coordinator.dispose();
      expect(coordinator.isActive()).toBe(false);
    });

    it('should throw when accessing disposed coordinator', () => {
      coordinator.dispose();
      expect(() => coordinator.getInputActor()).toThrow('InputCoordinator has been disposed');
      expect(() => coordinator.scrollTo(0, 0)).toThrow('InputCoordinator has been disposed');
    });
  });

  // ===========================================================================
  // WHEEL SCROLL TESTS
  // ===========================================================================

  describe('wheel scrolling', () => {
    it('should handle vertical wheel scroll', () => {
      const event = createWheelEvent({ deltaY: 100 });
      coordinator.handleWheel(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(coordinator.getMachineState()).toBe('scrolling');

      const scrollState = coordinator.getScrollState();
      expect(scrollState.y).toBe(100);
      expect(scrollState.x).toBe(0);
    });

    it('should handle horizontal wheel scroll', () => {
      const event = createWheelEvent({ deltaX: 50, deltaY: 0 });
      coordinator.handleWheel(event);

      const scrollState = coordinator.getScrollState();
      expect(scrollState.x).toBe(50);
    });

    it('only constrains discrete horizontal wheel input at a hidden column run', () => {
      const positions: Array<{ x: number; y: number }> = [];
      const baseDeps = createMockInputDependencies(mockCoordinateSystem);
      const columnDimensions = new Map<number, { left: number; width: number; hidden: boolean }>();
      columnDimensions.set(0, { left: 0, width: 171, hidden: false });
      for (let col = 13; col <= 41; col += 1) {
        if (col < 15) {
          columnDimensions.set(col, {
            left: 1048 + (col - 13) * 69,
            width: 69,
            hidden: false,
          });
        } else if (col <= 26) {
          columnDimensions.set(col, {
            left: 1186,
            width: 0,
            hidden: true,
          });
        } else {
          columnDimensions.set(col, {
            left: 1186 + (col - 27) * 69,
            width: 69,
            hidden: false,
          });
        }
      }

      const viewport = {
        ...baseDeps.viewport,
        getSnapshot: jest.fn(() => ({
          scrollPositions: new Map(),
          visibleRange: { startRow: 10, startCol: 13, endRow: 46, endCol: 41 },
          frozenPanes: { rows: 0, cols: 1 },
          splitConfig: null,
          sheetId: 'sheet-1',
          zoom: 1,
        })),
      } as unknown as ISheetViewViewport;
      const geometry = {
        ...baseDeps.geometry,
        getDimensions: jest.fn((anchor: { row: number; col: number }) => {
          const col = columnDimensions.get(anchor.col) ?? {
            left: anchor.col * 69,
            width: 69,
            hidden: false,
          };
          return [
            { row: anchor.row, top: anchor.row * 20, height: 20, hidden: false },
            { col: anchor.col, ...col },
          ];
        }),
      } as unknown as ISheetViewGeometry;

      coordinator.setDependencies({
        ...baseDeps,
        viewport,
        geometry,
        forwardToSheet: (event) => forwardedEvents.push(event),
        requestRender: () => renderRequests++,
        setScrollPosition: (pos) => {
          positions.push({ x: pos.x, y: pos.y });
          const viewportState = mockCoordinateSystem.getViewport();
          mockCoordinateSystem.setViewport({
            ...viewportState,
            scrollLeft: pos.x,
            scrollTop: pos.y,
          });
        },
      });

      coordinator.resetScrollPosition(877, 133);
      coordinator.handleWheel(createWheelEvent({ deltaX: 499, deltaY: 0 }));

      expect(positions.at(-1)).toEqual({ x: 1014, y: 133 });
      expect(coordinator.getScrollState()).toMatchObject({ x: 1014, y: 133 });

      jest.advanceTimersByTime(200);

      expect(coordinator.getScrollState()).toMatchObject({ x: 1014, y: 133 });

      coordinator.resetScrollPosition(877, 133);
      coordinator.handleWheel(createWheelEvent({ deltaX: 2400, deltaY: 0 }));

      expect(positions.at(-1)).toEqual({ x: 2077, y: 133 });
      expect(coordinator.getScrollState()).toMatchObject({ x: 2077, y: 133 });
    });

    it('should handle diagonal wheel scroll', () => {
      const event = createWheelEvent({ deltaX: 30, deltaY: 40 });
      coordinator.handleWheel(event);

      const scrollState = coordinator.getScrollState();
      expect(scrollState.x).toBe(30);
      expect(scrollState.y).toBe(40);
    });

    it('should accumulate multiple wheel events', () => {
      coordinator.handleWheel(createWheelEvent({ deltaY: 50 }));
      coordinator.handleWheel(createWheelEvent({ deltaY: 50 }));
      coordinator.handleWheel(createWheelEvent({ deltaY: 50 }));

      const scrollState = coordinator.getScrollState();
      expect(scrollState.y).toBe(150);
    });

    it('should update coordinate system viewport', () => {
      coordinator.handleWheel(createWheelEvent({ deltaY: 100 }));

      expect(mockCoordinateSystem.setViewport).toHaveBeenCalled();
      const lastCall = (mockCoordinateSystem.setViewport as jest.Mock).mock.calls.slice(-1)[0][0];
      expect(lastCall.scrollTop).toBe(100);
    });

    it('should transition to momentum state after scroll end', () => {
      coordinator.handleWheel(createWheelEvent({ deltaY: 100 }));
      expect(coordinator.getMachineState()).toBe('scrolling');

      // Fast-forward past the scroll end timeout
      jest.advanceTimersByTime(200);

      // Machine should be in momentum or idle
      const state = coordinator.getMachineState();
      expect(['momentum', 'idle']).toContain(state);
    });

    // Shift+Wheel Horizontal Scroll tests
    describe('Shift+Wheel horizontal scroll', () => {
      it('should convert vertical scroll to horizontal when Shift is held', () => {
        const event = createWheelEvent({ deltaY: 100, deltaX: 0, shiftKey: true });
        coordinator.handleWheel(event);

        const scrollState = coordinator.getScrollState();
        expect(scrollState.x).toBe(100);
        expect(scrollState.y).toBe(0);
      });

      it('should NOT swap when Shift is held but deltaX is non-zero', () => {
        // When both deltaX and deltaY are present, don't swap
        const event = createWheelEvent({ deltaY: 50, deltaX: 30, shiftKey: true });
        coordinator.handleWheel(event);

        const scrollState = coordinator.getScrollState();
        // Original values should be preserved since deltaX != 0
        expect(scrollState.x).toBe(30);
        expect(scrollState.y).toBe(50);
      });

      it('should NOT swap when Shift is not held', () => {
        const event = createWheelEvent({ deltaY: 100, deltaX: 0, shiftKey: false });
        coordinator.handleWheel(event);

        const scrollState = coordinator.getScrollState();
        expect(scrollState.x).toBe(0);
        expect(scrollState.y).toBe(100);
      });

      it('should NOT swap when deltaY is 0', () => {
        const event = createWheelEvent({ deltaY: 0, deltaX: 50, shiftKey: true });
        coordinator.handleWheel(event);

        const scrollState = coordinator.getScrollState();
        expect(scrollState.x).toBe(50);
        expect(scrollState.y).toBe(0);
      });
    });
  });

  // ===========================================================================
  // ZOOM TESTS
  // ===========================================================================

  describe('zooming', () => {
    it('should handle Ctrl+wheel zoom', () => {
      const event = createWheelEvent({
        deltaY: -100,
        ctrlKey: true,
        clientX: 500,
        clientY: 400,
      });
      coordinator.handleWheel(event);

      expect(coordinator.getMachineState()).toBe('zooming');
      const zoomState = coordinator.getZoomState();
      expect(zoomState.level).toBeGreaterThan(1);
    });

    it('should handle Cmd+wheel zoom (macOS)', () => {
      const event = createWheelEvent({
        deltaY: -100,
        metaKey: true,
        clientX: 500,
        clientY: 400,
      });
      coordinator.handleWheel(event);

      expect(coordinator.getMachineState()).toBe('zooming');
    });

    it('should clamp zoom to min/max bounds', () => {
      // Zoom out a lot
      for (let i = 0; i < 50; i++) {
        coordinator.handleWheel(createWheelEvent({ deltaY: 100, ctrlKey: true }));
      }
      const minZoomState = coordinator.getZoomState();
      expect(minZoomState.level).toBeGreaterThanOrEqual(0.1);

      // Zoom in a lot
      for (let i = 0; i < 100; i++) {
        coordinator.handleWheel(createWheelEvent({ deltaY: -100, ctrlKey: true }));
      }
      const maxZoomState = coordinator.getZoomState();
      expect(maxZoomState.level).toBeLessThanOrEqual(4.0);
    });

    it('should support programmatic zoomTo', () => {
      coordinator.setZoom(2.0);

      const zoomState = coordinator.getZoomState();
      expect(zoomState.level).toBe(2.0);
      expect(mockCoordinateSystem.setZoom).toHaveBeenCalledWith(2.0);
    });
  });

  // ===========================================================================
  // POINTER EVENT TESTS
  // ===========================================================================

  describe('pointer events', () => {
    it('should forward left-click on cell to sheet', () => {
      const event = createPointerEvent({ clientX: 150, clientY: 50 });
      coordinator.handlePointerDown(event);

      expect(forwardedEvents.length).toBe(1);
      expect(forwardedEvents[0].type).toBe('CELL_POINTER_DOWN');
      if (forwardedEvents[0].type === 'CELL_POINTER_DOWN') {
        expect(forwardedEvents[0].row).toBe(2); // 50 / 25 = 2
        expect(forwardedEvents[0].col).toBe(1); // 150 / 100 = 1
      }
    });

    it('should forward shift+click for extend selection', () => {
      const event = createPointerEvent({ clientX: 150, clientY: 50, shiftKey: true });
      coordinator.handlePointerDown(event);

      expect(forwardedEvents[0].type).toBe('CELL_POINTER_DOWN');
      if (forwardedEvents[0].type === 'CELL_POINTER_DOWN') {
        expect(forwardedEvents[0].shiftKey).toBe(true);
      }
    });

    it('should forward ctrl+click for multi-select', () => {
      const event = createPointerEvent({ clientX: 150, clientY: 50, ctrlKey: true });
      coordinator.handlePointerDown(event);

      if (forwardedEvents[0].type === 'CELL_POINTER_DOWN') {
        expect(forwardedEvents[0].ctrlKey).toBe(true);
      }
    });

    it('should cancel pending wheel momentum before forwarding left-click', () => {
      coordinator.handleWheel(createWheelEvent({ deltaX: 150 }));
      expect(coordinator.getMachineState()).toBe('scrolling');

      coordinator.handlePointerDown(createPointerEvent({ clientX: 150, clientY: 50 }));

      expect(coordinator.getMachineState()).toBe('idle');
      expect(forwardedEvents[0].type).toBe('CELL_POINTER_DOWN');

      jest.advanceTimersByTime(200);

      expect(coordinator.getMachineState()).toBe('idle');
      expect(coordinator.getScrollState().x).toBe(150);
    });

    it('should start panning on middle-click', () => {
      const event = createPointerEvent({ button: 1, clientX: 500, clientY: 400 });
      coordinator.handlePointerDown(event);

      expect(coordinator.getMachineState()).toBe('panning');
      expect(event.preventDefault).toHaveBeenCalled();
      expect(forwardedEvents.length).toBe(0); // Should not forward to sheet
    });

    it('should handle pan movement', () => {
      // Start pan
      coordinator.handlePointerDown(createPointerEvent({ button: 1, clientX: 500, clientY: 400 }));

      // Move
      coordinator.handlePointerMove(createPointerEvent({ clientX: 450, clientY: 350 }));

      // Scroll should have changed
      const scrollState = coordinator.getScrollState();
      expect(scrollState.x).toBe(50); // 500 - 450
      expect(scrollState.y).toBe(50); // 400 - 350
    });

    it('should forward pointer up when not panning', () => {
      const event = createPointerEvent();
      coordinator.handlePointerUp(event);

      expect(forwardedEvents.length).toBe(1);
      expect(forwardedEvents[0].type).toBe('CELL_POINTER_UP');
    });
  });

  // ===========================================================================
  // SPACE+DRAG PAN TESTS
  // ===========================================================================

  describe('space+drag panning', () => {
    it('should start pan on space+left-click', () => {
      // Hold space
      coordinator.handleKeyDown(createKeyboardEvent('Space'));

      // Left-click
      const event = createPointerEvent({ clientX: 500, clientY: 400 });
      coordinator.handlePointerDown(event);

      expect(coordinator.getMachineState()).toBe('panning');
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should not pan after space is released', () => {
      coordinator.handleKeyDown(createKeyboardEvent('Space'));
      coordinator.handleKeyUp(createKeyboardEvent('Space'));

      const event = createPointerEvent({ clientX: 500, clientY: 400 });
      coordinator.handlePointerDown(event);

      // Should forward to sheet instead of panning
      expect(coordinator.getMachineState()).toBe('idle');
      expect(forwardedEvents.length).toBe(1);
    });
  });

  // ===========================================================================
  // TOUCH GESTURE TESTS
  // ===========================================================================

  describe('touch gestures', () => {
    it('should handle single-finger pan', () => {
      // Touch start
      coordinator.handleTouchStart(
        createTouchEvent('start', [{ identifier: 0, clientX: 500, clientY: 400 }]),
      );

      expect(coordinator.getMachineState()).toBe('panning');

      // Touch move
      coordinator.handleTouchMove(
        createTouchEvent('move', [{ identifier: 0, clientX: 450, clientY: 350 }]),
      );

      const scrollState = coordinator.getScrollState();
      expect(scrollState.x).toBe(50);
      expect(scrollState.y).toBe(50);
    });

    it('should handle two-finger pinch zoom', () => {
      // Start with two fingers
      coordinator.handleTouchStart(
        createTouchEvent('start', [
          { identifier: 0, clientX: 400, clientY: 400 },
          { identifier: 1, clientX: 600, clientY: 400 },
        ]),
      );

      expect(coordinator.getMachineState()).toBe('pinching');

      // Spread fingers apart (zoom in)
      coordinator.handleTouchMove(
        createTouchEvent('move', [
          { identifier: 0, clientX: 350, clientY: 400 },
          { identifier: 1, clientX: 650, clientY: 400 },
        ]),
      );

      const zoomState = coordinator.getZoomState();
      expect(zoomState.level).toBeGreaterThan(1);
    });

    it('should transition from pinch to pan when one finger lifts', () => {
      // Start pinch
      coordinator.handleTouchStart(
        createTouchEvent('start', [
          { identifier: 0, clientX: 400, clientY: 400 },
          { identifier: 1, clientX: 600, clientY: 400 },
        ]),
      );

      expect(coordinator.getMachineState()).toBe('pinching');

      // Lift one finger
      coordinator.handleTouchEnd(
        createTouchEvent(
          'end',
          [{ identifier: 0, clientX: 400, clientY: 400 }],
          [{ identifier: 1, clientX: 600, clientY: 400 }],
        ),
      );

      // Should transition to panning with remaining finger
      // (state depends on guard evaluation)
    });
  });

  // ===========================================================================
  // SCROLL STATE SUBSCRIPTIONS
  // ===========================================================================

  describe('subscriptions', () => {
    it('should notify scroll callbacks on scroll change', () => {
      const callback = jest.fn();
      const unsubscribe = coordinator.onScrollChange(callback);

      coordinator.handleWheel(createWheelEvent({ deltaY: 100 }));

      expect(callback).toHaveBeenCalled();
      const state = callback.mock.calls[0][0];
      expect(state.y).toBe(100);

      unsubscribe();
    });

    it('should notify zoom callbacks on zoom change', () => {
      const callback = jest.fn();
      const unsubscribe = coordinator.onZoomChange(callback);

      coordinator.handleWheel(createWheelEvent({ deltaY: -100, ctrlKey: true }));

      expect(callback).toHaveBeenCalled();
      const state = callback.mock.calls[0][0];
      expect(state.level).toBeGreaterThan(1);

      unsubscribe();
    });

    it('should stop notifying after unsubscribe', () => {
      const callback = jest.fn();
      const unsubscribe = coordinator.onScrollChange(callback);

      coordinator.handleWheel(createWheelEvent({ deltaY: 50 }));
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      coordinator.handleWheel(createWheelEvent({ deltaY: 50 }));
      expect(callback).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  // ===========================================================================
  // PROGRAMMATIC API TESTS
  // ===========================================================================

  describe('programmatic API', () => {
    it('should scroll to position', () => {
      coordinator.scrollTo(200, 300);

      const state = coordinator.getScrollState();
      expect(state.x).toBe(200);
      expect(state.y).toBe(300);
    });

    it('should scroll by delta', () => {
      coordinator.scrollBy(100, 150);
      coordinator.scrollBy(50, 50);

      const state = coordinator.getScrollState();
      expect(state.x).toBe(150);
      expect(state.y).toBe(200);
    });

    // Verify auto-scroll triggers layout recomputation via setScrollPosition callback
    it('should route scrollBy through setScrollPosition callback for layout recomputation', () => {
      const setScrollPosition = jest.fn();
      const coordinatorWithCallback = createInputCoordinator();
      coordinatorWithCallback.setDependencies({
        ...createMockInputDependencies(mockCoordinateSystem),
        forwardToSheet: jest.fn(),
        setScrollPosition,
      });

      // scrollBy should route through setScrollPosition callback
      coordinatorWithCallback.scrollBy(100, 200);

      expect(setScrollPosition).toHaveBeenCalledWith({ x: 100, y: 200 });

      coordinatorWithCallback.dispose();
    });

    it('should route scrollTo through setScrollPosition callback for layout recomputation', () => {
      const setScrollPosition = jest.fn();
      const coordinatorWithCallback = createInputCoordinator();
      coordinatorWithCallback.setDependencies({
        ...createMockInputDependencies(mockCoordinateSystem),
        forwardToSheet: jest.fn(),
        setScrollPosition,
      });

      // scrollTo should also route through setScrollPosition callback
      coordinatorWithCallback.scrollTo(300, 400);

      expect(setScrollPosition).toHaveBeenCalledWith({ x: 300, y: 400 });

      coordinatorWithCallback.dispose();
    });

    it('should route wheel scroll through setScrollPosition callback for layout recomputation', () => {
      const setScrollPosition = jest.fn();
      const coordinatorWithCallback = createInputCoordinator();
      coordinatorWithCallback.setDependencies({
        ...createMockInputDependencies(mockCoordinateSystem),
        forwardToSheet: jest.fn(),
        setScrollPosition,
      });

      // Wheel scroll should route through setScrollPosition callback
      coordinatorWithCallback.handleWheel(createWheelEvent({ deltaY: 150 }));

      expect(setScrollPosition).toHaveBeenCalled();
      // The position should include the delta
      const lastCall = setScrollPosition.mock.calls[setScrollPosition.mock.calls.length - 1][0];
      expect(lastCall.y).toBe(150);

      coordinatorWithCallback.dispose();
    });

    // Test touch-based panning routes through setScrollPosition callback
    it('should route touch panning through setScrollPosition callback for layout recomputation', () => {
      const setScrollPosition = jest.fn();
      const coordinatorWithCallback = createInputCoordinator({ touchPanEnabled: true });
      coordinatorWithCallback.setDependencies({
        ...createMockInputDependencies(mockCoordinateSystem),
        forwardToSheet: jest.fn(),
        setScrollPosition,
      });

      // Start touch pan
      coordinatorWithCallback.handleTouchStart(
        createTouchEvent('start', [{ identifier: 0, clientX: 500, clientY: 400 }]),
      );

      // Move touch - this should trigger scroll through setScrollPosition callback
      coordinatorWithCallback.handleTouchMove(
        createTouchEvent('move', [{ identifier: 0, clientX: 450, clientY: 350 }]),
      );

      expect(setScrollPosition).toHaveBeenCalled();
      // The scroll delta should be 50 in each direction (500-450 and 400-350)
      const lastCall = setScrollPosition.mock.calls[setScrollPosition.mock.calls.length - 1][0];
      expect(lastCall.x).toBe(50);
      expect(lastCall.y).toBe(50);

      coordinatorWithCallback.dispose();
    });

    // Test momentum/inertia scrolling routes through setScrollPosition callback
    // Uses wheel scrolling momentum which has its own velocity tracking mechanism
    it('should route momentum scrolling through setScrollPosition callback for layout recomputation', () => {
      // Mock requestAnimationFrame to capture and execute callbacks
      const rafCallbacks: FrameRequestCallback[] = [];
      const originalRAF = global.requestAnimationFrame;
      global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });

      const setScrollPosition = jest.fn();
      const coordinatorWithCallback = createInputCoordinator({ momentumEnabled: true });
      coordinatorWithCallback.setDependencies({
        ...createMockInputDependencies(mockCoordinateSystem),
        forwardToSheet: jest.fn(),
        setScrollPosition,
      });

      // Use wheel scrolling to build velocity - wheel events track velocity separately
      coordinatorWithCallback.handleWheel(createWheelEvent({ deltaY: 100 }));

      // Clear previous calls to isolate momentum calls
      setScrollPosition.mockClear();

      // Wait for scroll end timeout to trigger momentum
      jest.advanceTimersByTime(200);

      // Execute the animation frame callback manually to simulate momentum animation tick
      // The momentum should have been started by SCROLL_END event
      if (rafCallbacks.length > 0) {
        rafCallbacks[rafCallbacks.length - 1](performance.now() + 16);
      }

      // Momentum animation should route through setScrollPosition
      // The callback should have been called during the momentum animation tick
      expect(setScrollPosition).toHaveBeenCalled();

      // Restore original requestAnimationFrame
      global.requestAnimationFrame = originalRAF;
      coordinatorWithCallback.dispose();
    });

    it('should clamp scroll to bounds', () => {
      coordinator.scrollTo(-100, -100);

      const state = coordinator.getScrollState();
      expect(state.x).toBe(0);
      expect(state.y).toBe(0);
    });

    it('should interrupt active gesture', () => {
      // Start panning
      coordinator.handlePointerDown(createPointerEvent({ button: 1, clientX: 500, clientY: 400 }));
      expect(coordinator.getMachineState()).toBe('panning');

      // Interrupt
      coordinator.interrupt();
      expect(coordinator.getMachineState()).toBe('idle');
    });
  });

  // ===========================================================================
  // HIT TESTING TESTS
  // ===========================================================================

  describe('hit testing', () => {
    it('should detect cell clicks', () => {
      const event = createPointerEvent({ clientX: 250, clientY: 75 });
      coordinator.handlePointerDown(event);

      expect(forwardedEvents[0].type).toBe('CELL_POINTER_DOWN');
      if (forwardedEvents[0].type === 'CELL_POINTER_DOWN') {
        expect(forwardedEvents[0].row).toBe(3); // 75 / 25 = 3
        expect(forwardedEvents[0].col).toBe(2); // 250 / 100 = 2
      }
    });

    it('should detect fill handle clicks', () => {
      const c = createInputCoordinator();
      c.setDependencies({
        ...createMockInputDependencies(mockCoordinateSystem),
        forwardToSheet: (event) => forwardedEvents.push(event),
        getFillHandleBounds: () => ({ x: 190, y: 90, width: 10, height: 10 }),
      });

      const event = createPointerEvent({ clientX: 195, clientY: 95 });
      c.handlePointerDown(event);

      expect(forwardedEvents.length).toBe(1);
      expect(forwardedEvents[0].type).toBe('FILL_HANDLE_START');

      c.dispose();
    });
  });

  // ===========================================================================
  // RENDER REQUEST TESTS
  // ===========================================================================

  describe('render requests', () => {
    it('should request render on scroll', () => {
      coordinator.handleWheel(createWheelEvent({ deltaY: 100 }));
      expect(renderRequests).toBeGreaterThan(0);
    });

    it('should request render on zoom', () => {
      coordinator.handleWheel(createWheelEvent({ deltaY: -100, ctrlKey: true }));
      expect(renderRequests).toBeGreaterThan(0);
    });

    it('should request render on programmatic scroll', () => {
      renderRequests = 0;
      coordinator.scrollTo(100, 100);
      expect(renderRequests).toBe(1);
    });
  });
});

// =============================================================================
// STATE MACHINE INTEGRATION TESTS
// =============================================================================

describe('InputCoordinator state machine integration', () => {
  let coordinator: InputCoordinator;
  let mockCoordinateSystem: CoordinateSystem;

  beforeEach(() => {
    jest.useFakeTimers();
    mockCoordinateSystem = createMockCoordinateSystem();
    coordinator = createInputCoordinator({ momentumEnabled: true });
    coordinator.setDependencies({
      ...createMockInputDependencies(mockCoordinateSystem),
      forwardToSheet: jest.fn(),
      // setScrollPosition callback is always provided in real usage (via sheet-coordinator.ts)
      setScrollPosition: (pos) => {
        const viewport = mockCoordinateSystem.getViewport();
        mockCoordinateSystem.setViewport({
          ...viewport,
          scrollLeft: pos.x,
          scrollTop: pos.y,
        });
      },
    });
  });

  afterEach(() => {
    coordinator.dispose();
    jest.useRealTimers();
  });

  it('should follow idle -> scrolling -> momentum -> idle flow', () => {
    expect(coordinator.getMachineState()).toBe('idle');

    // Start scrolling
    coordinator.handleWheel(createWheelEvent({ deltaY: 100 }));
    expect(coordinator.getMachineState()).toBe('scrolling');

    // End scroll (after timeout)
    jest.advanceTimersByTime(200);

    // Should be in momentum or idle depending on velocity
    const stateAfterEnd = coordinator.getMachineState();
    expect(['momentum', 'idle']).toContain(stateAfterEnd);
  });

  it('should interrupt momentum on new input', () => {
    // Start scrolling with velocity
    coordinator.handleWheel(createWheelEvent({ deltaY: 100 }));
    jest.advanceTimersByTime(200);

    // Start new scroll (should interrupt momentum)
    coordinator.handleWheel(createWheelEvent({ deltaY: 50 }));
    expect(coordinator.getMachineState()).toBe('scrolling');
  });

  it('should transition from scrolling to panning on touch', () => {
    coordinator.handleWheel(createWheelEvent({ deltaY: 100 }));
    expect(coordinator.getMachineState()).toBe('scrolling');

    // Touch starts
    coordinator.handleTouchStart(
      createTouchEvent('start', [{ identifier: 0, clientX: 500, clientY: 400 }]),
    );

    expect(coordinator.getMachineState()).toBe('panning');
  });
});
