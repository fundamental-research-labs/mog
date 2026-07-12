/**
 * Interactive Element Collection Tests
 *
 * Verifies that collectInteractiveElements emits correct bounds for each element type.
 *
 * @module grid-renderer/cells/__tests__/interactive-elements
 */

import { docToCanvasXY, regionLocalRect, type RenderRegion } from '@mog/canvas-engine';
import type { InteractiveElement, InteractiveElementCollector } from '@mog-sdk/contracts/rendering';
import type { CellRenderInfo } from '../types';
import {
  createRegionInteractiveElementCollector,
  placeInteractiveElementInRegion,
} from '../interactive-element-placement';
import {
  collectInteractiveElements,
  toRegionLocalInteractiveCell,
  type InteractiveCellInfo,
  type RegionLocalInteractiveElement,
  type RegionLocalInteractiveElementCollector,
} from '../interactive-elements';
import { docToRegionXY } from '../../shared/cell-bounds';

function makeCollector(): InteractiveElementCollector & { elements: InteractiveElement[] } {
  const elements: InteractiveElement[] = [];
  return {
    elements,
    clear() {
      elements.length = 0;
    },
    add(el: InteractiveElement) {
      elements.push(el);
    },
    getAll() {
      return elements;
    },
    subscribe() {
      return () => {};
    },
  };
}

function makeRegionLocalCollector(): RegionLocalInteractiveElementCollector & {
  elements: RegionLocalInteractiveElement[];
} {
  const elements: RegionLocalInteractiveElement[] = [];
  return {
    elements,
    addRegionLocal(element) {
      elements.push(element);
    },
  };
}

function makeCell(overrides?: Partial<CellRenderInfo>): CellRenderInfo {
  return {
    row: 0,
    col: 5,
    x: 200,
    y: 50,
    width: 120,
    height: 25,
    value: null,
    format: undefined,
    displayText: '',
    isEditing: false,
    ...overrides,
  } as CellRenderInfo;
}

function makeInteractiveCell(overrides?: Partial<CellRenderInfo>) {
  return toRegionLocalInteractiveCell(makeCell(overrides));
}

function makeInfo(overrides?: Partial<InteractiveCellInfo>): InteractiveCellInfo {
  return {
    hasComment: false,
    isCheckbox: false,
    isChecked: false,
    sheetId: 'sheet1',
    ...overrides,
  };
}

function makeRegion(overrides?: Partial<RenderRegion>): RenderRegion {
  return {
    id: 'main',
    bounds: { x: 250, y: 100, width: 500, height: 400 },
    viewportOrigin: { x: 200, y: 50 },
    scrollOffset: { x: 300, y: 150 },
    zoom: 1,
    metadata: undefined,
    ...overrides,
  };
}

function makeElement(bounds: InteractiveElement['bounds']): RegionLocalInteractiveElement {
  return {
    id: 'filter-button:sheet1:0,1',
    type: 'filter-button',
    localBounds: regionLocalRect(bounds.x, bounds.y, bounds.width, bounds.height),
    metadata: {
      type: 'filter-button',
      filterId: 'filter-1',
      headerCellId: 'header-b',
      hasActiveFilter: false,
      col: 1,
    },
  };
}

