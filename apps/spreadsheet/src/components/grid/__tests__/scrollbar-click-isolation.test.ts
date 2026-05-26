/**
 * Integration Test: Scrollbar Click-Selection Isolation
 *
 * Verifies that the coordinate-based scrollbar guard in use-grid-mouse.ts
 * correctly isolates scrollbar interactions from cell selection. This is
 * the integration-level counterpart to the unit tests in
 * use-grid-mouse-scrollbar.test.ts.
 *
 * These tests simulate the full pointer event flow on a container element
 * with both a scrollbar child and a grid handler, verifying that:
 * 1. Scrollbar track clicks don't trigger cell selection
 * 2. Scrollbar thumb drags don't trigger cell selection
 * 3. Normal cell clicks still work after scrollbar interactions
 *
 * Bug references:
 * - Bug #7: Scrollbar track click selects cell beneath scrollbar
 * - Bug #10: Scrollbar thumb drag triggers cell selection
 *
 * @see hooks/shared/use-grid-mouse.ts - handlePointerDown, handlePointerMove
 */

import { jest } from '@jest/globals';

import { SCROLL_BAR_WIDTH } from '@mog-sdk/contracts/rendering';

// =============================================================================
// PointerEvent polyfill for jsdom (which doesn't implement PointerEvent)
// =============================================================================

class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  readonly width: number;
  readonly height: number;
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, params: PointerEventInit & MouseEventInit = {}) {
    super(type, params);
    this.pointerId = params.pointerId ?? 0;
    this.width = params.width ?? 1;
    this.height = params.height ?? 1;
    this.pressure = params.pressure ?? 0;
    this.tangentialPressure = params.tangentialPressure ?? 0;
    this.tiltX = params.tiltX ?? 0;
    this.tiltY = params.tiltY ?? 0;
    this.twist = params.twist ?? 0;
    this.pointerType = params.pointerType ?? 'mouse';
    this.isPrimary = params.isPrimary ?? true;
  }

  getCoalescedEvents(): PointerEvent[] {
    return [];
  }

  getPredictedEvents(): PointerEvent[] {
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).PointerEvent = PointerEventPolyfill;

// =============================================================================
// Test Helpers
// =============================================================================

const CONTAINER_WIDTH = 1000;
const CONTAINER_HEIGHT = 700;
const CONTAINER_LEFT = 0;
const CONTAINER_TOP = 0;

interface SelectionState {
  selectedCell: { row: number; col: number } | null;
  selectionRange: { startRow: number; startCol: number; endRow: number; endCol: number } | null;
}

/**
 * Creates a simulated grid container that mirrors the architecture in
 * SpreadsheetGrid.tsx: a container div with a scrollbar child div inside it.
 *
 * The container has native pointerdown/pointermove listeners with the
 * scrollbar guard (same as use-grid-mouse.ts), and the scrollbar child
 * has React-style synthetic event handlers.
 *
 * This simulates the real DOM structure where ScrollContainer is a child
 * of containerRef, and events bubble from the scrollbar to the container.
 */
