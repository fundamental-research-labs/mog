/**
 * Tests for continuous scroll expansion logic.
 *
 * Verifies the invariants:
 * 1. Monotonic growth — expanded dimensions never decrease for increasing scroll
 * 2. Bidirectional — expansion contracts when scrolling back up
 * 3. Sub-pixel thumb continuity — thumb moves < 1px between consecutive frames
 * 4. Bounded range — never exceeds Excel maximums
 * 5. Thumb bounds — thumb stays within [0, scrollableTrack]
 */

import {
  computeContinuousExpansion,
  computeScrollbarDragPosition,
  getScrollbarThumbColor,
  SCROLLBAR_TRACK_BORDER_COLOR,
  SCROLLBAR_TRACK_COLOR,
} from '../ScrollContainer';

// Mirror the constants from the implementation
const DEFAULT_ROW_HEIGHT = 20;
const DEFAULT_COL_WIDTH = 72;
const MAX_HEIGHT = 1_048_576 * DEFAULT_ROW_HEIGHT;
const MAX_WIDTH = 16_384 * DEFAULT_COL_WIDTH;
const SCROLL_BUFFER_ROWS = 100;
const SCROLL_BUFFER_COLS = 50;
const SCROLL_HEADROOM_Y = SCROLL_BUFFER_ROWS * DEFAULT_ROW_HEIGHT;
const SCROLL_HEADROOM_X = SCROLL_BUFFER_COLS * DEFAULT_COL_WIDTH;

// Typical viewport
const VP_WIDTH = 1200;
const VP_HEIGHT = 800;

// Base dimensions (a small sheet — 200 rows × 20 cols)
const BASE_HEIGHT = 200 * DEFAULT_ROW_HEIGHT; // 4000px
const BASE_WIDTH = 20 * DEFAULT_COL_WIDTH; // 1440px

/** Compute thumb offset given scroll state */
function thumbPosition(
  scrollPos: number,
  maxScroll: number,
  viewportSize: number,
  contentSize: number,
  trackLength: number,
  minThumb: number,
): number {
  const thumbRatio = contentSize > 0 ? viewportSize / contentSize : 1;
  const thumbSize = Math.max(minThumb, Math.round(trackLength * thumbRatio));
  const scrollableTrack = trackLength - thumbSize;
  return maxScroll > 0 ? (scrollPos / maxScroll) * scrollableTrack : 0;
}