describe('placeInteractiveElementInRegion', () => {
  it('maps region-local bounds to renderer-container coordinates and zooms dimensions', () => {
    const placed = placeInteractiveElementInRegion(
      makeElement({ x: 20, y: 30, width: 16, height: 18 }),
      makeRegion({
        id: 'bottomRight',
        bounds: { x: 250, y: 100, width: 500, height: 400 },
        zoom: 1.25,
      }),
    );

    expect(placed).toEqual({
      id: 'filter-button:sheet1:0,1@bottomRight',
      type: 'filter-button',
      bounds: { x: 275, y: 137.5, width: 20, height: 22.5 },
      metadata: makeElement({ x: 20, y: 30, width: 16, height: 18 }).metadata,
    });
  });

  it.each([
    [
      'main',
      makeRegion({
        id: 'main',
        bounds: { x: 50, y: 21, width: 950, height: 579 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 300, y: 150 },
        zoom: 0.85,
      }),
    ],
    [
      'frozen',
      makeRegion({
        id: 'frozen-rows',
        bounds: { x: 220, y: 21, width: 780, height: 85 },
        viewportOrigin: { x: 200, y: 0 },
        scrollOffset: { x: 300, y: 0 },
        zoom: 1.25,
      }),
    ],
    [
      'split',
      makeRegion({
        id: 'bottom-right',
        bounds: { x: 500, y: 300, width: 500, height: 300 },
        viewportOrigin: { x: 400, y: 240 },
        scrollOffset: { x: 125, y: 75 },
        zoom: 1,
      }),
    ],
  ])('matches the canonical doc-to-canvas transform in the %s region', (_name, region) => {
    const doc = {
      x: region.viewportOrigin.x + region.scrollOffset.x + 40,
      y: region.viewportOrigin.y + region.scrollOffset.y + 20,
    };
    const local = docToRegionXY(doc.x, doc.y, region);
    const placed = placeInteractiveElementInRegion(
      makeElement({ x: local.x, y: local.y, width: 16, height: 18 }),
      region,
    );
    const canonical = docToCanvasXY(doc.x, doc.y, region);

    expect(placed?.bounds.x).toBeCloseTo(canonical.x);
    expect(placed?.bounds.y).toBeCloseTo(canonical.y);
    expect(placed?.bounds.width).toBeCloseTo(16 * region.zoom);
    expect(placed?.bounds.height).toBeCloseTo(18 * region.zoom);
  });

  it.each([
    ['left', { x: -16, y: 20, width: 16, height: 16 }],
    ['top', { x: 20, y: -16, width: 16, height: 16 }],
    ['right', { x: 500, y: 20, width: 16, height: 16 }],
    ['bottom', { x: 20, y: 400, width: 16, height: 16 }],
  ])('drops elements fully clipped beyond the %s pane edge', (_edge, bounds) => {
    expect(placeInteractiveElementInRegion(makeElement(bounds), makeRegion())).toBeNull();
  });

  it('clips partially visible hit bounds to the producing pane', () => {
    const placed = placeInteractiveElementInRegion(
      makeElement({ x: -8, y: 390, width: 16, height: 16 }),
      makeRegion(),
    );

    expect(placed?.bounds).toEqual({ x: 250, y: 490, width: 8, height: 10 });
  });

  it('keeps separate instances when one logical element appears in split panes', () => {
    const element = makeElement({ x: 10, y: 10, width: 16, height: 16 });
    const left = placeInteractiveElementInRegion(
      element,
      makeRegion({ id: 'bottomLeft', bounds: { x: 50, y: 100, width: 300, height: 400 } }),
    );
    const right = placeInteractiveElementInRegion(
      element,
      makeRegion({ id: 'bottomRight', bounds: { x: 350, y: 100, width: 400, height: 400 } }),
    );

    expect(left?.id).toBe('filter-button:sheet1:0,1@bottomLeft');
    expect(right?.id).toBe('filter-button:sheet1:0,1@bottomRight');
    expect(left?.bounds.x).toBe(60);
    expect(right?.bounds.x).toBe(360);
  });

  it('prevents a scrolled main-pane trigger from overlapping a frozen-pane trigger', () => {
    const collector = makeCollector();
    const frozenRegion = makeRegion({
      id: 'frozen-cols',
      bounds: { x: 50, y: 21, width: 170, height: 600 },
      zoom: 0.85,
    });
    const mainRegion = makeRegion({
      id: 'main',
      bounds: { x: 220, y: 21, width: 780, height: 600 },
      zoom: 0.85,
    });
    const filterInfo = makeInfo({
      filterInfo: {
        filterId: 'filter-1',
        headerCellId: 'header',
        hasActiveFilter: false,
      },
    });

    // B's hit box ends at the frozen-pane boundary. The horizontally
    // scrolled E hit box maps to the same pixels, but belongs to main.
    collectInteractiveElements(
      makeInteractiveCell({ col: 1, x: 100, y: 50, width: 100, height: 25 }),
      filterInfo,
      createRegionInteractiveElementCollector(collector, frozenRegion),
    );
    collectInteractiveElements(
      makeInteractiveCell({ col: 4, x: -100, y: 50, width: 100, height: 25 }),
      filterInfo,
      createRegionInteractiveElementCollector(collector, mainRegion),
    );

    expect(collector.elements).toHaveLength(1);
    expect(collector.elements[0]?.id).toBe('filter-button:sheet1:0,1@frozen-cols');
    expect(collector.elements[0]?.bounds.x + (collector.elements[0]?.bounds.width ?? 0)).toBe(220);

    // A partially visible main-pane trigger is clipped to start at the pane
    // boundary and therefore cannot intercept any frozen-pane pixels.
    collectInteractiveElements(
      makeInteractiveCell({ col: 4, x: -95, y: 50, width: 100, height: 25 }),
      filterInfo,
      createRegionInteractiveElementCollector(collector, mainRegion),
    );
    expect(collector.elements[1]?.bounds.x).toBe(220);
  });
});

