/**
 * Transform Math Tests
 *
 * Tests for pure geometry functions: calculateResizeBounds, applyAspectRatio,
 * and calculateRotationDelta. Ported from production's
 * operation-calculations.test.ts and adapted for the domain-free Rect type
 * (no rotation field).
 */

import type { Rect } from '../core/types';
import {
  applyAspectRatio,
  calculateResizeBounds,
  calculateRotationDelta,
  type ResizeHandle,
} from '../geometry/transform-math';

// =============================================================================
// Helpers
// =============================================================================

/** Default test rect: 200x100 at position (100, 100). */
function rect(overrides: Partial<Rect> = {}): Rect {
  return { x: 100, y: 100, width: 200, height: 100, ...overrides };
}

// =============================================================================
// calculateResizeBounds — All 8 handles
// =============================================================================

describe('calculateResizeBounds', () => {
  describe('east (e) handle — right edge', () => {
    it('increases width when dragged right', () => {
      const r = calculateResizeBounds(rect(), 'e', 50, 0);
      expect(r.x).toBe(100);
      expect(r.y).toBe(100);
      expect(r.width).toBe(250);
      expect(r.height).toBe(100);
    });

    it('decreases width when dragged left', () => {
      const r = calculateResizeBounds(rect(), 'e', -50, 0);
      expect(r.width).toBe(150);
    });

    it('ignores vertical delta', () => {
      const r = calculateResizeBounds(rect(), 'e', 50, 9999);
      expect(r.height).toBe(100);
    });
  });

  describe('west (w) handle — left edge', () => {
    it('increases width and shifts x left when dragged left', () => {
      const r = calculateResizeBounds(rect(), 'w', -50, 0);
      expect(r.x).toBe(50);
      expect(r.width).toBe(250);
    });

    it('decreases width and shifts x right when dragged right', () => {
      const r = calculateResizeBounds(rect(), 'w', 50, 0);
      expect(r.x).toBe(150);
      expect(r.width).toBe(150);
    });
  });

  describe('south (s) handle — bottom edge', () => {
    it('increases height when dragged down', () => {
      const r = calculateResizeBounds(rect(), 's', 0, 50);
      expect(r.height).toBe(150);
      expect(r.y).toBe(100);
    });

    it('decreases height when dragged up', () => {
      const r = calculateResizeBounds(rect(), 's', 0, -50);
      expect(r.height).toBe(50);
    });

    it('ignores horizontal delta', () => {
      const r = calculateResizeBounds(rect(), 's', 9999, 50);
      expect(r.width).toBe(200);
    });
  });

  describe('north (n) handle — top edge', () => {
    it('increases height and shifts y up when dragged up', () => {
      const r = calculateResizeBounds(rect(), 'n', 0, -50);
      expect(r.y).toBe(50);
      expect(r.height).toBe(150);
    });

    it('decreases height and shifts y down when dragged down', () => {
      const r = calculateResizeBounds(rect(), 'n', 0, 50);
      expect(r.y).toBe(150);
      expect(r.height).toBe(50);
    });
  });

  describe('southeast (se) handle — corner', () => {
    it('increases both dimensions when dragged down-right', () => {
      const r = calculateResizeBounds(rect(), 'se', 50, 50);
      expect(r.width).toBe(250);
      expect(r.height).toBe(150);
      expect(r.x).toBe(100);
      expect(r.y).toBe(100);
    });
  });

  describe('northwest (nw) handle — corner', () => {
    it('increases both dimensions and shifts position when dragged up-left', () => {
      const r = calculateResizeBounds(rect(), 'nw', -50, -50);
      expect(r.x).toBe(50);
      expect(r.y).toBe(50);
      expect(r.width).toBe(250);
      expect(r.height).toBe(150);
    });
  });

  describe('northeast (ne) handle — corner', () => {
    it('increases width, increases height, shifts y up', () => {
      const r = calculateResizeBounds(rect(), 'ne', 50, -50);
      expect(r.x).toBe(100);
      expect(r.y).toBe(50);
      expect(r.width).toBe(250);
      expect(r.height).toBe(150);
    });
  });

  describe('southwest (sw) handle — corner', () => {
    it('increases width (shifts x left), increases height downward', () => {
      const r = calculateResizeBounds(rect(), 'sw', -50, 50);
      expect(r.x).toBe(50);
      expect(r.y).toBe(100);
      expect(r.width).toBe(250);
      expect(r.height).toBe(150);
    });
  });

  describe('zero delta', () => {
    it('returns unchanged bounds when delta is zero', () => {
      const original = rect();
      const r = calculateResizeBounds(original, 'se', 0, 0);
      expect(r).toEqual(original);
    });

    it.each<ResizeHandle>(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'])(
      'returns unchanged bounds for handle %s with zero delta',
      (handle) => {
        const original = rect();
        const r = calculateResizeBounds(original, handle, 0, 0);
        expect(r).toEqual(original);
      },
    );
  });
});

