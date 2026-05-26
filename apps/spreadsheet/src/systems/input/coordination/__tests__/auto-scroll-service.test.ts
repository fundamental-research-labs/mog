/**
 * Auto-Scroll Service Tests
 *
 * Tests for the auto-scroll service that enables automatic scrolling
 * when dragging near viewport edges.
 *
 */

import { jest } from '@jest/globals';

import {
  getScrollVelocity,
  isNearViewportEdge,
  setupAutoScroll,
  type EdgeProximity,
  type ViewportBounds,
} from '../auto-scroll-service';

describe('isNearViewportEdge', () => {
  const viewport: ViewportBounds = {
    left: 0,
    top: 0,
    right: 1000,
    bottom: 800,
  };

  describe('detects all 4 edges', () => {
    it('should detect top edge proximity', () => {
      const result = isNearViewportEdge(500, 25, viewport, 50);
      expect(result.edge).toBe('top');
      expect(result.distance).toBe(25);
    });

    it('should detect bottom edge proximity', () => {
      const result = isNearViewportEdge(500, 780, viewport, 50);
      expect(result.edge).toBe('bottom');
      expect(result.distance).toBe(20);
    });

    it('should detect left edge proximity', () => {
      const result = isNearViewportEdge(30, 400, viewport, 50);
      expect(result.edge).toBe('left');
      expect(result.distance).toBe(30);
    });

    it('should detect right edge proximity', () => {
      const result = isNearViewportEdge(960, 400, viewport, 50);
      expect(result.edge).toBe('right');
      expect(result.distance).toBe(40);
    });
  });

  describe('returns null when not near edge', () => {
    it('should return null edge when in center of viewport', () => {
      const result = isNearViewportEdge(500, 400, viewport, 50);
      expect(result.edge).toBeNull();
      expect(result.distance).toBeGreaterThan(50);
    });

    it('should return null edge when just outside threshold', () => {
      const result = isNearViewportEdge(500, 55, viewport, 50);
      expect(result.edge).toBeNull();
    });
  });

  describe('edge detection at exact threshold', () => {
    it('should detect edge at exact threshold distance', () => {
      const result = isNearViewportEdge(500, 50, viewport, 50);
      expect(result.edge).toBe('top');
      expect(result.distance).toBe(50);
    });
  });

  describe('corner cases', () => {
    it('should choose closest edge in corner', () => {
      // Near top-left corner, but closer to top
      const result1 = isNearViewportEdge(30, 20, viewport, 50);
      expect(result1.edge).toBe('top');

      // Near top-left corner, but closer to left
      const result2 = isNearViewportEdge(15, 40, viewport, 50);
      expect(result2.edge).toBe('left');
    });
  });
});

describe('getScrollVelocity', () => {
  describe('returns zero velocity when not near edge', () => {
    it('should return { dx: 0, dy: 0 } when edge is null', () => {
      const proximity: EdgeProximity = { edge: null, distance: 100 };
      const velocity = getScrollVelocity(proximity);
      expect(velocity.dx).toBe(0);
      expect(velocity.dy).toBe(0);
    });
  });

  describe('velocity direction', () => {
    it('should scroll up (negative dy) when near top edge', () => {
      const proximity: EdgeProximity = { edge: 'top', distance: 25 };
      const velocity = getScrollVelocity(proximity);
      expect(velocity.dx).toBe(0);
      expect(velocity.dy).toBeLessThan(0);
    });

    it('should scroll down (positive dy) when near bottom edge', () => {
      const proximity: EdgeProximity = { edge: 'bottom', distance: 25 };
      const velocity = getScrollVelocity(proximity);
      expect(velocity.dx).toBe(0);
      expect(velocity.dy).toBeGreaterThan(0);
    });

    it('should scroll left (negative dx) when near left edge', () => {
      const proximity: EdgeProximity = { edge: 'left', distance: 25 };
      const velocity = getScrollVelocity(proximity);
      expect(velocity.dx).toBeLessThan(0);
      expect(velocity.dy).toBe(0);
    });

    it('should scroll right (positive dx) when near right edge', () => {
      const proximity: EdgeProximity = { edge: 'right', distance: 25 };
      const velocity = getScrollVelocity(proximity);
      expect(velocity.dx).toBeGreaterThan(0);
      expect(velocity.dy).toBe(0);
    });
  });

  describe('velocity increases with proximity', () => {
    it('should have higher velocity at closer distance', () => {
      const closerProximity: EdgeProximity = { edge: 'bottom', distance: 10 };
      const fartherProximity: EdgeProximity = { edge: 'bottom', distance: 40 };

      const closerVelocity = getScrollVelocity(closerProximity);
      const fartherVelocity = getScrollVelocity(fartherProximity);

      expect(Math.abs(closerVelocity.dy)).toBeGreaterThan(Math.abs(fartherVelocity.dy));
    });

    it('should have maximum velocity at edge (distance = 0)', () => {
      const atEdge: EdgeProximity = { edge: 'bottom', distance: 0 };
      const velocity = getScrollVelocity(atEdge, 50, 100, 600);

      // At edge, should be at max speed
      expect(velocity.dy).toBe(600);
    });

    it('should have minimum velocity at threshold (distance = threshold)', () => {
      const atThreshold: EdgeProximity = { edge: 'bottom', distance: 50 };
      const velocity = getScrollVelocity(atThreshold, 50, 100, 600);

      // At threshold, should be at min speed
      expect(velocity.dy).toBe(100);
    });
  });

  describe('respects min/max bounds', () => {
    it('should not exceed maxSpeed', () => {
      const atEdge: EdgeProximity = { edge: 'bottom', distance: 0 };
      const velocity = getScrollVelocity(atEdge, 50, 100, 500);
      expect(Math.abs(velocity.dy)).toBeLessThanOrEqual(500);
    });

    it('should not go below minSpeed', () => {
      const atThreshold: EdgeProximity = { edge: 'bottom', distance: 50 };
      const velocity = getScrollVelocity(atThreshold, 50, 150, 500);
      expect(Math.abs(velocity.dy)).toBeGreaterThanOrEqual(150);
    });
  });
});

