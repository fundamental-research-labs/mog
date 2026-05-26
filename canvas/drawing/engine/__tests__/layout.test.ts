/**
 * Layout Operations Tests (Snap, Align, Distribute)
 */
import { alignObjects } from '../src/layout/align';
import { distributeObjects } from '../src/layout/distribute';
import { snapToGrid, snapToObjects } from '../src/layout/snap';

// =============================================================================
// snapToGrid
// =============================================================================

describe('snapToGrid', () => {
  it('should snap to nearest grid point', () => {
    const result = snapToGrid({ x: 13, y: 27 }, 10);
    expect(result.x).toBe(10);
    expect(result.y).toBe(30);
    expect(result.snappedX).toBe(true);
    expect(result.snappedY).toBe(true);
  });

  it('should not snap if already on grid', () => {
    const result = snapToGrid({ x: 20, y: 30 }, 10);
    expect(result.x).toBe(20);
    expect(result.y).toBe(30);
    expect(result.snappedX).toBe(false);
    expect(result.snappedY).toBe(false);
    expect(result.guides).toHaveLength(0);
  });

  it('should handle grid size of 1', () => {
    const result = snapToGrid({ x: 5.5, y: 3.7 }, 1);
    expect(result.x).toBe(6);
    expect(result.y).toBe(4);
  });

  it('should handle non-positive grid size', () => {
    const result = snapToGrid({ x: 15, y: 25 }, 0);
    expect(result.x).toBe(15);
    expect(result.y).toBe(25);
    expect(result.snappedX).toBe(false);
    expect(result.snappedY).toBe(false);
  });

  it('should generate grid guides', () => {
    const result = snapToGrid({ x: 13, y: 27 }, 10);
    expect(result.guides.length).toBeGreaterThan(0);
    expect(result.guides.some((g) => g.type === 'grid')).toBe(true);
  });

  it('should snap negative coordinates', () => {
    const result = snapToGrid({ x: -7, y: -13 }, 10);
    expect(result.x).toBe(-10);
    expect(result.y).toBe(-10);
  });
});

// =============================================================================
// snapToObjects
// =============================================================================

describe('snapToObjects', () => {
  it('should snap left edge to other left edge', () => {
    const moving = { x: 48, y: 100, width: 80, height: 60 };
    const others = [{ x: 50, y: 0, width: 100, height: 50 }];
    const result = snapToObjects(moving, others, 5);
    expect(result.snappedX).toBe(true);
    expect(result.x).toBe(50);
  });

  it('should snap center to center', () => {
    const moving = { x: 48, y: 100, width: 100, height: 60 };
    const others = [{ x: 0, y: 0, width: 100, height: 50 }];
    // moving center X = 48 + 50 = 98, other center X = 50, diff = 48 > 5
    // This won't snap center-to-center. Let's adjust.
    const moving2 = { x: -2, y: 100, width: 100, height: 60 };
    // moving center X = -2 + 50 = 48, other center X = 50, diff = 2 <= 5
    const result = snapToObjects(moving2, others, 5);
    expect(result.snappedX).toBe(true);
    expect(result.x).toBe(0); // shifted +2 to align centers
  });

  it('should not snap if beyond tolerance', () => {
    const moving = { x: 100, y: 100, width: 80, height: 60 };
    const others = [{ x: 50, y: 0, width: 100, height: 50 }];
    const result = snapToObjects(moving, others, 5);
    // Left edge: 100 vs 50, diff=50 > 5
    // Right edge: 180 vs 150, diff=30 > 5
    // etc. All should be beyond tolerance
    expect(result.snappedX).toBe(false);
    expect(result.x).toBe(100);
  });

  it('should snap Y axis independently', () => {
    const moving = { x: 100, y: 48, width: 80, height: 60 };
    const others = [{ x: 0, y: 50, width: 100, height: 50 }];
    const result = snapToObjects(moving, others, 5);
    expect(result.snappedY).toBe(true);
    expect(result.y).toBe(50);
  });

  it('should handle empty other bounds', () => {
    const moving = { x: 10, y: 10, width: 80, height: 60 };
    const result = snapToObjects(moving, [], 5);
    expect(result.snappedX).toBe(false);
    expect(result.snappedY).toBe(false);
    expect(result.x).toBe(10);
    expect(result.y).toBe(10);
  });

  it('should generate snap guides', () => {
    const moving = { x: 48, y: 100, width: 80, height: 60 };
    const others = [{ x: 50, y: 0, width: 100, height: 50 }];
    const result = snapToObjects(moving, others, 5);
    expect(result.guides.length).toBeGreaterThan(0);
  });

  it('should snap to closest alignment when multiple are within tolerance', () => {
    const moving = { x: 49, y: 100, width: 80, height: 60 };
    const others = [
      { x: 50, y: 0, width: 100, height: 50 },
      { x: 48, y: 200, width: 100, height: 50 },
    ];
    const result = snapToObjects(moving, others, 5);
    // left-to-left: 49 vs 50 (diff=1), 49 vs 48 (diff=1)
    // Both are within tolerance. The first one found with smallest diff wins.
    expect(result.snappedX).toBe(true);
  });
});

