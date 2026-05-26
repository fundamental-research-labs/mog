/**
 * Viewport → Region Layout Mapper — Structural Projection Tests
 *
 * The mapper is mechanical: every Viewport field round-trips, viewportOrigin
 * is preserved verbatim, no information is invented or lost. These tests lock
 * the structural-projection invariant for all 4 freeze configurations.
 */

import type { Viewport, ViewportLayout } from '@mog-sdk/contracts/viewport';
import { DEFAULT_VIEWPORT_RENDER_CONFIG } from '@mog-sdk/contracts/viewport';

import { viewportLayoutToRegionLayout } from '../viewport-to-region-layout';

const SHEET_ID = 'sheet-test';
const FROZEN_COLS_WIDTH = 80;
const FROZEN_ROWS_HEIGHT = 21;

const baseHeaderInfo = {
  frozenRows: 0,
  frozenCols: 0,
  frozenRowsHeight: 0,
  frozenColsWidth: 0,
  scrollPosition: { x: 0, y: 0 },
  zoom: 1,
};

const baseCellRange = { startRow: 0, startCol: 0, endRow: 10, endCol: 10 };

function viewport(partial: Partial<Viewport> & Pick<Viewport, 'id'>): Viewport {
  return {
    id: partial.id,
    bounds: partial.bounds ?? { x: 0, y: 0, width: 100, height: 100 },
    cellRange: partial.cellRange ?? baseCellRange,
    viewportOrigin: partial.viewportOrigin ?? { x: 0, y: 0 },
    scrollOffset: partial.scrollOffset ?? { x: 0, y: 0 },
    scrollBehavior: partial.scrollBehavior ?? { type: 'free' },
    sheetId: partial.sheetId,
    zoom: partial.zoom ?? 1,
    renderConfig: partial.renderConfig ?? DEFAULT_VIEWPORT_RENDER_CONFIG,
  };
}

function makeLayout(viewports: Viewport[]): ViewportLayout {
  return {
    viewports,
    primaryViewportId: viewports[0]?.id ?? 'main',
    dividers: [],
    contentSize: { width: 1000, height: 1000 },
    maxScroll: { x: 900, y: 900 },
    headerInfo: baseHeaderInfo,
  };
}

