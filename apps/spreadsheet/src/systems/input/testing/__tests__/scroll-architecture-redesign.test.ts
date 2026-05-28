/**
 * Scroll Architecture Redesign Tests
 *
 * Tests for the scroll architecture redesign (phases 1-3):
 * - setScrollPosition callback is wired and fires synchronously
 * - Single propagation path (no dual-update)
 * - Trackpad vs discrete wheel input discrimination
 *
 */

import type { InputCoordinatorDependencies } from '../../coordination/input-coordination';
import { InputCoordinator } from '../../coordination/input-coordination';
import { createMockCoordinateSystem } from '../mock-coordinate-system';

function createMinimalDeps(
  overrides?: Partial<InputCoordinatorDependencies>,
): InputCoordinatorDependencies {
  return {
    coordinateSystem: createMockCoordinateSystem(),
    forwardToSheet: () => {},
    getActiveSheetId: () => 'sheet-1',
    ...overrides,
  };
}

// =============================================================================
// setScrollPosition callback wiring
// =============================================================================

describe('setScrollPosition callback', () => {
  let coordinator: InputCoordinator;

  beforeEach(() => {
    coordinator = new InputCoordinator();
  });

  afterEach(() => {
    coordinator.dispose();
  });

  it('setScrollPosition is called synchronously on scrollTo()', () => {
    const positions: Array<{ x: number; y: number }> = [];
    coordinator.setDependencies(
      createMinimalDeps({
        setScrollPosition: (pos) => positions.push({ x: pos.x, y: pos.y }),
      }),
    );

    coordinator.scrollTo(100, 200);

    // Synchronous — should be called immediately, not in a microtask/effect
    expect(positions).toHaveLength(1);
    expect(positions[0]).toEqual({ x: 100, y: 200 });
  });

  it('setScrollPosition is called synchronously on scrollBy()', () => {
    const positions: Array<{ x: number; y: number }> = [];
    coordinator.setDependencies(
      createMinimalDeps({
        setScrollPosition: (pos) => positions.push({ x: pos.x, y: pos.y }),
      }),
    );

    coordinator.scrollBy(10, 20);

    expect(positions).toHaveLength(1);
    expect(positions[0]).toEqual({ x: 10, y: 20 });
  });

  it('setScrollPosition receives accumulated position on multiple scrollBy calls', () => {
    const positions: Array<{ x: number; y: number }> = [];
    coordinator.setDependencies(
      createMinimalDeps({
        setScrollPosition: (pos) => positions.push({ x: pos.x, y: pos.y }),
      }),
    );

    coordinator.scrollBy(10, 20);
    coordinator.scrollBy(5, 10);

    expect(positions).toHaveLength(2);
    expect(positions[1]).toEqual({ x: 15, y: 30 });
  });

  it('setContentScrollBounds publishes when new bounds clamp the current position', () => {
    const positions: Array<{ x: number; y: number }> = [];
    const scrollStates: Array<{ x: number; y: number }> = [];
    let renderRequests = 0;
    coordinator.setDependencies(
      createMinimalDeps({
        setScrollPosition: (pos) => positions.push({ x: pos.x, y: pos.y }),
        requestRender: () => renderRequests++,
      }),
    );
    coordinator.onScrollChange((state) => scrollStates.push({ x: state.x, y: state.y }));

    coordinator.setContentScrollBounds(1000, 1000);
    coordinator.scrollTo(900, 700);
    coordinator.setContentScrollBounds(250, 300);

    expect(coordinator.getScrollState()).toMatchObject({ x: 250, y: 300 });
    expect(positions).toEqual([
      { x: 900, y: 700 },
      { x: 250, y: 300 },
    ]);
    expect(scrollStates).toEqual([
      { x: 900, y: 700 },
      { x: 250, y: 300 },
    ]);
    expect(renderRequests).toBe(2);
  });

  it('setContentScrollBounds does not republish when position remains in bounds', () => {
    const positions: Array<{ x: number; y: number }> = [];
    let renderRequests = 0;
    coordinator.setDependencies(
      createMinimalDeps({
        setScrollPosition: (pos) => positions.push({ x: pos.x, y: pos.y }),
        requestRender: () => renderRequests++,
      }),
    );

    coordinator.setContentScrollBounds(1000, 1000);

    expect(positions).toHaveLength(0);
    expect(renderRequests).toBe(0);
  });

  it('setScrollPosition is NOT called by resetScrollPosition (no feedback loop)', () => {
    const positions: Array<{ x: number; y: number }> = [];
    coordinator.setDependencies(
      createMinimalDeps({
        setScrollPosition: (pos) => positions.push({ x: pos.x, y: pos.y }),
      }),
    );

    coordinator.resetScrollPosition(100, 200);

    // resetScrollPosition intentionally does NOT call applyScrollPosition
    expect(positions).toHaveLength(0);
  });

  it('works when setScrollPosition is not provided (optional)', () => {
    coordinator.setDependencies(createMinimalDeps());

    // Should not throw even without setScrollPosition
    expect(() => coordinator.scrollTo(100, 200)).not.toThrow();
    expect(() => coordinator.scrollBy(10, 20)).not.toThrow();
  });
});