// =============================================================================
// alignObjects
// =============================================================================

describe('alignObjects', () => {
  const objects = [
    { id: 'a', bounds: { x: 10, y: 20, width: 50, height: 30 } },
    { id: 'b', bounds: { x: 100, y: 50, width: 80, height: 40 } },
    { id: 'c', bounds: { x: 50, y: 80, width: 60, height: 20 } },
  ];

  it('should align left', () => {
    const result = alignObjects(objects, 'left');
    // Reference left edge = min(10, 100, 50) = 10
    for (const item of result) {
      expect(item.newBounds.x).toBe(10);
    }
  });

  it('should align right', () => {
    const result = alignObjects(objects, 'right');
    // Reference right edge = max(60, 180, 110) = 180
    for (const item of result) {
      expect(item.newBounds.x + item.newBounds.width).toBe(180);
    }
  });

  it('should align center', () => {
    const result = alignObjects(objects, 'center');
    // Reference: x=10, width=170, center = 10 + 85 = 95
    for (const item of result) {
      const center = item.newBounds.x + item.newBounds.width / 2;
      expect(center).toBeCloseTo(95);
    }
  });

  it('should align top', () => {
    const result = alignObjects(objects, 'top');
    // Reference top = min(20, 50, 80) = 20
    for (const item of result) {
      expect(item.newBounds.y).toBe(20);
    }
  });

  it('should align bottom', () => {
    const result = alignObjects(objects, 'bottom');
    // Reference bottom = max(50, 90, 100) = 100
    for (const item of result) {
      expect(item.newBounds.y + item.newBounds.height).toBe(100);
    }
  });

  it('should align middle', () => {
    const result = alignObjects(objects, 'middle');
    // Reference: y=20, height=80, middle = 20 + 40 = 60
    for (const item of result) {
      const middle = item.newBounds.y + item.newBounds.height / 2;
      expect(middle).toBeCloseTo(60);
    }
  });

  it('should preserve width/height', () => {
    const result = alignObjects(objects, 'left');
    expect(result[0].newBounds.width).toBe(50);
    expect(result[1].newBounds.width).toBe(80);
    expect(result[2].newBounds.width).toBe(60);
  });

  it('should use custom reference bounds', () => {
    const ref = { x: 0, y: 0, width: 200, height: 200 };
    const result = alignObjects(objects, 'left', ref);
    for (const item of result) {
      expect(item.newBounds.x).toBe(0);
    }
  });

  it('should handle empty array', () => {
    expect(alignObjects([], 'left')).toEqual([]);
  });

  it('should handle single object', () => {
    const single = [{ id: 'a', bounds: { x: 10, y: 20, width: 50, height: 30 } }];
    const result = alignObjects(single, 'left');
    expect(result[0].newBounds.x).toBe(10);
  });
});

// =============================================================================
// distributeObjects
// =============================================================================

