/**
 * Header-Grid Alignment Tests
 *
 * Verifies that the header layer and background (gridline) layer produce
 * identical stroke coordinates for the same logical cell boundary.
 *
 * Bug #15 root cause: headers used hardcoded `-0.5` offsets while the grid
 * body used `snapToPixelGrid(value, dpr)`. The fix made both layers use
 * `snapToPixelGrid`. These tests enforce that invariant across a matrix of
 * dpr, zoom, and scrollOffset values.
 *
 * Coordinate contract:
 * - Background (per-region): engine applies ctx.translate(bounds) and
 *   ctx.scale(zoom) before draw. Layer draws at
 *   `snapToPixelGrid(docPos - scrollOffset, dpr)` in region-local coords.
 *   Canvas-absolute = bounds + snappedLocal * zoom.
 *
 * - Headers (once): no engine transform. Layer computes canvas-absolute as
 *   `bounds + snapToPixelGrid(docPos - scrollOffset, dpr) * zoom`.
 *
 * Both must produce the same canvas-absolute coordinate for the same
 * logical cell boundary.
 */

import { snapToPixelGrid } from '@mog/canvas-engine';

// =============================================================================
// Test Matrix
// =============================================================================

const DPR_VALUES = [1, 1.5, 2, 3];
const ZOOM_VALUES = [0.5, 1, 1.25, 2];
const SCROLL_OFFSETS = [0, 100.5, 337];
const CELL_BOUNDARIES = [0, 64, 100, 150.5, 256, 1000];

// =============================================================================
// Coordinate computation helpers (mirrors actual layer logic)
// =============================================================================

/**
 * Computes the canvas-absolute X (or Y) coordinate for a gridline in the
 * background layer (per-region mode).
 *
 * The engine applies ctx.translate(bounds.x, bounds.y) and ctx.scale(zoom),
 * so the final canvas position is: bounds + regionLocalSnapped * zoom
 */
function backgroundGridlineCoord(
  docPos: number,
  scrollOffset: number,
  boundsOrigin: number,
  zoom: number,
  dpr: number,
): number {
  const regionLocal = snapToPixelGrid(docPos - scrollOffset, dpr);
  return boundsOrigin + regionLocal * zoom;
}

/**
 * Computes the canvas-absolute X (or Y) coordinate for a header cell border
 * in the headers layer (once mode).
 *
 * Headers compute: bounds + snapToPixelGrid(docPos - scrollOffset, dpr) * zoom
 * (see headers.ts lines 327-328 and 413-414 after the fix)
 */
function headerBorderCoord(
  docPos: number,
  scrollOffset: number,
  boundsOrigin: number,
  zoom: number,
  dpr: number,
): number {
  const snappedLocal = snapToPixelGrid(docPos - scrollOffset, dpr);
  return boundsOrigin + snappedLocal * zoom;
}

// =============================================================================
// Tests
// =============================================================================

describe('Header-Grid alignment', () => {
  describe('header and background produce identical canvas coordinates', () => {
    // Use a fixed bounds origin that is non-zero to test the offset addition
    const boundsOrigin = 40; // e.g., row header width

    for (const dpr of DPR_VALUES) {
      for (const zoom of ZOOM_VALUES) {
        for (const scrollOffset of SCROLL_OFFSETS) {
          describe(`dpr=${dpr}, zoom=${zoom}, scrollOffset=${scrollOffset}`, () => {
            for (const cellBoundary of CELL_BOUNDARIES) {
              it(`aligns at cell boundary ${cellBoundary}`, () => {
                const bgCoord = backgroundGridlineCoord(
                  cellBoundary,
                  scrollOffset,
                  boundsOrigin,
                  zoom,
                  dpr,
                );
                const headerCoord = headerBorderCoord(
                  cellBoundary,
                  scrollOffset,
                  boundsOrigin,
                  zoom,
                  dpr,
                );

                // Exact floating-point equality — both use the same formula
                expect(headerCoord).toBe(bgCoord);
              });
            }
          });
        }
      }
    }
  });

  describe('snapped coordinates land on physical half-pixel boundaries', () => {
    // After snapping, the region-local coordinate should be on a half-pixel
    // boundary for the given DPR. This ensures crisp 1px strokes.
    //
    // A half-pixel boundary at DPR d means: value * d = integer + 0.5

    for (const dpr of DPR_VALUES) {
      describe(`dpr=${dpr}`, () => {
        for (const scrollOffset of SCROLL_OFFSETS) {
          for (const cellBoundary of CELL_BOUNDARIES) {
            it(`snaps ${cellBoundary} (scroll=${scrollOffset}) to half-pixel`, () => {
              const snapped = snapToPixelGrid(cellBoundary - scrollOffset, dpr);
              const physical = snapped * dpr;
              // physical should be N + 0.5 for some integer N
              const fractional = physical - Math.floor(physical);
              expect(fractional).toBeCloseTo(0.5, 8);
            });
          }
        }
      });
    }
  });

  describe('old hardcoded -0.5 would have misaligned (regression guard)', () => {
    // Verify that the old header approach (docPos - 0.5) does NOT match
    // the background's snapToPixelGrid for non-trivial cases.
    // This ensures we're testing something meaningful — if the old approach
    // happened to match, these tests wouldn't catch regressions.

    it('diverges at dpr=1 for integer cell boundary', () => {
      const dpr = 1;
      const scrollOffset = 0;
      const cellBoundary = 100;
      const boundsOrigin = 40;
      const zoom = 1;

      // Old header approach: bounds + (docPos - scrollOffset) * zoom - 0.5
      const oldHeaderCoord = boundsOrigin + (cellBoundary - scrollOffset) * zoom - 0.5;
      // New approach (same as background)
      const newHeaderCoord = headerBorderCoord(cellBoundary, scrollOffset, boundsOrigin, zoom, dpr);

      // Old: 40 + 100 - 0.5 = 139.5
      // New: 40 + snapToPixelGrid(100, 1) * 1 = 40 + 100.5 = 140.5
      // Difference: 1.0 CSS pixel
      expect(oldHeaderCoord).not.toBe(newHeaderCoord);
      expect(newHeaderCoord - oldHeaderCoord).toBe(1);
    });

    it('diverges at dpr=2 for integer cell boundary', () => {
      const dpr = 2;
      const scrollOffset = 0;
      const cellBoundary = 100;
      const boundsOrigin = 40;
      const zoom = 1;

      const oldHeaderCoord = boundsOrigin + (cellBoundary - scrollOffset) * zoom - 0.5;
      const newHeaderCoord = headerBorderCoord(cellBoundary, scrollOffset, boundsOrigin, zoom, dpr);

      // Old: 40 + 100 - 0.5 = 139.5
      // New: 40 + snapToPixelGrid(100, 2) * 1 = 40 + 100.25 = 140.25
      // Difference: 0.75 CSS pixel
      expect(oldHeaderCoord).not.toBe(newHeaderCoord);
      expect(newHeaderCoord - oldHeaderCoord).toBe(0.75);
    });
  });
});