// =============================================================================
// calculateResizeBounds — with constraints
// =============================================================================

describe('calculateResizeBounds with constraints', () => {
  describe('minWidth / minHeight', () => {
    it('enforces default minWidth=1 when width would go to zero or negative', () => {
      // deltaX = -300 would make width = 200-300 = -100
      const r = calculateResizeBounds(rect(), 'e', -300, 0);
      expect(r.width).toBe(1);
    });

    it('enforces default minHeight=1 when height would go negative', () => {
      const r = calculateResizeBounds(rect(), 's', 0, -200);
      expect(r.height).toBe(1);
    });

    it('enforces custom minWidth', () => {
      const r = calculateResizeBounds(rect(), 'e', -150, 0, { minWidth: 100 });
      // 200 - 150 = 50, clamped to 100
      expect(r.width).toBe(100);
    });

    it('enforces custom minHeight', () => {
      const r = calculateResizeBounds(rect(), 's', 0, -50, { minHeight: 80 });
      // 100 - 50 = 50, clamped to 80
      expect(r.height).toBe(80);
    });

    it('allows sizes above the minimum', () => {
      const r = calculateResizeBounds(rect(), 'se', 200, 200, {
        minWidth: 100,
        minHeight: 80,
      });
      expect(r.width).toBe(400);
      expect(r.height).toBe(300);
    });
  });

  describe('aspect ratio — corner handles', () => {
    it('preserves 2:1 aspect ratio on se corner', () => {
      // Original 200x100 = 2:1. Drag east by 100 (width->300, height stays 100).
      // scaleX = 300/200 = 1.5, scaleY = 100/100 = 1.0
      // dominant = scaleX => new 300x150
      const r = calculateResizeBounds(rect(), 'se', 100, 0, { aspectRatio: 2 });
      expect(r.width).toBe(300);
      expect(r.height).toBe(150);
    });

    it('preserves 2:1 aspect ratio on nw corner', () => {
      const r = calculateResizeBounds(rect(), 'nw', -100, 0, { aspectRatio: 2 });
      expect(r.width).toBe(300);
      expect(r.height).toBe(150);
    });

    it('preserves 1:1 aspect ratio (square)', () => {
      const sq = rect({ width: 100, height: 100 });
      const r = calculateResizeBounds(sq, 'se', 50, 0, { aspectRatio: 1 });
      expect(r.width).toBe(r.height);
    });

    it('preserves 8:1 aspect ratio on se corner', () => {
      const wide = rect({ width: 400, height: 50 });
      const r = calculateResizeBounds(wide, 'se', 100, 0, { aspectRatio: 8 });
      const ratio = r.width / r.height;
      expect(ratio).toBeCloseTo(8, 1);
    });

    it('adjusts position for nw handle', () => {
      const r = calculateResizeBounds(rect(), 'nw', -100, 0, { aspectRatio: 2 });
      // x should move left since width grew
      expect(r.x).toBeLessThan(100);
    });
  });

  describe('aspect ratio — edge handles', () => {
    it('adjusts height for east edge to maintain ratio', () => {
      const r = calculateResizeBounds(rect(), 'e', 100, 0, { aspectRatio: 2 });
      // width = 300, height = 300/2 = 150
      expect(r.width).toBe(300);
      expect(r.height).toBe(150);
    });

    it('adjusts width for north edge to maintain ratio', () => {
      const r = calculateResizeBounds(rect(), 'n', 0, -50, { aspectRatio: 2 });
      // height = 150, width = 150*2 = 300
      expect(r.height).toBe(150);
      expect(r.width).toBe(300);
    });

    it('adjusts height for west edge', () => {
      const r = calculateResizeBounds(rect(), 'w', -100, 0, { aspectRatio: 2 });
      // width = 300, height = 300/2 = 150
      expect(r.width).toBe(300);
      expect(r.height).toBe(150);
    });

    it('adjusts width for south edge', () => {
      const r = calculateResizeBounds(rect(), 's', 0, 50, { aspectRatio: 2 });
      // height = 150, width = 150*2 = 300
      expect(r.height).toBe(150);
      expect(r.width).toBe(300);
    });
  });

  describe('aspect ratio — tall ratios', () => {
    it('preserves 1:8 aspect ratio on south edge', () => {
      const tall = rect({ width: 50, height: 400 });
      const r = calculateResizeBounds(tall, 's', 0, 100, { aspectRatio: 0.125 });
      const ratio = r.width / r.height;
      expect(ratio).toBeCloseTo(0.125, 2);
    });
  });
});