describe('collectInteractiveElements', () => {
  it('rejects the public placed-element collector at the type boundary', () => {
    // @ts-expect-error Region-local discovery must go through a placement adapter.
    collectInteractiveElements(makeInteractiveCell(), makeInfo(), makeCollector());
  });

  it('emits comment indicator bounds covering only the top-right triangle area', () => {
    const collector = makeRegionLocalCollector();
    const cell = makeInteractiveCell({ x: 200, y: 50, width: 120, height: 25 });
    const info = makeInfo({ hasComment: true });

    collectInteractiveElements(cell, info, collector);

    expect(collector.elements).toHaveLength(1);
    const el = collector.elements[0];
    expect(el.type).toBe('comment-indicator');

    // Bounds should NOT be the full cell
    expect(el.localBounds.width).toBeLessThan(120);
    expect(el.localBounds.height).toBeLessThan(25);

    // Bounds should be a small area (TRIANGLE_SIZE=6 + HIT_PADDING=4 on each side = 14)
    expect(el.localBounds.width).toBe(14);
    expect(el.localBounds.height).toBe(14);

    // Bounds should be in the top-right corner of the cell
    // x should be near the right edge: cell.x + cell.width - TRIANGLE_SIZE - HIT_PADDING = 200 + 120 - 6 - 4 = 310
    expect(el.localBounds.x).toBe(310);
    // y should be near the top: cell.y - HIT_PADDING = 50 - 4 = 46
    expect(el.localBounds.y).toBe(46);
  });

  it('does not emit any elements when no interactive features are present', () => {
    const collector = makeRegionLocalCollector();
    collectInteractiveElements(makeInteractiveCell(), makeInfo(), collector);
    expect(collector.elements).toHaveLength(0);
  });

  it('emits checkbox with full cell bounds', () => {
    const collector = makeRegionLocalCollector();
    collectInteractiveElements(
      makeInteractiveCell({ width: 100, height: 30 }),
      makeInfo({ isCheckbox: true, isChecked: true }),
      collector,
    );

    expect(collector.elements).toHaveLength(1);
    const el = collector.elements[0];
    expect(el.type).toBe('checkbox');
    // Checkbox should use full cell bounds
    expect(el.localBounds.width).toBe(100);
    expect(el.localBounds.height).toBe(30);
  });

  it('computes filter button hit bounds from local unscaled cell geometry', () => {
    const collector = makeRegionLocalCollector();
    collectInteractiveElements(
      makeInteractiveCell({ x: 200, y: 50, width: 120, height: 25 }),
      makeInfo({
        filterInfo: {
          filterId: 'filter-1',
          headerCellId: 'header-f',
          hasActiveFilter: false,
        },
      }),
      collector,
    );

    expect(collector.elements).toHaveLength(1);
    const el = collector.elements[0];
    expect(el.type).toBe('filter-button');
    expect(el.localBounds).toEqual({
      x: 304,
      y: 54.5,
      width: 16,
      height: 16,
    });
  });
});