// =============================================================================
// Single propagation path
// =============================================================================

describe('Single scroll propagation path', () => {
  let coordinator: InputCoordinator;

  beforeEach(() => {
    coordinator = new InputCoordinator();
  });

  afterEach(() => {
    coordinator.dispose();
  });

  it('scrollTo produces exactly one setScrollPosition call', () => {
    let callCount = 0;
    coordinator.setDependencies(
      createMinimalDeps({
        setScrollPosition: () => callCount++,
      }),
    );

    coordinator.scrollTo(100, 200);

    // Should be exactly 1, not 2 (the old dual-update bug)
    expect(callCount).toBe(1);
  });

  it('scrollBy produces exactly one setScrollPosition call', () => {
    let callCount = 0;
    coordinator.setDependencies(
      createMinimalDeps({
        setScrollPosition: () => callCount++,
      }),
    );

    coordinator.scrollBy(10, 20);

    expect(callCount).toBe(1);
  });
});

// =============================================================================
// Input source discrimination
// =============================================================================

describe('Trackpad vs discrete wheel detection', () => {
  let coordinator: InputCoordinator;

  beforeEach(() => {
    coordinator = new InputCoordinator();
    coordinator.setDependencies(createMinimalDeps());
  });

  afterEach(() => {
    coordinator.dispose();
  });

  function createWheelEvent(overrides: Partial<WheelEvent> = {}): WheelEvent {
    return {
      deltaX: 0,
      deltaY: 100,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      clientX: 0,
      clientY: 0,
      preventDefault: () => {},
      ...overrides,
    } as unknown as WheelEvent;
  }

  it('deltaMode !== 0 (line mode) → discrete wheel', () => {
    const event = createWheelEvent({ deltaMode: 1, deltaY: 3 });
    expect(coordinator.detectTrackpadInput(event)).toBe(false);
  });

  it('deltaMode !== 0 (page mode) → discrete wheel', () => {
    const event = createWheelEvent({ deltaMode: 2, deltaY: 1 });
    expect(coordinator.detectTrackpadInput(event)).toBe(false);
  });

  it('deltaMode === 0 + fractional deltaY → trackpad', () => {
    const event = createWheelEvent({ deltaMode: 0, deltaX: 0, deltaY: 3.5 });
    expect(coordinator.detectTrackpadInput(event)).toBe(true);
  });

  it('deltaMode === 0 + fractional deltaX → trackpad', () => {
    const event = createWheelEvent({ deltaMode: 0, deltaX: -1.2, deltaY: 0 });
    expect(coordinator.detectTrackpadInput(event)).toBe(true);
  });

  it('deltaMode === 0 + integer deltas + no prior wheel event → discrete wheel', () => {
    // First event has no timing context — defaults to discrete wheel
    const event = createWheelEvent({ deltaMode: 0, deltaX: 0, deltaY: 120 });
    expect(coordinator.detectTrackpadInput(event)).toBe(false);
  });

  it('deltaMode === 0 + large vertical pixel delta → direct pixel scroll', () => {
    const event = createWheelEvent({ deltaMode: 0, deltaX: 0, deltaY: 3000 });
    expect(coordinator.detectTrackpadInput(event)).toBe(true);
  });

  it('deltaMode === 0 + large horizontal pixel delta → direct pixel scroll', () => {
    const event = createWheelEvent({ deltaMode: 0, deltaX: -3000, deltaY: 0 });
    expect(coordinator.detectTrackpadInput(event)).toBe(true);
  });

  it('deltaMode === 0 + integer deltas + high frequency (dt < 50ms) → trackpad', () => {
    // Simulate two rapid events to establish high frequency
    const event1 = createWheelEvent({ deltaMode: 0, deltaX: 0, deltaY: 10 });
    coordinator.handleWheel(event1);

    // Second event within 50ms
    const event2 = createWheelEvent({ deltaMode: 0, deltaX: 0, deltaY: 10 });
    // detectTrackpadInput reads lastWheelTime which was set by handleWheel above
    expect(coordinator.detectTrackpadInput(event2)).toBe(true);
  });
});