describe('computeContinuousExpansion', () => {
  describe('monotonic growth for increasing scroll', () => {
    it('expandedHeight never decreases for increasing scrollY', () => {
      let prevHeight = BASE_HEIGHT;

      for (let scrollY = 0; scrollY <= 50_000; scrollY += 50) {
        const result = computeContinuousExpansion(
          BASE_WIDTH,
          BASE_HEIGHT,
          0,
          scrollY,
          VP_WIDTH,
          VP_HEIGHT,
        );

        expect(result.height).toBeGreaterThanOrEqual(prevHeight);
        prevHeight = result.height;
      }
    });
  });

  describe('bidirectional expansion', () => {
    it('expandedHeight contracts when scrolling back up', () => {
      // Scroll down to 10000
      const peak = computeContinuousExpansion(
        BASE_WIDTH,
        BASE_HEIGHT,
        0,
        10_000,
        VP_WIDTH,
        VP_HEIGHT,
      );
      const peakHeight = peak.height;

      // Scroll back to 0 — height should return to base
      const atZero = computeContinuousExpansion(BASE_WIDTH, BASE_HEIGHT, 0, 0, VP_WIDTH, VP_HEIGHT);
      expect(atZero.height).toBe(BASE_HEIGHT);
      expect(atZero.height).toBeLessThan(peakHeight);
    });

    it('contraction is smooth — no jumps during scroll-up', () => {
      const TRACK_LENGTH = VP_HEIGHT - 15;
      const MIN_THUMB = 24;

      // Start at scrollY=10000 and scroll back to 0
      let prevThumb = -1;
      for (let scrollY = 10_000; scrollY >= 0; scrollY -= 1) {
        const { height } = computeContinuousExpansion(
          BASE_WIDTH,
          BASE_HEIGHT,
          0,
          scrollY,
          VP_WIDTH,
          VP_HEIGHT,
        );
        const maxScrollY = Math.max(0, height - VP_HEIGHT);
        const thumb = thumbPosition(
          scrollY,
          maxScrollY,
          VP_HEIGHT,
          height,
          TRACK_LENGTH,
          MIN_THUMB,
        );

        if (prevThumb >= 0) {
          const delta = Math.abs(thumb - prevThumb);
          expect(delta).toBeLessThan(1);
        }
        prevThumb = thumb;
      }
    });

    it('thumb reaches 0 when scrolled back to top', () => {
      const { height } = computeContinuousExpansion(
        BASE_WIDTH,
        BASE_HEIGHT,
        0,
        0,
        VP_WIDTH,
        VP_HEIGHT,
      );
      const maxScrollY = Math.max(0, height - VP_HEIGHT);
      const TRACK = VP_HEIGHT - 15;
      const thumb = thumbPosition(0, maxScrollY, VP_HEIGHT, height, TRACK, 24);
      expect(thumb).toBe(0);
    });
  });

  describe('sub-pixel thumb continuity', () => {
    it('thumb moves < 1px per frame during smooth scroll (1px/frame)', () => {
      const TRACK_LENGTH = VP_HEIGHT - 15;
      const MIN_THUMB = 24;
      let prevThumb = 0;

      for (let scrollY = 0; scrollY <= 20_000; scrollY += 1) {
        const { height } = computeContinuousExpansion(
          BASE_WIDTH,
          BASE_HEIGHT,
          0,
          scrollY,
          VP_WIDTH,
          VP_HEIGHT,
        );

        const maxScrollY = Math.max(0, height - VP_HEIGHT);
        const thumb = thumbPosition(
          scrollY,
          maxScrollY,
          VP_HEIGHT,
          height,
          TRACK_LENGTH,
          MIN_THUMB,
        );
        const delta = Math.abs(thumb - prevThumb);

        expect(delta).toBeLessThan(1);
        prevThumb = thumb;
      }
    });

    it('thumb ratio changes smoothly during fast scroll (100px/frame)', () => {
      let prevRatio = 0;

      for (let scrollY = 0; scrollY <= 100_000; scrollY += 100) {
        const { height } = computeContinuousExpansion(
          BASE_WIDTH,
          BASE_HEIGHT,
          0,
          scrollY,
          VP_WIDTH,
          VP_HEIGHT,
        );

        const maxScrollY = Math.max(0, height - VP_HEIGHT);
        const ratio = maxScrollY > 0 ? scrollY / maxScrollY : 0;
        const deltaRatio = Math.abs(ratio - prevRatio);

        // No jumps larger than 5% of total range
        expect(deltaRatio).toBeLessThan(0.05);
        prevRatio = ratio;
      }
    });
  });

  describe('boundary conditions', () => {
    it('scrollY = 0 produces thumb at top', () => {
      const { height } = computeContinuousExpansion(
        BASE_WIDTH,
        BASE_HEIGHT,
        0,
        0,
        VP_WIDTH,
        VP_HEIGHT,
      );
      const maxScrollY = Math.max(0, height - VP_HEIGHT);
      const TRACK = VP_HEIGHT - 15;
      const thumb = thumbPosition(0, maxScrollY, VP_HEIGHT, height, TRACK, 24);
      expect(thumb).toBe(0);
    });

    it('scrollY = maxScrollY produces thumb at bottom', () => {
      const { height } = computeContinuousExpansion(
        BASE_WIDTH,
        BASE_HEIGHT,
        0,
        5000,
        VP_WIDTH,
        VP_HEIGHT,
      );
      const maxScrollY = Math.max(0, height - VP_HEIGHT);
      const TRACK = VP_HEIGHT - 15;
      const thumb = thumbPosition(maxScrollY, maxScrollY, VP_HEIGHT, height, TRACK, 24);
      const thumbRatio = height > 0 ? VP_HEIGHT / height : 1;
      const thumbSize = Math.max(24, Math.round(TRACK * thumbRatio));
      const scrollableTrack = TRACK - thumbSize;
      expect(thumb).toBeCloseTo(scrollableTrack, 5);
    });

    it('expandedHeight never exceeds MAX_HEIGHT', () => {
      const hugeScroll = MAX_HEIGHT;
      const { height } = computeContinuousExpansion(
        BASE_WIDTH,
        BASE_HEIGHT,
        0,
        hugeScroll,
        VP_WIDTH,
        VP_HEIGHT,
      );
      expect(height).toBeLessThanOrEqual(MAX_HEIGHT);
    });

    it('expandedWidth never exceeds MAX_WIDTH', () => {
      const hugeScroll = MAX_WIDTH;
      const { width } = computeContinuousExpansion(
        BASE_WIDTH,
        BASE_HEIGHT,
        hugeScroll,
        0,
        VP_WIDTH,
        VP_HEIGHT,
      );
      expect(width).toBeLessThanOrEqual(MAX_WIDTH);
    });
  });

  describe('base dimension behavior', () => {
    it('at scrollY=0, expandedHeight equals base when base > viewport+headroom', () => {
      // BASE_HEIGHT (4000) < VP_HEIGHT + HEADROOM (800 + 2000 = 2800)... actually 4000 > 2800
      // At scrollY=0: needed = 0 + 800 + 2000 = 2800. max(4000, 2800) = 4000
      const { height } = computeContinuousExpansion(
        BASE_WIDTH,
        BASE_HEIGHT,
        0,
        0,
        VP_WIDTH,
        VP_HEIGHT,
      );
      expect(height).toBe(BASE_HEIGHT);
    });

    it('scrolling down triggers expansion beyond base', () => {
      const scrollY = BASE_HEIGHT; // beyond base
      const { height } = computeContinuousExpansion(
        BASE_WIDTH,
        BASE_HEIGHT,
        0,
        scrollY,
        VP_WIDTH,
        VP_HEIGHT,
      );
      expect(height).toBeGreaterThan(BASE_HEIGHT);
      expect(height).toBe(scrollY + VP_HEIGHT + SCROLL_HEADROOM_Y);
    });

    it('base dimension growth (rows added): expansion accommodates', () => {
      const largerBase = 500 * DEFAULT_ROW_HEIGHT; // 10000px
      const { height } = computeContinuousExpansion(
        BASE_WIDTH,
        largerBase,
        0,
        0,
        VP_WIDTH,
        VP_HEIGHT,
      );
      expect(height).toBe(largerBase);
    });

    it('expansion provides headroom beyond scroll position', () => {
      const scrollY = 3000;
      const { height } = computeContinuousExpansion(
        BASE_WIDTH,
        BASE_HEIGHT,
        0,
        scrollY,
        VP_WIDTH,
        VP_HEIGHT,
      );
      expect(height).toBeGreaterThanOrEqual(scrollY + VP_HEIGHT + SCROLL_HEADROOM_Y);
    });
  });

  describe('horizontal expansion', () => {
    it('width expands continuously for increasing scrollX', () => {
      let prevWidth = BASE_WIDTH;

      for (let scrollX = 0; scrollX <= 20_000; scrollX += 50) {
        const { width } = computeContinuousExpansion(
          BASE_WIDTH,
          BASE_HEIGHT,
          scrollX,
          0,
          VP_WIDTH,
          VP_HEIGHT,
        );
        expect(width).toBeGreaterThanOrEqual(prevWidth);
        prevWidth = width;
      }
    });

    it('width contracts when scrolling back left', () => {
      const peak = computeContinuousExpansion(
        BASE_WIDTH,
        BASE_HEIGHT,
        10_000,
        0,
        VP_WIDTH,
        VP_HEIGHT,
      );

      const atZero = computeContinuousExpansion(BASE_WIDTH, BASE_HEIGHT, 0, 0, VP_WIDTH, VP_HEIGHT);

      expect(atZero.width).toBeLessThan(peak.width);
    });
  });
});