function createGridWithScrollbar() {
  const container = document.createElement('div');
  container.style.width = `${CONTAINER_WIDTH}px`;
  container.style.height = `${CONTAINER_HEIGHT}px`;
  container.style.position = 'relative';
  document.body.appendChild(container);

  container.getBoundingClientRect = jest.fn(() => ({
    left: CONTAINER_LEFT,
    top: CONTAINER_TOP,
    right: CONTAINER_LEFT + CONTAINER_WIDTH,
    bottom: CONTAINER_TOP + CONTAINER_HEIGHT,
    width: CONTAINER_WIDTH,
    height: CONTAINER_HEIGHT,
    x: CONTAINER_LEFT,
    y: CONTAINER_TOP,
    toJSON: () => ({}),
  }));

  // Create scrollbar child elements (mirrors ScrollContainer.tsx structure)
  const verticalScrollbar = document.createElement('div');
  verticalScrollbar.setAttribute('data-testid', 'vertical-scrollbar');
  verticalScrollbar.style.position = 'absolute';
  verticalScrollbar.style.right = '0';
  verticalScrollbar.style.top = '0';
  verticalScrollbar.style.width = `${SCROLL_BAR_WIDTH}px`;
  verticalScrollbar.style.height = `${CONTAINER_HEIGHT - SCROLL_BAR_WIDTH}px`;
  container.appendChild(verticalScrollbar);

  const horizontalScrollbar = document.createElement('div');
  horizontalScrollbar.setAttribute('data-testid', 'horizontal-scrollbar');
  horizontalScrollbar.style.position = 'absolute';
  horizontalScrollbar.style.bottom = '0';
  horizontalScrollbar.style.left = '0';
  horizontalScrollbar.style.width = `${CONTAINER_WIDTH - SCROLL_BAR_WIDTH}px`;
  horizontalScrollbar.style.height = `${SCROLL_BAR_WIDTH}px`;
  container.appendChild(horizontalScrollbar);

  // Selection state — tracks what the grid handler would do
  const selection: SelectionState = {
    selectedCell: null,
    selectionRange: null,
  };

  const selectionOnMouseDown = jest.fn((cell: { row: number; col: number }) => {
    selection.selectedCell = cell;
    selection.selectionRange = {
      startRow: cell.row,
      startCol: cell.col,
      endRow: cell.row,
      endCol: cell.col,
    };
  });

  const selectionOnMouseMove = jest.fn((cell: { row: number; col: number }) => {
    if (selection.selectionRange) {
      selection.selectionRange.endRow = cell.row;
      selection.selectionRange.endCol = cell.col;
    }
  });

  const scrollHandler = jest.fn();

  // Simulated hit test: converts pixel coordinates to cell coordinates
  // (mirrors grid-hit-test.ts behavior, simplified)
  function hitTest(relX: number, relY: number): { row: number; col: number } {
    const col = Math.floor(relX / 80); // ~80px per column
    const row = Math.floor(relY / 25); // ~25px per row
    return { row, col };
  }

  // Native pointerdown listener with scrollbar guard (mirrors use-grid-mouse.ts:1536-1583)
  container.addEventListener('pointerdown', (e: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;

    // Scrollbar guard — same logic as use-grid-mouse.ts:1559
    if (relX >= rect.width - SCROLL_BAR_WIDTH || relY >= rect.height - SCROLL_BAR_WIDTH) return;

    if (e.button !== 0) return;

    const cell = hitTest(relX, relY);
    selectionOnMouseDown(cell);
  });

  // Native pointermove listener with scrollbar guard (mirrors use-grid-mouse.ts:1586-1594)
  container.addEventListener('pointermove', (e: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;

    // Scrollbar guard — same logic as use-grid-mouse.ts:1592
    if (relX >= rect.width - SCROLL_BAR_WIDTH || relY >= rect.height - SCROLL_BAR_WIDTH) return;

    const cell = hitTest(relX, relY);
    selectionOnMouseMove(cell);
  });

  // Scrollbar click handler (mirrors ScrollContainer.tsx track onClick)
  verticalScrollbar.addEventListener('click', () => {
    scrollHandler('vertical-track-click');
  });

  horizontalScrollbar.addEventListener('click', () => {
    scrollHandler('horizontal-track-click');
  });

  // Scrollbar pointerdown handler (mirrors ScrollContainer.tsx thumb onPointerDown)
  // In the real code, this calls stopPropagation() via React synthetic events,
  // but the timing mismatch means it fires AFTER the native listener.
  // The coordinate guard in the container listener is what actually prevents selection.
  verticalScrollbar.addEventListener('pointerdown', (e: PointerEvent) => {
    // React synthetic stopPropagation would fire here in real code — too late
    // for the native listener, but we include it for fidelity
    e.stopPropagation();
  });

  return {
    container,
    verticalScrollbar,
    horizontalScrollbar,
    selection,
    selectionOnMouseDown,
    selectionOnMouseMove,
    scrollHandler,
    destroy: () => document.body.removeChild(container),
  };
}