describe('viewportLayoutToRegionLayout', () => {
  describe('structural projection invariants', () => {
    it('threads viewportOrigin verbatim from viewport to region', () => {
      const vp = viewport({
        id: 'main',
        viewportOrigin: { x: FROZEN_COLS_WIDTH, y: FROZEN_ROWS_HEIGHT },
      });
      const result = viewportLayoutToRegionLayout(makeLayout([vp]), SHEET_ID);
      expect(result.regions[0].viewportOrigin).toEqual({
        x: FROZEN_COLS_WIDTH,
        y: FROZEN_ROWS_HEIGHT,
      });
    });

    it('threads scrollOffset verbatim', () => {
      const vp = viewport({ id: 'main', scrollOffset: { x: 350, y: 175 } });
      const result = viewportLayoutToRegionLayout(makeLayout([vp]), SHEET_ID);
      expect(result.regions[0].scrollOffset).toEqual({ x: 350, y: 175 });
    });

    it('preserves bounds, zoom, and id', () => {
      const vp = viewport({
        id: 'frozen-corner',
        bounds: { x: 50, y: 30, width: 80, height: 21 },
        zoom: 1.25,
      });
      const result = viewportLayoutToRegionLayout(makeLayout([vp]), SHEET_ID);
      expect(result.regions[0].id).toBe('frozen-corner');
      expect(result.regions[0].bounds).toEqual({ x: 50, y: 30, width: 80, height: 21 });
      expect(result.regions[0].zoom).toBe(1.25);
    });

    it('passes through contentSize and maxScroll', () => {
      const layout = makeLayout([viewport({ id: 'main' })]);
      const result = viewportLayoutToRegionLayout(layout, SHEET_ID);
      expect(result.contentSize).toEqual(layout.contentSize);
      expect(result.maxScroll).toEqual(layout.maxScroll);
    });

    it('uses fallback sheetId when viewport has none', () => {
      const vp = viewport({ id: 'main' });
      const result = viewportLayoutToRegionLayout(makeLayout([vp]), SHEET_ID);
      expect(result.regions[0].metadata.sheetId).toBe(SHEET_ID);
    });

    it('prefers viewport.sheetId over fallback', () => {
      const vp = viewport({ id: 'overlay', sheetId: 'sheet-other' });
      const result = viewportLayoutToRegionLayout(makeLayout([vp]), SHEET_ID);
      expect(result.regions[0].metadata.sheetId).toBe('sheet-other');
    });
  });

  describe('all 4 freeze configurations preserve viewportOrigin', () => {
    it('no freeze (single pane): viewportOrigin = (0, 0)', () => {
      const vp = viewport({ id: 'main', viewportOrigin: { x: 0, y: 0 } });
      const result = viewportLayoutToRegionLayout(makeLayout([vp]), SHEET_ID);
      expect(result.regions[0].viewportOrigin).toEqual({ x: 0, y: 0 });
      expect(result.regions[0].metadata.scrollBehavior).toBe('free');
      expect(result.regions[0].metadata.isFrozen).toBe(false);
    });

    it('frozen rows only: rows pane has origin (0,0), main has origin (0, frozenRowsHeight)', () => {
      const layout = makeLayout([
        viewport({
          id: 'frozen-rows',
          viewportOrigin: { x: 0, y: 0 },
          scrollBehavior: { type: 'horizontal-only' },
        }),
        viewport({
          id: 'main',
          viewportOrigin: { x: 0, y: FROZEN_ROWS_HEIGHT },
        }),
      ]);
      const result = viewportLayoutToRegionLayout(layout, SHEET_ID);
      expect(result.regions[0].viewportOrigin).toEqual({ x: 0, y: 0 });
      expect(result.regions[0].metadata.scrollBehavior).toBe('row-anchored');
      expect(result.regions[0].metadata.isFrozen).toBe(true);
      expect(result.regions[1].viewportOrigin).toEqual({ x: 0, y: FROZEN_ROWS_HEIGHT });
      expect(result.regions[1].metadata.scrollBehavior).toBe('free');
    });

    it('frozen cols only: cols pane has origin (0,0), main has origin (frozenColsWidth, 0)', () => {
      const layout = makeLayout([
        viewport({
          id: 'frozen-cols',
          viewportOrigin: { x: 0, y: 0 },
          scrollBehavior: { type: 'vertical-only' },
        }),
        viewport({
          id: 'main',
          viewportOrigin: { x: FROZEN_COLS_WIDTH, y: 0 },
        }),
      ]);
      const result = viewportLayoutToRegionLayout(layout, SHEET_ID);
      expect(result.regions[0].viewportOrigin).toEqual({ x: 0, y: 0 });
      expect(result.regions[0].metadata.scrollBehavior).toBe('col-anchored');
      expect(result.regions[1].viewportOrigin).toEqual({ x: FROZEN_COLS_WIDTH, y: 0 });
    });

    it('frozen rows + cols (4 panes): every viewportOrigin is preserved', () => {
      const layout = makeLayout([
        viewport({
          id: 'frozen-corner',
          viewportOrigin: { x: 0, y: 0 },
          scrollBehavior: { type: 'none' },
        }),
        viewport({
          id: 'frozen-rows',
          viewportOrigin: { x: FROZEN_COLS_WIDTH, y: 0 },
          scrollBehavior: { type: 'horizontal-only' },
        }),
        viewport({
          id: 'frozen-cols',
          viewportOrigin: { x: 0, y: FROZEN_ROWS_HEIGHT },
          scrollBehavior: { type: 'vertical-only' },
        }),
        viewport({
          id: 'main',
          viewportOrigin: { x: FROZEN_COLS_WIDTH, y: FROZEN_ROWS_HEIGHT },
        }),
      ]);
      const result = viewportLayoutToRegionLayout(layout, SHEET_ID);
      expect(result.regions.map((r) => r.viewportOrigin)).toEqual([
        { x: 0, y: 0 },
        { x: FROZEN_COLS_WIDTH, y: 0 },
        { x: 0, y: FROZEN_ROWS_HEIGHT },
        { x: FROZEN_COLS_WIDTH, y: FROZEN_ROWS_HEIGHT },
      ]);
      expect(result.regions.map((r) => r.metadata.scrollBehavior)).toEqual([
        'none',
        'row-anchored',
        'col-anchored',
        'free',
      ]);
      expect(result.regions.map((r) => r.metadata.isFrozen)).toEqual([true, true, true, false]);
    });
  });
});
