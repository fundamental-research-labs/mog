import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import {
  EXTEND_SELECTION_PAGE_DOWN,
  EXTEND_SELECTION_PAGE_UP,
  PAGE_DOWN,
  PAGE_LEFT,
  PAGE_RIGHT,
  PAGE_UP,
} from '../page-navigation';

interface VisibleRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

function makeDeps(options: {
  viewportRange?: VisibleRange | null;
  geometryRange?: VisibleRange | null;
  includeViewport?: boolean;
  includeGeometry?: boolean;
}) {
  const pageUp = jest.fn();
  const pageDown = jest.fn();
  const pageLeft = jest.fn();
  const pageRight = jest.fn();

  const renderer: Record<string, unknown> = {};

  if (options.includeViewport !== false) {
    renderer.getViewport = jest.fn(() =>
      options.viewportRange === undefined
        ? null
        : {
            getSnapshot: jest.fn(() => ({
              visibleRange: options.viewportRange,
            })),
          },
    );
  }

  if (options.includeGeometry !== false) {
    renderer.getGeometry = jest.fn(() =>
      options.geometryRange === undefined
        ? null
        : {
            getVisibleRange: jest.fn(() => options.geometryRange),
          },
    );
  }

  const deps = {
    coordinator: {
      renderer,
    },
    commands: {
      selection: {
        pageUp,
        pageDown,
        pageLeft,
        pageRight,
      },
    },
  } as unknown as ActionDependencies;

  return { deps, pageUp, pageDown, pageLeft, pageRight };
}

describe('page navigation viewport sizing', () => {
  test('PAGE_UP uses the rendered viewport row span before stale geometry', () => {
    const setup = makeDeps({
      viewportRange: { startRow: 19, endRow: 60, startCol: 0, endCol: 9 },
      geometryRange: { startRow: 0, endRow: 62, startCol: 0, endCol: 10 },
    });

    const result = PAGE_UP(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.pageUp).toHaveBeenCalledWith(42, false);
  });

  test('PAGE_DOWN and extend-page commands use the rendered viewport row span', () => {
    const setup = makeDeps({
      viewportRange: { startRow: 19, endRow: 60, startCol: 3, endCol: 8 },
      geometryRange: { startRow: 0, endRow: 62, startCol: 0, endCol: 10 },
    });

    expect(PAGE_DOWN(setup.deps).handled).toBe(true);
    expect(EXTEND_SELECTION_PAGE_UP(setup.deps).handled).toBe(true);
    expect(EXTEND_SELECTION_PAGE_DOWN(setup.deps).handled).toBe(true);

    expect(setup.pageDown).toHaveBeenNthCalledWith(1, 42, false);
    expect(setup.pageUp).toHaveBeenCalledWith(42, true);
    expect(setup.pageDown).toHaveBeenNthCalledWith(2, 42, true);
  });

  test('PAGE_LEFT and PAGE_RIGHT use the rendered viewport column span', () => {
    const setup = makeDeps({
      viewportRange: { startRow: 19, endRow: 60, startCol: 3, endCol: 8 },
      geometryRange: { startRow: 0, endRow: 62, startCol: 0, endCol: 10 },
    });

    expect(PAGE_LEFT(setup.deps).handled).toBe(true);
    expect(PAGE_RIGHT(setup.deps).handled).toBe(true);

    expect(setup.pageLeft).toHaveBeenCalledWith(6, false);
    expect(setup.pageRight).toHaveBeenCalledWith(6, false);
  });

  test('falls back to geometry when the viewport capability is absent', () => {
    const setup = makeDeps({
      includeViewport: false,
      geometryRange: { startRow: 0, endRow: 62, startCol: 0, endCol: 10 },
    });

    expect(PAGE_UP(setup.deps).handled).toBe(true);
    expect(PAGE_RIGHT(setup.deps).handled).toBe(true);

    expect(setup.pageUp).toHaveBeenCalledWith(62, false);
    expect(setup.pageRight).toHaveBeenCalledWith(10, false);
  });

  test('falls back to geometry when the viewport range is invalid', () => {
    const setup = makeDeps({
      viewportRange: { startRow: 19, endRow: Infinity, startCol: 0, endCol: 9 },
      geometryRange: { startRow: 0, endRow: 62, startCol: 0, endCol: 10 },
    });

    expect(PAGE_UP(setup.deps).handled).toBe(true);

    expect(setup.pageUp).toHaveBeenCalledWith(62, false);
  });

  test('uses defaults when neither viewport nor geometry can provide a range', () => {
    const setup = makeDeps({
      includeViewport: false,
      includeGeometry: false,
    });

    expect(PAGE_UP(setup.deps).handled).toBe(true);
    expect(PAGE_RIGHT(setup.deps).handled).toBe(true);

    expect(setup.pageUp).toHaveBeenCalledWith(20, false);
    expect(setup.pageRight).toHaveBeenCalledWith(10, false);
  });
});
