/**
 * Interactive Element Collection Tests
 *
 * Verifies that collectInteractiveElements emits correct bounds for each element type.
 *
 * @module grid-renderer/cells/__tests__/interactive-elements
 */

import type { InteractiveElement, InteractiveElementCollector } from '@mog-sdk/contracts/rendering';
import type { CellRenderInfo } from '../types';
import { collectInteractiveElements, type InteractiveCellInfo } from '../interactive-elements';

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

function makeInfo(overrides?: Partial<InteractiveCellInfo>): InteractiveCellInfo {
  return {
    hasComment: false,
    isCheckbox: false,
    isChecked: false,
    sheetId: 'sheet1',
    ...overrides,
  };
}

describe('collectInteractiveElements', () => {
  it('emits comment indicator bounds covering only the top-right triangle area', () => {
    const collector = makeCollector();
    const cell = makeCell({ x: 200, y: 50, width: 120, height: 25 });
    const info = makeInfo({ hasComment: true });

    collectInteractiveElements(cell, info, collector);

    expect(collector.elements).toHaveLength(1);
    const el = collector.elements[0];
    expect(el.type).toBe('comment-indicator');

    // Bounds should NOT be the full cell
    expect(el.bounds.width).toBeLessThan(120);
    expect(el.bounds.height).toBeLessThan(25);

    // Bounds should be a small area (TRIANGLE_SIZE=6 + HIT_PADDING=4 on each side = 14)
    expect(el.bounds.width).toBe(14);
    expect(el.bounds.height).toBe(14);

    // Bounds should be in the top-right corner of the cell
    // x should be near the right edge: cell.x + cell.width - TRIANGLE_SIZE - HIT_PADDING = 200 + 120 - 6 - 4 = 310
    expect(el.bounds.x).toBe(310);
    // y should be near the top: cell.y - HIT_PADDING = 50 - 4 = 46
    expect(el.bounds.y).toBe(46);
  });

  it('does not emit any elements when no interactive features are present', () => {
    const collector = makeCollector();
    collectInteractiveElements(makeCell(), makeInfo(), collector);
    expect(collector.elements).toHaveLength(0);
  });

  it('emits checkbox with full cell bounds', () => {
    const collector = makeCollector();
    collectInteractiveElements(
      makeCell({ width: 100, height: 30 }),
      makeInfo({ isCheckbox: true, isChecked: true }),
      collector,
    );

    expect(collector.elements).toHaveLength(1);
    const el = collector.elements[0];
    expect(el.type).toBe('checkbox');
    // Checkbox should use full cell bounds
    expect(el.bounds.width).toBe(100);
    expect(el.bounds.height).toBe(30);
  });

  it('computes filter button hit bounds from local unscaled cell geometry', () => {
    const collector = makeCollector();
    collectInteractiveElements(
      makeCell({ x: 200, y: 50, width: 120, height: 25 }),
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
    expect(el.bounds).toEqual({
      x: 304,
      y: 54.5,
      width: 16,
      height: 16,
    });
  });
});
