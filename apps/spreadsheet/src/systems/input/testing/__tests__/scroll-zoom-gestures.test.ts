/**
 * Scroll/Zoom Gesture Tests
 *
 * Tests InputCoordinator with mock coordinate system.
 * Verifies that setDependencies wiring works and callbacks fire.
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

describe('InputCoordinator scroll/zoom gestures', () => {
  let coordinator: InputCoordinator;

  beforeEach(() => {
    coordinator = new InputCoordinator();
  });

  afterEach(() => {
    coordinator.dispose();
  });

  it('setDependencies accepts mock coordinate system without throwing', () => {
    expect(() => {
      coordinator.setDependencies(createMinimalDeps());
    }).not.toThrow();
  });

  it('onScrollChange callback fires when scroll state changes', () => {
    coordinator.setDependencies(createMinimalDeps());

    const scrollStates: Array<{ x: number; y: number }> = [];
    coordinator.onScrollChange((state) => {
      scrollStates.push({ x: state.x, y: state.y });
    });

    // Use the public scrollBy API to trigger scroll change
    coordinator.scrollBy(10, 20);

    expect(scrollStates.length).toBeGreaterThan(0);
    expect(scrollStates[scrollStates.length - 1].x).toBe(10);
    expect(scrollStates[scrollStates.length - 1].y).toBe(20);
  });

  it('onZoomChange callback fires when zoom state changes', () => {
    coordinator.setDependencies(createMinimalDeps());

    const zoomStates: Array<{ level: number }> = [];
    coordinator.onZoomChange((state) => {
      zoomStates.push({ level: state.level });
    });

    // Use the public setZoom API to trigger zoom change
    coordinator.setZoom(1.5);

    expect(zoomStates.length).toBeGreaterThan(0);
    expect(zoomStates[zoomStates.length - 1].level).toBe(1.5);
  });

  it('scrollTo sets position immediately', () => {
    coordinator.setDependencies(createMinimalDeps());

    coordinator.scrollTo(100, 200);

    const state = coordinator.getScrollState();
    expect(state.x).toBe(100);
    expect(state.y).toBe(200);
  });

  it('getZoomState reflects setZoom', () => {
    coordinator.setDependencies(createMinimalDeps());

    coordinator.setZoom(2.0);

    const state = coordinator.getZoomState();
    expect(state.level).toBe(2.0);
  });
});
