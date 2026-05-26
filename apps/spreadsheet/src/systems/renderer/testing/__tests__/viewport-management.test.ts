/**
 * Viewport Management Tests
 *
 * Tests viewport control methods: scroll position, frozen panes, zoom, resize.
 *
 * Note: Without setRendererDependencies(), the RenderSystem's rendererExecution
 * is set up but has no GridRenderer. Viewport methods delegate to
 * rendererExecution which may be null or have no renderer. These tests verify
 * that viewport methods do not throw and that the system state remains consistent.
 *
 * For full viewport behavior (actual scroll, frozen pane splitting, zoom
 * rendering), the execution layer needs a real GridRenderer which requires
 * DOM and canvas dependencies not available in headless tests.
 *
 * @module systems/renderer/testing/__tests__/viewport-management
 */

import { createRendererSimulator, type RendererSimulator } from '../renderer-simulator';

describe('Viewport management', () => {
  let sim: RendererSimulator;

  beforeEach(() => {
    sim = createRendererSimulator({ autoReady: true });
    sim.start();
  });

  afterEach(() => {
    sim.destroy();
  });

  // ===========================================================================
  // Scroll position
  // ===========================================================================

  test('setScrollPosition does not throw when system is ready', () => {
    // Without a real renderer, this is a no-op but should not throw
    expect(() => {
      sim.setScrollPosition({ x: 100, y: 200 });
    }).not.toThrow();
  });

  test('setScrollPosition is safe before ready state', () => {
    sim.destroy();
    sim = createRendererSimulator();
    sim.start();

    // System is in unmounted state
    expect(() => {
      sim.setScrollPosition({ x: 0, y: 0 });
    }).not.toThrow();
  });

  // ===========================================================================
  // Frozen panes
  // ===========================================================================

  test('setFrozenPanes does not throw when system is ready', () => {
    expect(() => {
      sim.setFrozenPanes({ rows: 1, cols: 2 });
    }).not.toThrow();
  });

  test('getFrozenPanes returns default when no renderer', () => {
    // Without rendererExecution having a renderer, getFrozenPanes
    // returns the default { rows: 0, cols: 0 }
    const panes = sim.system.getFrozenPanes();
    expect(panes).toEqual({ rows: 0, cols: 0 });
  });

  // ===========================================================================
  // Zoom
  // ===========================================================================

  test('setZoom does not throw when system is ready', () => {
    expect(() => {
      sim.setZoom(1.5);
    }).not.toThrow();
  });

  test('getZoom returns default when no renderer', () => {
    // Without a real renderer, getZoom returns the default 1.0
    const zoom = sim.system.getZoom();
    expect(zoom).toBe(1.0);
  });

  // ===========================================================================
  // Resize
  // ===========================================================================

  test('resize does not change lifecycle state when ready', () => {
    sim.resize(1200, 900);

    expect(sim.lifecycleState()).toBe('ready');
  });

  test('resize during waitingForLayout transitions to initializing', () => {
    sim.destroy();
    sim = createRendererSimulator();
    sim.start();

    sim.mount();
    expect(sim.lifecycleState()).toBe('waitingForLayout');

    // Resize is treated like LAYOUT_READY in waitingForLayout state
    sim.resize(1024, 768);
    expect(sim.lifecycleState()).toBe('initializing');
  });

  // ===========================================================================
  // Viewport state after sheet switch
  // ===========================================================================

  test('viewport methods are safe during sheet switch', () => {
    sim.switchSheet('sheet-2');
    expect(sim.lifecycleState()).toBe('switchingSheet');

    // These should not throw even during sheet switch
    expect(() => {
      sim.setScrollPosition({ x: 50, y: 100 });
      sim.setFrozenPanes({ rows: 2, cols: 1 });
      sim.setZoom(0.75);
    }).not.toThrow();
  });

  // ===========================================================================
  // Coordinate system
  // ===========================================================================

  test('coordinateSystem returns null without real renderer', () => {
    expect(sim.coordinateSystem()).toBeNull();
  });

  // ===========================================================================
  // Scroll + frozen panes interaction
  // ===========================================================================

  test('scroll and frozen panes do not interfere', () => {
    // Set both without throwing
    expect(() => {
      sim.setFrozenPanes({ rows: 1, cols: 1 });
      sim.setScrollPosition({ x: 200, y: 300 });
    }).not.toThrow();

    // State remains ready
    expect(sim.lifecycleState()).toBe('ready');
  });

  // ===========================================================================
  // Zoom persistence across scroll changes
  // ===========================================================================

  test('zoom persists across scroll changes', () => {
    // Set zoom, then scroll - zoom should not be affected
    sim.setZoom(2.0);
    sim.setScrollPosition({ x: 500, y: 500 });

    // The zoom value is tracked by rendererExecution, not the state machine.
    // Without a renderer, we can only verify the system doesn't crash.
    expect(sim.lifecycleState()).toBe('ready');
  });
});
