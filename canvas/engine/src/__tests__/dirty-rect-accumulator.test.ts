/**
 * DirtyRectAccumulator Tests
 */

import type { DocSpaceRect } from '../core/types';
import { DirtyRectAccumulator } from '../core/dirty-rect-accumulator';

// =============================================================================
// Helpers
// =============================================================================

function rect(x: number, y: number, width: number, height: number): DocSpaceRect {
  return { x, y, width, height } as DocSpaceRect;
}

// =============================================================================
// Tests
// =============================================================================

describe('DirtyRectAccumulator', () => {
  let acc: DirtyRectAccumulator;

  beforeEach(() => {
    acc = new DirtyRectAccumulator();
  });

  // ---------------------------------------------------------------------------
  // isDirty
  // ---------------------------------------------------------------------------

  it('isDirty() returns false when clean', () => {
    expect(acc.isDirty()).toBe(false);
    expect(acc.isFull()).toBe(false);
    expect(acc.getRects()).toEqual([]);
  });

  it('isDirty() returns true after adding a rect hint', () => {
    acc.add({ type: 'rect', bounds: rect(0, 0, 100, 100) });
    expect(acc.isDirty()).toBe(true);
  });

  it('isDirty() returns true after adding a full hint', () => {
    acc.add({ type: 'full' });
    expect(acc.isDirty()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Full hint (backward compat: markDirty with no rect info)
  // ---------------------------------------------------------------------------

  it('add({ type: "full" }) sets isFull() to true', () => {
    acc.add({ type: 'full' });
    expect(acc.isFull()).toBe(true);
    expect(acc.getRects()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Rect hints accumulate
  // ---------------------------------------------------------------------------

  it('add({ type: "rect" }) accumulates, isFull() stays false', () => {
    acc.add({ type: 'rect', bounds: rect(10, 20, 30, 40) });
    expect(acc.isFull()).toBe(false);
    expect(acc.getRects()).toEqual([rect(10, 20, 30, 40)]);
  });

  it('multiple rect hints accumulate in order', () => {
    const r1 = rect(0, 0, 10, 10);
    const r2 = rect(50, 50, 20, 20);
    const r3 = rect(100, 100, 5, 5);

    acc.add({ type: 'rect', bounds: r1 });
    acc.add({ type: 'rect', bounds: r2 });
    acc.add({ type: 'rect', bounds: r3 });

    expect(acc.isFull()).toBe(false);
    expect(acc.getRects()).toEqual([r1, r2, r3]);
  });

  it('add({ type: "rects" }) pushes all bounds', () => {
    const bounds = [rect(0, 0, 10, 10), rect(20, 20, 10, 10)];
    acc.add({ type: 'rects', bounds });

    expect(acc.getRects()).toEqual(bounds);
    expect(acc.isFull()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Rect count threshold triggers coalescing
  // ---------------------------------------------------------------------------

  it('exceeding 16 rects triggers auto-coalesce into a single bounding union', () => {
    // Add 17 small non-overlapping rects along the x-axis
    for (let i = 0; i < 17; i++) {
      acc.add({ type: 'rect', bounds: rect(i * 10, 0, 5, 5) });
    }

    // After exceeding threshold, rects should be coalesced to one bounding union
    expect(acc.isFull()).toBe(false);
    expect(acc.getRects().length).toBe(1);

    const union = acc.getRects()[0];
    expect(union.x).toBe(0);
    expect(union.y).toBe(0);
    expect(union.width).toBe(165); // 16*10 + 5
    expect(union.height).toBe(5);
  });

  it('large rects hints coalesce without spreading the array into the call stack', () => {
    const bounds = Array.from({ length: 200_000 }, (_, i) => rect(i, i % 7, 1, 2));

    expect(() => acc.add({ type: 'rects', bounds })).not.toThrow();
    expect(acc.isFull()).toBe(false);
    expect(acc.getRects()).toEqual([rect(0, 0, 200_000, 8)]);
  });

  // ---------------------------------------------------------------------------
  // Area threshold promotes to full
  // ---------------------------------------------------------------------------

  it('coalesce() promotes to full when union exceeds 50% of viewport', () => {
    // Two rects that together span a large area
    acc.add({ type: 'rect', bounds: rect(0, 0, 400, 300) });
    acc.add({ type: 'rect', bounds: rect(400, 300, 400, 300) });

    const viewportArea = 800 * 600; // 480000
    // Union is (0,0)-(800,600) = 480000 which is 100% of viewport (> 50%)
    acc.coalesce(viewportArea);

    expect(acc.isFull()).toBe(true);
    expect(acc.getRects()).toEqual([]);
  });

  it('coalesce() does NOT promote to full when union is below 50% of viewport', () => {
    acc.add({ type: 'rect', bounds: rect(0, 0, 10, 10) });
    acc.add({ type: 'rect', bounds: rect(20, 20, 10, 10) });

    const viewportArea = 800 * 600;
    // Union is (0,0)-(30,30) = 900, which is far below 50%
    acc.coalesce(viewportArea);

    expect(acc.isFull()).toBe(false);
    expect(acc.getRects().length).toBe(1); // coalesced to bounding union
  });

  it('coalesce() without viewport area merges rects but does not promote', () => {
    acc.add({ type: 'rect', bounds: rect(0, 0, 1000, 1000) });
    acc.add({ type: 'rect', bounds: rect(500, 500, 1000, 1000) });

    acc.coalesce(); // no viewport area
    expect(acc.isFull()).toBe(false);
    expect(acc.getRects().length).toBe(1);
  });

  it('coalesce() is a no-op when already full', () => {
    acc.add({ type: 'full' });
    acc.coalesce(1000);
    expect(acc.isFull()).toBe(true);
  });

  it('coalesce() is a no-op with 0 or 1 rects', () => {
    acc.add({ type: 'rect', bounds: rect(0, 0, 10, 10) });
    acc.coalesce(100); // single rect, should not change
    expect(acc.getRects()).toEqual([rect(0, 0, 10, 10)]);
  });

  // ---------------------------------------------------------------------------
  // clear()
  // ---------------------------------------------------------------------------

  it('clear() resets everything', () => {
    acc.add({ type: 'rect', bounds: rect(0, 0, 50, 50) });
    acc.add({ type: 'full' });

    expect(acc.isDirty()).toBe(true);
    expect(acc.isFull()).toBe(true);

    acc.clear();

    expect(acc.isDirty()).toBe(false);
    expect(acc.isFull()).toBe(false);
    expect(acc.getRects()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // promoteToFull()
  // ---------------------------------------------------------------------------

  it('promoteToFull() sets full and clears rects', () => {
    acc.add({ type: 'rect', bounds: rect(10, 10, 20, 20) });
    expect(acc.getRects().length).toBe(1);

    acc.promoteToFull();

    expect(acc.isFull()).toBe(true);
    expect(acc.getRects()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // add() after promoteToFull / full hint is a no-op
  // ---------------------------------------------------------------------------

  it('add(rect) after promoteToFull() is a no-op', () => {
    acc.promoteToFull();
    acc.add({ type: 'rect', bounds: rect(0, 0, 100, 100) });

    expect(acc.isFull()).toBe(true);
    expect(acc.getRects()).toEqual([]);
  });

  it('add(rect) after full hint is a no-op', () => {
    acc.add({ type: 'full' });
    acc.add({ type: 'rect', bounds: rect(0, 0, 100, 100) });

    expect(acc.isFull()).toBe(true);
    expect(acc.getRects()).toEqual([]);
  });

  it('add(rects) after full hint is a no-op', () => {
    acc.add({ type: 'full' });
    acc.add({ type: 'rects', bounds: [rect(0, 0, 10, 10)] });

    expect(acc.isFull()).toBe(true);
    expect(acc.getRects()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // regions hint promotes to full
  // ---------------------------------------------------------------------------

  it('add({ type: "regions" }) promotes to full', () => {
    acc.add({ type: 'regions', regionIds: ['main', 'frozen'] });

    expect(acc.isFull()).toBe(true);
    expect(acc.getRects()).toEqual([]);
  });

  it('regions hint clears existing rects', () => {
    acc.add({ type: 'rect', bounds: rect(0, 0, 10, 10) });
    expect(acc.getRects().length).toBe(1);

    acc.add({ type: 'regions', regionIds: ['main'] });

    expect(acc.isFull()).toBe(true);
    expect(acc.getRects()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // getRects() returns empty when full
  // ---------------------------------------------------------------------------

  it('getRects() returns empty array when full (rects cleared on promotion)', () => {
    acc.add({ type: 'rect', bounds: rect(0, 0, 50, 50) });
    acc.add({ type: 'rect', bounds: rect(100, 100, 50, 50) });
    expect(acc.getRects().length).toBe(2);

    acc.add({ type: 'full' });

    expect(acc.isFull()).toBe(true);
    expect(acc.getRects()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Lifecycle: add, read, clear, repeat
  // ---------------------------------------------------------------------------

  it('supports full add-read-clear cycle across frames', () => {
    // Frame 1: partial dirty
    acc.add({ type: 'rect', bounds: rect(10, 10, 50, 50) });
    expect(acc.isDirty()).toBe(true);
    expect(acc.isFull()).toBe(false);
    expect(acc.getRects().length).toBe(1);
    acc.clear();

    // Frame 2: full dirty
    acc.add({ type: 'full' });
    expect(acc.isDirty()).toBe(true);
    expect(acc.isFull()).toBe(true);
    acc.clear();

    // Frame 3: clean
    expect(acc.isDirty()).toBe(false);
    expect(acc.isFull()).toBe(false);
    expect(acc.getRects()).toEqual([]);
  });
});
