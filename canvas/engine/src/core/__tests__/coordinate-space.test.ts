/**
 * Coordinate-Space Conversion Tests
 *
 * Tests for docToCanvas, canvasToDoc, docToCanvasXY, canvasToDocXY,
 * canvasToLocal, canvasToPhysical. Uses non-zero scroll offsets,
 * non-zero viewportOrigin, and zoom to verify that conversions are
 * correct and that the identity case (origin=scroll=0, zoom=1) is a
 * degenerate case, not the only case that works.
 *
 * The viewportOrigin != 0 cases lock the invariant that dropping viewportOrigin
 * silently mis-paints frozen panes; the canonical formula subtracts/adds it
 * together with scrollOffset.
 *
 * @module canvas-engine/core/__tests__/coordinate-space.test
 */

import {
  canvasToDoc,
  canvasToDocXY,
  canvasToLocal,
  canvasToPhysical,
  docToCanvas,
  docToCanvasXY,
  regionLocalVisibleRect,
} from '../coordinate-space';
import { canvasSpaceRect, docSpaceRect } from '../types';

describe('coordinate-space conversions', () => {
  const region = {
    bounds: { x: 50, y: 30 },
    viewportOrigin: { x: 0, y: 0 },
    scrollOffset: { x: 200, y: 100 },
    zoom: 2,
  };

  // ===========================================================================
  // docToCanvas
  // ===========================================================================

  describe('docToCanvas', () => {
    it('converts at non-zero scroll and zoom', () => {
      const doc = docSpaceRect(300, 200, 100, 50);
      const canvas = docToCanvas(doc, region);
      // canvasX = 50 + (300 - 0 - 200) * 2 = 250
      // canvasY = 30 + (200 - 0 - 100) * 2 = 230
      expect(canvas.x).toBe(250);
      expect(canvas.y).toBe(230);
      expect(canvas.width).toBe(200);
      expect(canvas.height).toBe(100);
    });

    it('is identity at scroll(0,0) zoom=1 with origin at (0,0) viewportOrigin(0,0)', () => {
      const identityRegion = {
        bounds: { x: 0, y: 0 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 0, y: 0 },
        zoom: 1,
      };
      const doc = docSpaceRect(100, 200, 50, 30);
      const canvas = docToCanvas(doc, identityRegion);
      expect(canvas.x).toBe(100);
      expect(canvas.y).toBe(200);
      expect(canvas.width).toBe(50);
      expect(canvas.height).toBe(30);
    });

    it('applies region bounds offset even at zoom=1 scroll=0', () => {
      const regionWithBounds = {
        bounds: { x: 50, y: 30 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 0, y: 0 },
        zoom: 1,
      };
      const doc = docSpaceRect(100, 200, 50, 30);
      const canvas = docToCanvas(doc, regionWithBounds);
      expect(canvas.x).toBe(150); // 50 + 100
      expect(canvas.y).toBe(230); // 30 + 200
    });

    it('correctly handles zoom without scroll', () => {
      const zoomOnly = {
        bounds: { x: 0, y: 0 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 0, y: 0 },
        zoom: 1.5,
      };
      const doc = docSpaceRect(100, 200, 40, 20);
      const canvas = docToCanvas(doc, zoomOnly);
      expect(canvas.x).toBe(150); // 100 * 1.5
      expect(canvas.y).toBe(300); // 200 * 1.5
      expect(canvas.width).toBe(60); // 40 * 1.5
      expect(canvas.height).toBe(30); // 20 * 1.5
    });

    it('correctly handles scroll without zoom', () => {
      const scrollOnly = {
        bounds: { x: 0, y: 0 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 150, y: 75 },
        zoom: 1,
      };
      const doc = docSpaceRect(200, 100, 40, 20);
      const canvas = docToCanvas(doc, scrollOnly);
      expect(canvas.x).toBe(50); // 200 - 150
      expect(canvas.y).toBe(25); // 100 - 75
      expect(canvas.width).toBe(40);
      expect(canvas.height).toBe(20);
    });

    it('produces negative coordinates for cells scrolled off-screen', () => {
      const scrolled = {
        bounds: { x: 0, y: 0 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 200, y: 200 },
        zoom: 1,
      };
      const doc = docSpaceRect(50, 50, 100, 25);
      const canvas = docToCanvas(doc, scrolled);
      expect(canvas.x).toBe(-150); // 50 - 200
      expect(canvas.y).toBe(-150); // 50 - 200
    });

    // -------------------------------------------------------------------------
    // viewportOrigin != 0 invariant tests
    // -------------------------------------------------------------------------

    it('subtracts viewportOrigin alongside scrollOffset (frozen-pane case)', () => {
      // freeze-top-row-paint-alignment scenario: frozenRowsHeight = 21px,
      // main pane has viewportOrigin.y = 21, scrollOffset.y = 0.
      // The first non-frozen row (row 1) has docY = getRowTop(1) = 21.
      // Local Y in main pane should be 0 (so it paints flush to the divider).
      const mainPaneAtRest = {
        bounds: { x: 0, y: 21 }, // Main pane bounds start below frozen rows
        viewportOrigin: { x: 0, y: 21 },
        scrollOffset: { x: 0, y: 0 },
        zoom: 1,
      };
      const row1 = docSpaceRect(0, 21, 100, 21);
      const canvas = docToCanvas(row1, mainPaneAtRest);
      // local-to-region = (21 - 21 - 0) * 1 = 0, plus bounds.y = 21
      expect(canvas.y).toBe(21);
    });

    it('handles viewportOrigin + scrollOffset together (frozen pane after scroll)', () => {
      // After scrolling 15px, scrollOffset.y = 15. Row 1 (docY=21) should
      // appear partially scrolled into the frozen-row area but the main
      // pane bounds clip at y=21, so canvas y = 21 + (21 - 21 - 15) = 6.
      const mainPaneScrolled = {
        bounds: { x: 0, y: 21 },
        viewportOrigin: { x: 0, y: 21 },
        scrollOffset: { x: 0, y: 15 },
        zoom: 1,
      };
      const row1 = docSpaceRect(0, 21, 100, 21);
      const canvas = docToCanvas(row1, mainPaneScrolled);
      expect(canvas.y).toBe(6);
    });

    it('does not bleed row 0 into the main pane (the regression this round closes)', () => {
      // Row 0 has docY = 0. With viewportOrigin.y = 21 and scrollOffset.y = 15,
      // its canvas position relative to the main pane is:
      // bounds.y(21) + (0 - 21 - 15) = 21 - 36 = -15 → off-screen above the
      // main pane. (Pre-fix bug: the truncated formula gave bounds.y(21) +
      // (0 - 15) = 6, placing row 0 inside the main pane on top of row 1
      // and producing the doubled-row visual.)
      const mainPaneScrolled = {
        bounds: { x: 0, y: 21 },
        viewportOrigin: { x: 0, y: 21 },
        scrollOffset: { x: 0, y: 15 },
        zoom: 1,
      };
      const row0 = docSpaceRect(0, 0, 100, 21);
      const canvas = docToCanvas(row0, mainPaneScrolled);
      expect(canvas.y).toBe(-15);
      expect(canvas.y + canvas.height).toBe(6); // bottom edge below main pane top — engine clips
    });

    it('frozen-cols pane: viewportOrigin.y is non-zero on the Y axis', () => {
      // Both axes frozen, frozen-cols pane: viewportOrigin = (0, 21),
      // scrollOffset = (0, 30). Cell at row 3 (docY = 63), col 0 (docX = 0):
      const frozenColsPane = {
        bounds: { x: 0, y: 21 },
        viewportOrigin: { x: 0, y: 21 },
        scrollOffset: { x: 0, y: 30 },
        zoom: 1,
      };
      const cell = docSpaceRect(0, 63, 40, 21);
      const canvas = docToCanvas(cell, frozenColsPane);
      // x: 0 + (0 - 0 - 0) * 1 = 0
      // y: 21 + (63 - 21 - 30) * 1 = 21 + 12 = 33
      expect(canvas.x).toBe(0);
      expect(canvas.y).toBe(33);
    });
  });

  // ===========================================================================
  // canvasToDoc (round-trip)
  // ===========================================================================

  describe('canvasToDoc', () => {
    it('round-trips through docToCanvas with viewportOrigin != 0', () => {
      const frozenPaneRegion = {
        bounds: { x: 50, y: 30 },
        viewportOrigin: { x: 80, y: 21 },
        scrollOffset: { x: 200, y: 100 },
        zoom: 2,
      };
      const original = docSpaceRect(300, 200, 100, 50);
      const canvas = docToCanvas(original, frozenPaneRegion);
      const roundTripped = canvasToDoc(canvas, frozenPaneRegion);
      expect(roundTripped.x).toBeCloseTo(original.x);
      expect(roundTripped.y).toBeCloseTo(original.y);
      expect(roundTripped.width).toBeCloseTo(original.width);
      expect(roundTripped.height).toBeCloseTo(original.height);
    });

    it('round-trips at fractional zoom with non-zero viewportOrigin', () => {
      const fracRegion = {
        bounds: { x: 10, y: 20 },
        viewportOrigin: { x: 80, y: 42 },
        scrollOffset: { x: 33, y: 77 },
        zoom: 1.333,
      };
      const original = docSpaceRect(150.5, 200.7, 80.3, 40.1);
      const canvas = docToCanvas(original, fracRegion);
      const roundTripped = canvasToDoc(canvas, fracRegion);
      expect(roundTripped.x).toBeCloseTo(original.x, 8);
      expect(roundTripped.y).toBeCloseTo(original.y, 8);
      expect(roundTripped.width).toBeCloseTo(original.width, 8);
      expect(roundTripped.height).toBeCloseTo(original.height, 8);
    });

    it('is identity at scroll(0,0) zoom=1 origin(0,0) viewportOrigin(0,0)', () => {
      const identityRegion = {
        bounds: { x: 0, y: 0 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 0, y: 0 },
        zoom: 1,
      };
      const canvas = canvasSpaceRect(100, 200, 50, 30);
      const doc = canvasToDoc(canvas, identityRegion);
      expect(doc.x).toBe(100);
      expect(doc.y).toBe(200);
      expect(doc.width).toBe(50);
      expect(doc.height).toBe(30);
    });
  });

  // ===========================================================================
  // docToCanvasXY / canvasToDocXY (scalar form)
  // ===========================================================================

  describe('docToCanvasXY (scalar companion)', () => {
    it('produces the same x/y as docToCanvas (rect form delegates to scalar form)', () => {
      const r = {
        bounds: { x: 50, y: 30 },
        viewportOrigin: { x: 80, y: 21 },
        scrollOffset: { x: 12, y: 7 },
        zoom: 1.5,
      };
      const rect = docToCanvas(docSpaceRect(120, 80, 40, 20), r);
      const scalar = docToCanvasXY(120, 80, r);
      expect(scalar.x).toBe(rect.x);
      expect(scalar.y).toBe(rect.y);
    });

    it('subtracts viewportOrigin and scrollOffset together at scalar level', () => {
      const mainPane = {
        bounds: { x: 0, y: 21 },
        viewportOrigin: { x: 0, y: 21 },
        scrollOffset: { x: 0, y: 0 },
        zoom: 1,
      };
      const xy = docToCanvasXY(0, 21, mainPane);
      expect(xy.y).toBe(21); // bounds.y + (21 - 21 - 0) = 21 → flush to divider
    });
  });

  describe('canvasToDocXY (scalar companion)', () => {
    it('round-trips with docToCanvasXY at non-zero viewportOrigin', () => {
      const r = {
        bounds: { x: 50, y: 30 },
        viewportOrigin: { x: 80, y: 21 },
        scrollOffset: { x: 12, y: 7 },
        zoom: 1.5,
      };
      const docXY = { x: 120, y: 80 };
      const canvas = docToCanvasXY(docXY.x, docXY.y, r);
      const back = canvasToDocXY(canvas.x, canvas.y, r);
      expect(back.x).toBeCloseTo(docXY.x);
      expect(back.y).toBeCloseTo(docXY.y);
    });

    it('produces the same x/y as canvasToDoc (rect form delegates to scalar form)', () => {
      const r = {
        bounds: { x: 50, y: 30 },
        viewportOrigin: { x: 80, y: 21 },
        scrollOffset: { x: 12, y: 7 },
        zoom: 1.5,
      };
      const rect = canvasToDoc(canvasSpaceRect(140, 60, 30, 20), r);
      const scalar = canvasToDocXY(140, 60, r);
      expect(scalar.x).toBe(rect.x);
      expect(scalar.y).toBe(rect.y);
    });
  });

  // ===========================================================================
  // canvasToLocal
  // ===========================================================================

  describe('canvasToLocal', () => {
    it('subtracts region bounds origin', () => {
      const canvas = canvasSpaceRect(250, 230, 200, 100);
      const local = canvasToLocal(canvas, region);
      expect(local.x).toBe(200); // 250 - 50
      expect(local.y).toBe(200); // 230 - 30
      expect(local.width).toBe(200);
      expect(local.height).toBe(100);
    });

    it('preserves width and height', () => {
      const canvas = canvasSpaceRect(100, 100, 50, 30);
      const local = canvasToLocal(canvas, region);
      expect(local.width).toBe(50);
      expect(local.height).toBe(30);
    });

    it('produces zero origin when canvas position equals region bounds', () => {
      const canvas = canvasSpaceRect(50, 30, 200, 100);
      const local = canvasToLocal(canvas, region);
      expect(local.x).toBe(0);
      expect(local.y).toBe(0);
    });
  });

  describe('regionLocalVisibleRect', () => {
    it('converts canvas-space bounds to local unzoomed extents when zoomed out', () => {
      const zoomedOutRegion = {
        bounds: { x: 50, y: 30, width: 800, height: 500 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 0, y: 0 },
        zoom: 0.5,
      };

      expect(regionLocalVisibleRect(zoomedOutRegion)).toEqual({
        x: 0,
        y: 0,
        width: 1600,
        height: 1000,
      });
    });
  });

  // ===========================================================================
  // canvasToPhysical
  // ===========================================================================

  describe('canvasToPhysical', () => {
    it('scales by DPR with correct rounding', () => {
      const canvas = canvasSpaceRect(10.5, 20.3, 100.7, 50.2);
      const phys = canvasToPhysical(canvas, 2);
      expect(phys.x).toBe(21);
      expect(phys.y).toBe(Math.floor(20.3 * 2));
      expect(phys.width).toBe(Math.ceil((10.5 + 100.7) * 2) - Math.floor(10.5 * 2));
      expect(phys.height).toBe(Math.ceil((20.3 + 50.2) * 2) - Math.floor(20.3 * 2));
    });

    it('is exact for integer coordinates at DPR=1', () => {
      const canvas = canvasSpaceRect(10, 20, 100, 50);
      const phys = canvasToPhysical(canvas, 1);
      expect(phys.x).toBe(10);
      expect(phys.y).toBe(20);
      expect(phys.width).toBe(100);
      expect(phys.height).toBe(50);
    });

    it('expands width/height to cover sub-pixel edges at DPR=2', () => {
      const canvas = canvasSpaceRect(0.5, 0.5, 1, 1);
      const phys = canvasToPhysical(canvas, 2);
      expect(phys.x).toBe(1);
      expect(phys.y).toBe(1);
      expect(phys.width).toBe(2);
      expect(phys.height).toBe(2);
    });

    it('handles DPR=3 (high-density displays)', () => {
      const canvas = canvasSpaceRect(10, 20, 100, 50);
      const phys = canvasToPhysical(canvas, 3);
      expect(phys.x).toBe(30);
      expect(phys.y).toBe(60);
      expect(phys.width).toBe(300);
      expect(phys.height).toBe(150);
    });
  });
});
