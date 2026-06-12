/**
 * Scrollbar Region Guard Tests (Bugs #7 and #10)
 *
 * Tests for the coordinate-based scrollbar guard in handlePointerDown and
 * handlePointerMove (use-grid-mouse.ts). The guard prevents pointer events
 * in the scrollbar region from triggering cell selection — fixing both:
 *
 * - Bug #7: Scrollbar track click selects cell beneath scrollbar
 * - Bug #10: Scrollbar thumb drag triggers cell selection
 *
 * The guard logic:
 * const rect = container.getBoundingClientRect;
 * const relX = e.clientX - rect.left;
 * const relY = e.clientY - rect.top;
 * if (relX >= rect.width - SCROLL_BAR_WIDTH || relY >= rect.height - SCROLL_BAR_WIDTH) return;
 *
 * We test this at the DOM level: a container element with native event
 * listeners that mirror the guard, verifying that events in scrollbar
 * regions are rejected and events in the grid area are accepted.
 *
 * @see use-grid-mouse.ts - handlePointerDown (line ~1536), handlePointerMove (line ~1586)
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

const CONTAINER_WIDTH = 800;
const CONTAINER_HEIGHT = 600;
const CONTAINER_LEFT = 50;
const CONTAINER_TOP = 100;

/**
 * Replicates the scrollbar guard logic from use-grid-mouse.ts handlePointerDown.
 * Returns true if the event should be processed (grid area), false if rejected (scrollbar).
 */
function isInGridArea(clientX: number, clientY: number): boolean {
  const relX = clientX - CONTAINER_LEFT;
  const relY = clientY - CONTAINER_TOP;
  if (relX >= CONTAINER_WIDTH - SCROLL_BAR_WIDTH || relY >= CONTAINER_HEIGHT - SCROLL_BAR_WIDTH) {
    return false;
  }
  return true;
}

/**
 * Creates a container element with mocked getBoundingClientRect and attaches
 * native pointer listeners that replicate the scrollbar guard from use-grid-mouse.ts.
 *
 * Returns { container, handler } where handler is a jest.fn() that's called
 * only when the pointer event passes the scrollbar guard (i.e., is in the grid area).
 */
function createGuardedContainer(options: { isHeaderResizeActive?: () => boolean } = {}) {
  const container = document.createElement('div');
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

  const handleMouseDown = jest.fn();
  const handleMouseMove = jest.fn();

  // Replicate handlePointerDown guard from use-grid-mouse.ts:1553-1559
  container.addEventListener('pointerdown', (e: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    if (relX >= rect.width - SCROLL_BAR_WIDTH || relY >= rect.height - SCROLL_BAR_WIDTH) return;
    handleMouseDown(e);
  });

  // Replicate handlePointerMove guard from use-grid-mouse.ts:1587-1592
  container.addEventListener('pointermove', (e: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const isHeaderResizeActive = options.isHeaderResizeActive?.() ?? false;
    if (
      !isHeaderResizeActive &&
      (relX >= rect.width - SCROLL_BAR_WIDTH || relY >= rect.height - SCROLL_BAR_WIDTH)
    ) {
      return;
    }
    handleMouseMove(e);
  });

  return { container, handleMouseDown, handleMouseMove };
}