describe('computeScrollbarDragPosition', () => {
  it('maps dragging the thumb left edge to scroll position 0', () => {
    expect(
      computeScrollbarDragPosition({
        pointerPosition: 112,
        trackStart: 100,
        thumbPointerOffset: 12,
        scrollableTrack: 900,
        maxScroll: 20_000,
      }),
    ).toBe(0);
  });

  it('snaps near-left-edge thumb drags to scroll position 0', () => {
    expect(
      computeScrollbarDragPosition({
        pointerPosition: 115,
        trackStart: 100,
        thumbPointerOffset: 12,
        scrollableTrack: 900,
        maxScroll: 20_000,
      }),
    ).toBe(0);
  });

  it('maps dragging the thumb right edge to max scroll', () => {
    expect(
      computeScrollbarDragPosition({
        pointerPosition: 988,
        trackStart: 100,
        thumbPointerOffset: 12,
        scrollableTrack: 876,
        maxScroll: 20_000,
      }),
    ).toBe(20_000);
  });

  it('snaps near-right-edge thumb drags to max scroll', () => {
    expect(
      computeScrollbarDragPosition({
        pointerPosition: 985,
        trackStart: 100,
        thumbPointerOffset: 12,
        scrollableTrack: 876,
        maxScroll: 20_000,
      }),
    ).toBe(20_000);
  });

  it('uses absolute pointer position so a changing maxScroll model cannot strand left drags', () => {
    const trackStart = 100;
    const thumbPointerOffset = 64;

    const peak = computeScrollbarDragPosition({
      pointerPosition: 1100,
      trackStart,
      thumbPointerOffset,
      scrollableTrack: 900,
      maxScroll: 20_000,
    });
    expect(peak).toBeGreaterThan(0);

    const returnedLeftAfterContraction = computeScrollbarDragPosition({
      pointerPosition: trackStart + thumbPointerOffset,
      trackStart,
      thumbPointerOffset,
      // These values intentionally differ from the right-drag model,
      // matching continuous expansion contracting during drag.
      scrollableTrack: 760,
      maxScroll: 8_000,
    });
    expect(returnedLeftAfterContraction).toBe(0);
  });
});

describe('scrollbar theme tokens', () => {
  it('uses theme tokens for track and thumb contrast', () => {
    expect(SCROLLBAR_TRACK_COLOR).toContain('--scrollbar-track');
    expect(SCROLLBAR_TRACK_BORDER_COLOR).toContain('--scrollbar-track-border');
    expect(getScrollbarThumbColor(false)).toContain('--scrollbar-thumb');
    expect(getScrollbarThumbColor(true)).toContain('--scrollbar-thumb-active');
  });
});