// =============================================================================
// applyAspectRatio (standalone)
// =============================================================================

describe('applyAspectRatio', () => {
  const original = rect(); // 200x100

  describe('corner handles — proportional scale', () => {
    it('scales by dominant axis (scaleX > scaleY)', () => {
      const newBounds: Rect = { x: 100, y: 100, width: 300, height: 100 };
      const r = applyAspectRatio(newBounds, original, 'se', 2);
      // scaleX = 1.5, scaleY = 1.0 => use scaleX
      expect(r.width).toBe(300);
      expect(r.height).toBe(150);
    });

    it('scales by dominant axis (scaleY > scaleX)', () => {
      const newBounds: Rect = { x: 100, y: 100, width: 200, height: 200 };
      const r = applyAspectRatio(newBounds, original, 'se', 2);
      // scaleX = 1.0, scaleY = 2.0 => use scaleY
      expect(r.width).toBe(400);
      expect(r.height).toBe(200);
    });

    it('adjusts x for nw handle', () => {
      const newBounds: Rect = { x: 0, y: 0, width: 300, height: 200 };
      const r = applyAspectRatio(newBounds, original, 'nw', 2);
      // scaleX = 1.5, scaleY = 2.0 => use scaleY, scale=2
      // newWidth = 400, newHeight = 200
      // x = 100 + 200 - 400 = -100
      // y = 100 + 100 - 200 = 0
      expect(r.x).toBe(-100);
      expect(r.y).toBe(0);
      expect(r.width).toBe(400);
      expect(r.height).toBe(200);
    });

    it('adjusts y for ne handle', () => {
      const newBounds: Rect = { x: 100, y: 0, width: 300, height: 200 };
      const r = applyAspectRatio(newBounds, original, 'ne', 2);
      // scaleX = 1.5, scaleY = 2.0 => use scaleY, scale=2
      // newWidth = 400, newHeight = 200
      // no w => x stays at 100
      // n => y = 100 + 100 - 200 = 0
      expect(r.x).toBe(100);
      expect(r.y).toBe(0);
      expect(r.width).toBe(400);
      expect(r.height).toBe(200);
    });

    it('adjusts x for sw handle', () => {
      const newBounds: Rect = { x: 0, y: 100, width: 300, height: 200 };
      const r = applyAspectRatio(newBounds, original, 'sw', 2);
      // scaleY = 2.0 dominant
      // w => x = 100 + 200 - 400 = -100
      // no n => y stays
      expect(r.x).toBe(-100);
      expect(r.y).toBe(100);
      expect(r.width).toBe(400);
      expect(r.height).toBe(200);
    });
  });

  describe('edge handles — adjust opposite dimension', () => {
    it('east: adjusts height', () => {
      const newBounds: Rect = { x: 100, y: 100, width: 300, height: 100 };
      const r = applyAspectRatio(newBounds, original, 'e', 2);
      expect(r.width).toBe(300);
      expect(r.height).toBe(150); // 300 / 2
    });

    it('west: adjusts height', () => {
      const newBounds: Rect = { x: 50, y: 100, width: 250, height: 100 };
      const r = applyAspectRatio(newBounds, original, 'w', 2);
      expect(r.width).toBe(250);
      expect(r.height).toBe(125); // 250 / 2
    });

    it('north: adjusts width', () => {
      const newBounds: Rect = { x: 100, y: 50, width: 200, height: 150 };
      const r = applyAspectRatio(newBounds, original, 'n', 2);
      expect(r.height).toBe(150);
      expect(r.width).toBe(300); // 150 * 2
    });

    it('south: adjusts width', () => {
      const newBounds: Rect = { x: 100, y: 100, width: 200, height: 200 };
      const r = applyAspectRatio(newBounds, original, 's', 2);
      expect(r.height).toBe(200);
      expect(r.width).toBe(400); // 200 * 2
    });
  });

  describe('various ratios', () => {
    it('1:1 ratio preserves square on corner handle', () => {
      const sq: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const newBounds: Rect = { x: 0, y: 0, width: 150, height: 120 };
      const r = applyAspectRatio(newBounds, sq, 'se', 1);
      expect(r.width).toBe(r.height);
    });

    it('8:1 ratio on edge handle', () => {
      const wide: Rect = { x: 0, y: 0, width: 400, height: 50 };
      const newBounds: Rect = { x: 0, y: 0, width: 500, height: 50 };
      const r = applyAspectRatio(newBounds, wide, 'e', 8);
      expect(r.width).toBe(500);
      expect(r.height).toBeCloseTo(62.5); // 500 / 8
    });
  });
});