function firePointerDown(target: HTMLElement, clientX: number, clientY: number) {
  const event = new PointerEvent('pointerdown', {
    clientX,
    clientY,
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
}

function firePointerMove(target: HTMLElement, clientX: number, clientY: number) {
  const event = new PointerEvent('pointermove', {
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
}

// =============================================================================
// Unit Tests: Scrollbar Region Rejection
// =============================================================================

describe('Scrollbar region guard (handlePointerDown)', () => {
  let container: HTMLElement;
  let handleMouseDown: jest.Mock;
  let handleMouseMove: jest.Mock;

  beforeEach(() => {
    ({ container, handleMouseDown, handleMouseMove } = createGuardedContainer());
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  // -------------------------------------------------------------------------
  // Bug #10: Thumb drag in vertical scrollbar region
  // -------------------------------------------------------------------------

  it('rejects pointerdown in vertical scrollbar region (thumb drag case)', () => {
    // Click at right edge of container, within SCROLL_BAR_WIDTH of the right boundary
    const clientX = CONTAINER_LEFT + CONTAINER_WIDTH - 5; // 5px from right edge
    const clientY = CONTAINER_TOP + 200; // Middle of container vertically

    firePointerDown(container, clientX, clientY);

    expect(handleMouseDown).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Bug #7: Track click in horizontal scrollbar region
  // -------------------------------------------------------------------------

  it('rejects pointerdown in horizontal scrollbar region (track click case)', () => {
    // Click at bottom edge of container, within SCROLL_BAR_WIDTH of the bottom boundary
    const clientX = CONTAINER_LEFT + 200; // Middle of container horizontally
    const clientY = CONTAINER_TOP + CONTAINER_HEIGHT - 5; // 5px from bottom edge

    firePointerDown(container, clientX, clientY);

    expect(handleMouseDown).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Corner intersection (both scrollbars overlap)
  // -------------------------------------------------------------------------

  it('rejects pointerdown in bottom-right corner intersection', () => {
    const clientX = CONTAINER_LEFT + CONTAINER_WIDTH - 5;
    const clientY = CONTAINER_TOP + CONTAINER_HEIGHT - 5;

    firePointerDown(container, clientX, clientY);

    expect(handleMouseDown).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Boundary: click exactly at SCROLL_BAR_WIDTH boundary (should be rejected)
  // -------------------------------------------------------------------------

  it('rejects pointerdown at exact vertical scrollbar boundary', () => {
    // relX = CONTAINER_WIDTH - SCROLL_BAR_WIDTH, which satisfies >= check
    const clientX = CONTAINER_LEFT + CONTAINER_WIDTH - SCROLL_BAR_WIDTH;
    const clientY = CONTAINER_TOP + 200;

    firePointerDown(container, clientX, clientY);

    expect(handleMouseDown).not.toHaveBeenCalled();
  });

  it('rejects pointerdown at exact horizontal scrollbar boundary', () => {
    const clientX = CONTAINER_LEFT + 200;
    const clientY = CONTAINER_TOP + CONTAINER_HEIGHT - SCROLL_BAR_WIDTH;

    firePointerDown(container, clientX, clientY);

    expect(handleMouseDown).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Normal grid area: click just inside the grid boundary (should be accepted)
  // -------------------------------------------------------------------------

  it('accepts pointerdown 1px inside the vertical scrollbar boundary', () => {
    // relX = CONTAINER_WIDTH - SCROLL_BAR_WIDTH - 1, which does NOT satisfy >= check
    const clientX = CONTAINER_LEFT + CONTAINER_WIDTH - SCROLL_BAR_WIDTH - 1;
    const clientY = CONTAINER_TOP + 200;

    firePointerDown(container, clientX, clientY);

    expect(handleMouseDown).toHaveBeenCalledTimes(1);
  });

  it('accepts pointerdown 1px inside the horizontal scrollbar boundary', () => {
    const clientX = CONTAINER_LEFT + 200;
    const clientY = CONTAINER_TOP + CONTAINER_HEIGHT - SCROLL_BAR_WIDTH - 1;

    firePointerDown(container, clientX, clientY);

    expect(handleMouseDown).toHaveBeenCalledTimes(1);
  });

  it('accepts pointerdown in center of grid area', () => {
    const clientX = CONTAINER_LEFT + CONTAINER_WIDTH / 2;
    const clientY = CONTAINER_TOP + CONTAINER_HEIGHT / 2;

    firePointerDown(container, clientX, clientY);

    expect(handleMouseDown).toHaveBeenCalledTimes(1);
  });

  it('accepts pointerdown at top-left corner of grid', () => {
    const clientX = CONTAINER_LEFT + 1;
    const clientY = CONTAINER_TOP + 1;

    firePointerDown(container, clientX, clientY);

    expect(handleMouseDown).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Unit Tests: Pointer Move Guard (prevents selection extension during drag)
// =============================================================================

describe('Scrollbar region guard (handlePointerMove)', () => {
  let container: HTMLElement;
  let handleMouseDown: jest.Mock;
  let handleMouseMove: jest.Mock;

  beforeEach(() => {
    ({ container, handleMouseDown, handleMouseMove } = createGuardedContainer());
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('rejects pointermove in vertical scrollbar region', () => {
    const clientX = CONTAINER_LEFT + CONTAINER_WIDTH - 5;
    const clientY = CONTAINER_TOP + 200;

    firePointerMove(container, clientX, clientY);

    expect(handleMouseMove).not.toHaveBeenCalled();
  });

  it('rejects pointermove in horizontal scrollbar region', () => {
    const clientX = CONTAINER_LEFT + 200;
    const clientY = CONTAINER_TOP + CONTAINER_HEIGHT - 5;

    firePointerMove(container, clientX, clientY);

    expect(handleMouseMove).not.toHaveBeenCalled();
  });

  it('accepts pointermove in grid area', () => {
    const clientX = CONTAINER_LEFT + 200;
    const clientY = CONTAINER_TOP + 200;

    firePointerMove(container, clientX, clientY);

    expect(handleMouseMove).toHaveBeenCalledTimes(1);
  });

  it('does not extend selection when pointer drifts from grid into scrollbar during drag', () => {
    // Simulate drag: pointerdown in grid area, then pointermove into scrollbar
    firePointerDown(container, CONTAINER_LEFT + 200, CONTAINER_TOP + 200);
    expect(handleMouseDown).toHaveBeenCalledTimes(1);

    // Move within grid — should be accepted
    firePointerMove(container, CONTAINER_LEFT + 250, CONTAINER_TOP + 250);
    expect(handleMouseMove).toHaveBeenCalledTimes(1);

    // Move into vertical scrollbar region — should be rejected
    firePointerMove(container, CONTAINER_LEFT + CONTAINER_WIDTH - 3, CONTAINER_TOP + 250);
    expect(handleMouseMove).toHaveBeenCalledTimes(1); // Still 1, not 2

    // Move into horizontal scrollbar region — should be rejected
    firePointerMove(container, CONTAINER_LEFT + 250, CONTAINER_TOP + CONTAINER_HEIGHT - 3);
    expect(handleMouseMove).toHaveBeenCalledTimes(1); // Still 1, not 2

    // Move back into grid area — should be accepted again
    firePointerMove(container, CONTAINER_LEFT + 300, CONTAINER_TOP + 300);
    expect(handleMouseMove).toHaveBeenCalledTimes(2);
  });

  it('keeps header resize active when pointer moves into scrollbar region', () => {
    document.body.removeChild(container);
    ({ container, handleMouseDown, handleMouseMove } = createGuardedContainer({
      isHeaderResizeActive: () => true,
    }));

    firePointerMove(container, CONTAINER_LEFT + 250, CONTAINER_TOP + CONTAINER_HEIGHT - 3);
    firePointerMove(container, CONTAINER_LEFT + CONTAINER_WIDTH - 3, CONTAINER_TOP + 250);

    expect(handleMouseMove).toHaveBeenCalledTimes(2);
    expect(handleMouseDown).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Pure Function Tests: isInGridArea validation
// =============================================================================

describe('isInGridArea (guard logic validation)', () => {
  it('returns false for vertical scrollbar region', () => {
    expect(isInGridArea(CONTAINER_LEFT + CONTAINER_WIDTH - 1, CONTAINER_TOP + 200)).toBe(false);
    expect(
      isInGridArea(CONTAINER_LEFT + CONTAINER_WIDTH - SCROLL_BAR_WIDTH, CONTAINER_TOP + 200),
    ).toBe(false);
  });

  it('returns false for horizontal scrollbar region', () => {
    expect(isInGridArea(CONTAINER_LEFT + 200, CONTAINER_TOP + CONTAINER_HEIGHT - 1)).toBe(false);
    expect(
      isInGridArea(CONTAINER_LEFT + 200, CONTAINER_TOP + CONTAINER_HEIGHT - SCROLL_BAR_WIDTH),
    ).toBe(false);
  });

  it('returns false for corner intersection', () => {
    expect(
      isInGridArea(CONTAINER_LEFT + CONTAINER_WIDTH - 1, CONTAINER_TOP + CONTAINER_HEIGHT - 1),
    ).toBe(false);
  });

  it('returns true for grid area', () => {
    expect(isInGridArea(CONTAINER_LEFT + 200, CONTAINER_TOP + 200)).toBe(true);
    expect(
      isInGridArea(
        CONTAINER_LEFT + CONTAINER_WIDTH - SCROLL_BAR_WIDTH - 1,
        CONTAINER_TOP + CONTAINER_HEIGHT - SCROLL_BAR_WIDTH - 1,
      ),
    ).toBe(true);
  });

  it('SCROLL_BAR_WIDTH is 14 (matches the constant used in production)', () => {
    expect(SCROLL_BAR_WIDTH).toBe(14);
  });
});