describe('setupAutoScroll', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should create auto-scroll controller', () => {
    const controller = setupAutoScroll({
      getMousePosition: () => ({ x: 500, y: 400 }),
      getViewportBounds: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
      applyScrollDelta: jest.fn(),
    });

    expect(controller).toBeDefined();
    expect(typeof controller.start).toBe('function');
    expect(typeof controller.stop).toBe('function');
    expect(typeof controller.isActive).toBe('function');
    expect(typeof controller.cleanup).toBe('function');

    controller.cleanup();
  });

  it('should start and stop correctly', () => {
    const controller = setupAutoScroll({
      getMousePosition: () => ({ x: 500, y: 400 }),
      getViewportBounds: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
      applyScrollDelta: jest.fn(),
    });

    expect(controller.isActive()).toBe(false);

    controller.start();
    expect(controller.isActive()).toBe(true);

    controller.stop();
    expect(controller.isActive()).toBe(false);

    controller.cleanup();
  });

  it('should not double-start', () => {
    const controller = setupAutoScroll({
      getMousePosition: () => ({ x: 500, y: 400 }),
      getViewportBounds: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
      applyScrollDelta: jest.fn(),
    });

    controller.start();
    controller.start(); // Second start should be ignored
    expect(controller.isActive()).toBe(true);

    controller.cleanup();
  });

  it('should apply scroll delta when near edge', () => {
    const applyScrollDelta = jest.fn();
    const requestRender = jest.fn();

    const controller = setupAutoScroll({
      getMousePosition: () => ({ x: 500, y: 780 }), // Near bottom edge
      getViewportBounds: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
      applyScrollDelta,
      requestRender,
    });

    controller.start();

    // Advance to first frame (with some time delta)
    jest.advanceTimersByTime(16);

    // Advance to second frame
    jest.advanceTimersByTime(16);

    // Should have called applyScrollDelta
    expect(applyScrollDelta).toHaveBeenCalled();
    expect(requestRender).toHaveBeenCalled();

    controller.cleanup();
  });

  it('should not scroll when not near edge', () => {
    const applyScrollDelta = jest.fn();

    const controller = setupAutoScroll({
      getMousePosition: () => ({ x: 500, y: 400 }), // Center of viewport
      getViewportBounds: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
      applyScrollDelta,
    });

    controller.start();

    // First frame establishes timing
    jest.advanceTimersByTime(16);
    // Second frame would apply scroll if near edge
    jest.advanceTimersByTime(16);

    // Should NOT have called applyScrollDelta (not near edge)
    expect(applyScrollDelta).not.toHaveBeenCalled();

    controller.cleanup();
  });

  it('should handle null mouse position gracefully', () => {
    const applyScrollDelta = jest.fn();

    const controller = setupAutoScroll({
      getMousePosition: () => null,
      getViewportBounds: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
      applyScrollDelta,
    });

    controller.start();

    // Should not throw
    jest.advanceTimersByTime(16);
    jest.advanceTimersByTime(16);

    expect(applyScrollDelta).not.toHaveBeenCalled();

    controller.cleanup();
  });

  it('should cleanup on stop', () => {
    const controller = setupAutoScroll({
      getMousePosition: () => ({ x: 500, y: 780 }),
      getViewportBounds: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
      applyScrollDelta: jest.fn(),
    });

    controller.start();
    controller.stop();

    expect(controller.isActive()).toBe(false);

    controller.cleanup();
  });
});