describe('distributeObjects', () => {
  it('should distribute horizontally with equal gaps', () => {
    const objects = [
      { id: 'a', bounds: { x: 0, y: 0, width: 20, height: 20 } },
      { id: 'b', bounds: { x: 50, y: 0, width: 20, height: 20 } },
      { id: 'c', bounds: { x: 200, y: 0, width: 20, height: 20 } },
    ];
    const result = distributeObjects(objects, 'horizontal');

    // Total span: (200+20) - 0 = 220
    // Total object width: 20+20+20 = 60
    // Total gap: 160
    // Gap between: 160/2 = 80

    // First stays at 0
    expect(result.find((r) => r.id === 'a')!.newBounds.x).toBe(0);
    // Middle: 0 + 20 + 80 = 100
    expect(result.find((r) => r.id === 'b')!.newBounds.x).toBe(100);
    // Last stays at 200
    expect(result.find((r) => r.id === 'c')!.newBounds.x).toBe(200);
  });

  it('should distribute vertically with equal gaps', () => {
    const objects = [
      { id: 'a', bounds: { x: 0, y: 0, width: 20, height: 30 } },
      { id: 'b', bounds: { x: 0, y: 50, width: 20, height: 30 } },
      { id: 'c', bounds: { x: 0, y: 300, width: 20, height: 30 } },
    ];
    const result = distributeObjects(objects, 'vertical');

    // Total span: (300+30) - 0 = 330
    // Total object height: 30+30+30 = 90
    // Total gap: 240
    // Gap between: 240/2 = 120

    expect(result.find((r) => r.id === 'a')!.newBounds.y).toBe(0);
    expect(result.find((r) => r.id === 'b')!.newBounds.y).toBe(150); // 0+30+120
    expect(result.find((r) => r.id === 'c')!.newBounds.y).toBe(300);
  });

  it('should handle 2 objects (no distribution)', () => {
    const objects = [
      { id: 'a', bounds: { x: 0, y: 0, width: 20, height: 20 } },
      { id: 'b', bounds: { x: 100, y: 0, width: 20, height: 20 } },
    ];
    const result = distributeObjects(objects, 'horizontal');
    expect(result.find((r) => r.id === 'a')!.newBounds.x).toBe(0);
    expect(result.find((r) => r.id === 'b')!.newBounds.x).toBe(100);
  });

  it('should handle 1 object', () => {
    const objects = [{ id: 'a', bounds: { x: 50, y: 50, width: 20, height: 20 } }];
    const result = distributeObjects(objects, 'horizontal');
    expect(result[0].newBounds.x).toBe(50);
  });

  it('should preserve object sizes', () => {
    const objects = [
      { id: 'a', bounds: { x: 0, y: 0, width: 20, height: 30 } },
      { id: 'b', bounds: { x: 50, y: 0, width: 40, height: 50 } },
      { id: 'c', bounds: { x: 200, y: 0, width: 60, height: 10 } },
    ];
    const result = distributeObjects(objects, 'horizontal');
    expect(result.find((r) => r.id === 'a')!.newBounds.width).toBe(20);
    expect(result.find((r) => r.id === 'b')!.newBounds.width).toBe(40);
    expect(result.find((r) => r.id === 'c')!.newBounds.width).toBe(60);
  });

  it('should keep first and last fixed', () => {
    const objects = [
      { id: 'a', bounds: { x: 10, y: 0, width: 20, height: 20 } },
      { id: 'b', bounds: { x: 200, y: 0, width: 20, height: 20 } },
      { id: 'c', bounds: { x: 500, y: 0, width: 20, height: 20 } },
    ];
    const result = distributeObjects(objects, 'horizontal');
    expect(result.find((r) => r.id === 'a')!.newBounds.x).toBe(10);
    expect(result.find((r) => r.id === 'c')!.newBounds.x).toBe(500);
  });

  it('should handle four objects evenly', () => {
    const objects = [
      { id: 'a', bounds: { x: 0, y: 0, width: 20, height: 20 } },
      { id: 'b', bounds: { x: 30, y: 0, width: 20, height: 20 } },
      { id: 'c', bounds: { x: 60, y: 0, width: 20, height: 20 } },
      { id: 'd', bounds: { x: 300, y: 0, width: 20, height: 20 } },
    ];
    const result = distributeObjects(objects, 'horizontal');

    // Total span: 320, total widths: 80, total gap: 240, gap per: 80
    expect(result.find((r) => r.id === 'a')!.newBounds.x).toBe(0);
    expect(result.find((r) => r.id === 'b')!.newBounds.x).toBe(100);
    expect(result.find((r) => r.id === 'c')!.newBounds.x).toBe(200);
    expect(result.find((r) => r.id === 'd')!.newBounds.x).toBe(300);
  });
});