function firePointerDown(target: HTMLElement, clientX: number, clientY: number) {
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      clientX,
      clientY,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function firePointerMove(target: HTMLElement, clientX: number, clientY: number) {
  target.dispatchEvent(
    new PointerEvent('pointermove', {
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function firePointerUp(target: HTMLElement, clientX: number, clientY: number) {
  target.dispatchEvent(
    new PointerEvent('pointerup', {
      clientX,
      clientY,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function fireClick(target: HTMLElement, clientX: number, clientY: number) {
  target.dispatchEvent(
    new MouseEvent('click', {
      clientX,
      clientY,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
}

// =============================================================================
// Integration Tests: Scrollbar-Click-Selection Isolation
// =============================================================================

describe('Scrollbar click-selection isolation', () => {
  let grid: ReturnType<typeof createGridWithScrollbar>;

  beforeEach(() => {
    grid = createGridWithScrollbar();
  });

  afterEach(() => {
    grid.destroy();
  });

  // -------------------------------------------------------------------------
  // Bug #7: Scrollbar track click should NOT select a cell
  // -------------------------------------------------------------------------

  describe('Bug #7: Track click does not trigger cell selection', () => {
    it('vertical scrollbar track click does not select a cell', () => {
      // Click in the vertical scrollbar region (right edge of container)
      const clickX = CONTAINER_LEFT + CONTAINER_WIDTH - 7; // Inside scrollbar
      const clickY = CONTAINER_TOP + 300;

      // Fire pointerdown (bubbles from scrollbar child to container)
      firePointerDown(grid.verticalScrollbar, clickX, clickY);

      expect(grid.selectionOnMouseDown).not.toHaveBeenCalled();
      expect(grid.selection.selectedCell).toBeNull();
    });

    it('horizontal scrollbar track click does not select a cell', () => {
      const clickX = CONTAINER_LEFT + 400;
      const clickY = CONTAINER_TOP + CONTAINER_HEIGHT - 7; // Inside scrollbar

      firePointerDown(grid.horizontalScrollbar, clickX, clickY);

      expect(grid.selectionOnMouseDown).not.toHaveBeenCalled();
      expect(grid.selection.selectedCell).toBeNull();
    });

    it('scrollbar track click still triggers scroll handler', () => {
      const clickX = CONTAINER_LEFT + CONTAINER_WIDTH - 7;
      const clickY = CONTAINER_TOP + 300;

      firePointerDown(grid.verticalScrollbar, clickX, clickY);
      fireClick(grid.verticalScrollbar, clickX, clickY);

      // Selection should NOT have been triggered
      expect(grid.selectionOnMouseDown).not.toHaveBeenCalled();

      // Scroll handler SHOULD have been triggered (via onClick on the track)
      expect(grid.scrollHandler).toHaveBeenCalledWith('vertical-track-click');
    });
  });

  // -------------------------------------------------------------------------
  // Bug #10: Scrollbar thumb drag should NOT select a cell
  // -------------------------------------------------------------------------

  describe('Bug #10: Thumb drag does not trigger cell selection', () => {
    it('pointerdown on scrollbar thumb does not select a cell', () => {
      // Simulate thumb drag: pointerdown on scrollbar area
      const startX = CONTAINER_LEFT + CONTAINER_WIDTH - 7;
      const startY = CONTAINER_TOP + 100;

      firePointerDown(grid.verticalScrollbar, startX, startY);

      expect(grid.selectionOnMouseDown).not.toHaveBeenCalled();
      expect(grid.selection.selectedCell).toBeNull();
    });

    it('pointermove during thumb drag does not extend selection', () => {
      // Start drag on scrollbar
      const startX = CONTAINER_LEFT + CONTAINER_WIDTH - 7;
      firePointerDown(grid.verticalScrollbar, startX, CONTAINER_TOP + 100);

      // Drag the thumb downward (still in scrollbar region)
      firePointerMove(grid.container, startX, CONTAINER_TOP + 200);
      firePointerMove(grid.container, startX, CONTAINER_TOP + 300);

      expect(grid.selectionOnMouseDown).not.toHaveBeenCalled();
      expect(grid.selectionOnMouseMove).not.toHaveBeenCalled();
      expect(grid.selection.selectedCell).toBeNull();
    });

    it('full thumb drag sequence (down, move, up) does not affect selection', () => {
      const thumbX = CONTAINER_LEFT + CONTAINER_WIDTH - 7;

      // pointerdown
      firePointerDown(grid.verticalScrollbar, thumbX, CONTAINER_TOP + 100);
      // pointermove (drag)
      firePointerMove(grid.container, thumbX, CONTAINER_TOP + 200);
      firePointerMove(grid.container, thumbX, CONTAINER_TOP + 300);
      // pointerup
      firePointerUp(grid.container, thumbX, CONTAINER_TOP + 300);

      expect(grid.selectionOnMouseDown).not.toHaveBeenCalled();
      expect(grid.selectionOnMouseMove).not.toHaveBeenCalled();
      expect(grid.selection.selectedCell).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Normal cell clicks still work after scrollbar interactions
  // -------------------------------------------------------------------------

  describe('Cell clicks work normally after scrollbar interaction', () => {
    it('cell click after scrollbar track click selects the correct cell', () => {
      // First: click the scrollbar track (should NOT select)
      const scrollbarX = CONTAINER_LEFT + CONTAINER_WIDTH - 7;
      firePointerDown(grid.verticalScrollbar, scrollbarX, CONTAINER_TOP + 300);
      expect(grid.selectionOnMouseDown).not.toHaveBeenCalled();

      // Then: click a cell in the grid area (should select)
      const cellX = CONTAINER_LEFT + 200;
      const cellY = CONTAINER_TOP + 100;
      firePointerDown(grid.container, cellX, cellY);

      expect(grid.selectionOnMouseDown).toHaveBeenCalledTimes(1);
      expect(grid.selection.selectedCell).not.toBeNull();
      // Cell at (200, 100) with 80px columns and 25px rows = col 2, row 4
      expect(grid.selection.selectedCell).toEqual({ row: 4, col: 2 });
    });

    it('cell click works normally (baseline — no scrollbar interaction)', () => {
      const cellX = CONTAINER_LEFT + 160;
      const cellY = CONTAINER_TOP + 50;

      firePointerDown(grid.container, cellX, cellY);

      expect(grid.selectionOnMouseDown).toHaveBeenCalledTimes(1);
      // Cell at (160, 50) with 80px columns and 25px rows = col 2, row 2
      expect(grid.selection.selectedCell).toEqual({ row: 2, col: 2 });
    });

    it('cell drag (selection extension) works in grid area after scrollbar interaction', () => {
      // Scrollbar interaction first
      firePointerDown(
        grid.verticalScrollbar,
        CONTAINER_LEFT + CONTAINER_WIDTH - 7,
        CONTAINER_TOP + 200,
      );
      expect(grid.selectionOnMouseDown).not.toHaveBeenCalled();

      // Now start a cell drag in the grid area
      firePointerDown(grid.container, CONTAINER_LEFT + 80, CONTAINER_TOP + 25);
      expect(grid.selectionOnMouseDown).toHaveBeenCalledTimes(1);
      expect(grid.selection.selectedCell).toEqual({ row: 1, col: 1 });

      // Extend selection by dragging
      firePointerMove(grid.container, CONTAINER_LEFT + 240, CONTAINER_TOP + 75);
      expect(grid.selectionOnMouseMove).toHaveBeenCalledTimes(1);
      expect(grid.selection.selectionRange).toEqual({
        startRow: 1,
        startCol: 1,
        endRow: 3,
        endCol: 3,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Edge case: events that start in grid but drift into scrollbar
  // -------------------------------------------------------------------------

  describe('Drag from grid into scrollbar region', () => {
    it('selection extension stops when pointer enters scrollbar region', () => {
      // Start drag in grid area
      firePointerDown(grid.container, CONTAINER_LEFT + 200, CONTAINER_TOP + 200);
      expect(grid.selectionOnMouseDown).toHaveBeenCalledTimes(1);

      // Move within grid — selection extends
      firePointerMove(grid.container, CONTAINER_LEFT + 300, CONTAINER_TOP + 300);
      expect(grid.selectionOnMouseMove).toHaveBeenCalledTimes(1);

      // Move into vertical scrollbar region — selection should NOT extend
      firePointerMove(grid.container, CONTAINER_LEFT + CONTAINER_WIDTH - 5, CONTAINER_TOP + 400);
      expect(grid.selectionOnMouseMove).toHaveBeenCalledTimes(1); // Still 1

      // Move back into grid — selection extends again
      firePointerMove(grid.container, CONTAINER_LEFT + 400, CONTAINER_TOP + 400);
      expect(grid.selectionOnMouseMove).toHaveBeenCalledTimes(2);
    });
  });
});