// =============================================================================
// calculateRotationDelta
// =============================================================================

describe('calculateRotationDelta', () => {
  const center = { x: 200, y: 150 };

  it('calculates 90 degree clockwise rotation', () => {
    // Start at 3 o'clock (right of center), end at 6 o'clock (below center)
    const delta = calculateRotationDelta(center, { x: 300, y: 150 }, { x: 200, y: 250 });
    expect(delta).toBeCloseTo(90, 0);
  });

  it('calculates 90 degree counter-clockwise rotation', () => {
    // Start at 3 o'clock, end at 12 o'clock (above center)
    const delta = calculateRotationDelta(center, { x: 300, y: 150 }, { x: 200, y: 50 });
    expect(delta).toBeCloseTo(-90, 0);
  });

  it('calculates 180 degree rotation', () => {
    // Start at 3 o'clock, end at 9 o'clock (left of center)
    const delta = calculateRotationDelta(center, { x: 300, y: 150 }, { x: 100, y: 150 });
    expect(Math.abs(delta)).toBeCloseTo(180, 0);
  });

  it('returns zero when positions are the same', () => {
    const delta = calculateRotationDelta(center, { x: 300, y: 150 }, { x: 300, y: 150 });
    expect(delta).toBeCloseTo(0, 5);
  });

  it('handles small angle changes (~5 degrees)', () => {
    const radius = 100;
    const startAngle = 0;
    const endAngle = (5 * Math.PI) / 180;

    const start = {
      x: center.x + radius * Math.cos(startAngle),
      y: center.y + radius * Math.sin(startAngle),
    };
    const end = {
      x: center.x + radius * Math.cos(endAngle),
      y: center.y + radius * Math.sin(endAngle),
    };

    const delta = calculateRotationDelta(center, start, end);
    expect(delta).toBeCloseTo(5, 0);
  });

  it('handles full 360 degree rotation (same position = 0 delta)', () => {
    const pos = { x: 300, y: 150 };
    const delta = calculateRotationDelta(center, pos, pos);
    expect(delta).toBeCloseTo(0, 5);
  });

  it('works with a different center point', () => {
    const altCenter = { x: 0, y: 0 };
    // Start at 3 o'clock, end at 6 o'clock relative to origin
    const delta = calculateRotationDelta(altCenter, { x: 100, y: 0 }, { x: 0, y: 100 });
    expect(delta).toBeCloseTo(90, 0);
  });

  it('handles negative center coordinates', () => {
    const negCenter = { x: -100, y: -100 };
    // Start at 3 o'clock relative to negCenter
    const start = { x: 0, y: -100 };
    // End at 6 o'clock relative to negCenter
    const end = { x: -100, y: 0 };
    const delta = calculateRotationDelta(negCenter, start, end);
    expect(delta).toBeCloseTo(90, 0);
  });
});
