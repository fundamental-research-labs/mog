/**
 * Handle Hit Testing Tests
 *
 * Tests for hit testing with expanded CSS-pixel hit areas,
 * rotation transforms, and multi/single selection modes.
 *
 * Since we're running in Node.js, we mock CanvasRenderingContext2D,
 * Path2D, and DOMMatrix.
 */

import type { CustomHandle } from '../custom-handles';
import { hitTestHandles } from '../handle-hit-testing';
import type { OverlayConfig, ScreenBounds } from '../types';
import { DEFAULT_OVERLAY_CONFIG } from '../types';

// =============================================================================
// Mocks
// =============================================================================

/**
 * Mock Path2D that stores the shape data for our fake isPointInPath.
 * We track the bounds of the path to allow geometric hit testing.
 */
class MockPath2D {
  shapes: Array<{ type: string; args: number[] }> = [];

  rect(x: number, y: number, w: number, h: number): void {
    this.shapes.push({ type: 'rect', args: [x, y, w, h] });
  }

  arc(cx: number, cy: number, r: number, _start: number, _end: number): void {
    this.shapes.push({ type: 'arc', args: [cx, cy, r] });
  }

  moveTo(x: number, y: number): void {
    this.shapes.push({ type: 'moveTo', args: [x, y] });
  }

  lineTo(x: number, y: number): void {
    this.shapes.push({ type: 'lineTo', args: [x, y] });
  }

  closePath(): void {
    // no-op
  }

  addPath(other: MockPath2D, _matrix?: DOMMatrix): void {
    // Copy shapes (ignoring transform for tests -- rotation tests
    // verify logic differently)
    this.shapes.push(...other.shapes);
  }
}

/**
 * Mock DOMMatrix that tracks transform operations.
 */
class MockDOMMatrix {
  translateSelf(_tx: number, _ty: number): MockDOMMatrix {
    return this;
  }

  rotateSelf(_angle: number): MockDOMMatrix {
    return this;
  }
}

// Install global mocks
(globalThis as any).Path2D = MockPath2D;
(globalThis as any).DOMMatrix = MockDOMMatrix;

/**
 * Create a mock CanvasRenderingContext2D with a configurable isPointInPath.
 */
function createMockCtx(
  hitTest?: (path: any, x: number, y: number) => boolean,
): CanvasRenderingContext2D {
  const defaultHitTest = (path: MockPath2D, x: number, y: number): boolean => {
    // Simple geometric test: check if point is in any rect or arc
    for (const shape of path.shapes) {
      if (shape.type === 'rect') {
        const [rx, ry, rw, rh] = shape.args;
        if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
          return true;
        }
      }
      if (shape.type === 'arc') {
        const [cx, cy, r] = shape.args;
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r) {
          return true;
        }
      }
    }
    return false;
  };

  return {
    isPointInPath: hitTest || defaultHitTest,
    save: () => {},
    restore: () => {},
    resetTransform: () => {},
  } as unknown as CanvasRenderingContext2D;
}

// =============================================================================
// Test Helpers
// =============================================================================

const defaultConfig = DEFAULT_OVERLAY_CONFIG;

function makeBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation = 0,
): ScreenBounds {
  return { x, y, width, height, rotation };
}

// =============================================================================
// Basic Hit Testing
// =============================================================================

describe('hitTestHandles', () => {
  describe('no selection', () => {
    it('returns null when selectedIds is empty', () => {
      const ctx = createMockCtx();
      const result = hitTestHandles(
        ctx,
        { x: 100, y: 100 },
        [],
        () => null,
        () => false,
        null,
        [],
        defaultConfig,
      );
      expect(result).toBeNull();
    });
  });

  describe('single selection', () => {
    const bounds = makeBounds(100, 100, 200, 150);
    const getBounds = (id: string) => (id === 'obj1' ? bounds : null);
    const notLocked = () => false;

    it('returns null when point is far from any handle', () => {
      const ctx = createMockCtx();
      const result = hitTestHandles(
        ctx,
        { x: 500, y: 500 },
        ['obj1'],
        getBounds,
        notLocked,
        null,
        [],
        defaultConfig,
      );
      expect(result).toBeNull();
    });

    it('hits the NW resize handle at object top-left corner', () => {
      const ctx = createMockCtx();
      // Point at exactly (100, 100) -- the NW handle center
      const result = hitTestHandles(
        ctx,
        { x: 100, y: 100 },
        ['obj1'],
        getBounds,
        notLocked,
        null,
        [],
        defaultConfig,
      );
      expect(result).not.toBeNull();
      // It could be rotation (tested first) or resize-nw
      // The rotation handle is at (200, 75), so (100, 100) shouldn't hit it
      expect(result!.objectId).toBe('obj1');
      expect(result!.region).toBe('resize-nw');
    });

    it('hits the SE resize handle at object bottom-right corner', () => {
      const ctx = createMockCtx();
      const result = hitTestHandles(
        ctx,
        { x: 300, y: 250 },
        ['obj1'],
        getBounds,
        notLocked,
        null,
        [],
        defaultConfig,
      );
      expect(result).not.toBeNull();
      expect(result!.objectId).toBe('obj1');
      expect(result!.region).toBe('resize-se');
    });

    it('hits the rotation handle above top-center', () => {
      const ctx = createMockCtx();
      // Rotation handle is at (200, 75) -- x+width/2, y-offset(25)
      const result = hitTestHandles(
        ctx,
        { x: 200, y: 75 },
        ['obj1'],
        getBounds,
        notLocked,
        null,
        [],
        defaultConfig,
      );
      expect(result).not.toBeNull();
      expect(result!.region).toBe('rotation');
      expect(result!.objectId).toBe('obj1');
    });

    it('returns null for a locked object', () => {
      const ctx = createMockCtx();
      const isLocked = () => true;
      const result = hitTestHandles(
        ctx,
        { x: 100, y: 100 },
        ['obj1'],
        getBounds,
        isLocked,
        null,
        [],
        defaultConfig,
      );
      // Locked objects have visibility 'none' -> no handles
      expect(result).toBeNull();
    });

    it('returns null when object bounds not found', () => {
      const ctx = createMockCtx();
      const result = hitTestHandles(
        ctx,
        { x: 100, y: 100 },
        ['missing-obj'],
        () => null,
        notLocked,
        null,
        [],
        defaultConfig,
      );
      expect(result).toBeNull();
    });
  });

  describe('multi-selection with group bounds', () => {
    const groupBounds = makeBounds(50, 50, 400, 300);

    it('hits handles on the group bounding box', () => {
      const ctx = createMockCtx();
      // NW corner of group at (50, 50)
      const result = hitTestHandles(
        ctx,
        { x: 50, y: 50 },
        ['obj1', 'obj2'],
        () => makeBounds(100, 100, 100, 100),
        () => false,
        groupBounds,
        [],
        defaultConfig,
      );
      expect(result).not.toBeNull();
      expect(result!.objectId).toBeNull(); // Group handle, no specific object
      expect(result!.region).toBe('resize-nw');
    });

    it('returns null when group has no bounds', () => {
      const ctx = createMockCtx();
      const result = hitTestHandles(
        ctx,
        { x: 50, y: 50 },
        ['obj1', 'obj2'],
        () => makeBounds(100, 100, 100, 100),
        () => false,
        null,
        [],
        defaultConfig,
      );
      // No group bounds = no group handles to test. Also no single-selection
      // handles (2 objects selected). Should return null unless custom handles hit.
      expect(result).toBeNull();
    });
  });

  describe('custom handles', () => {
    const customHandle: CustomHandle = {
      id: 'warp-1',
      region: 'warp-adjust',
      position: { x: 200, y: 175 },
      shape: 'diamond',
      fillColor: '#FFD700',
      strokeColor: '#CC9900',
      size: 8,
    };

    it('hits a custom diamond handle', () => {
      const ctx = createMockCtx();
      // The diamond extends from (200-12, 175) to (200+12, 175)
      // and (200, 175-12) to (200, 175+12) with expansion=4 -> size 12
      // Our mock tests closePath diamond as moveTo/lineTo shapes,
      // which won't match rect/arc tests. Let's use a custom hit test:
      const customCtx = createMockCtx((_path: any, _x: number, _y: number) => {
        // First call: custom handle -> true
        return true;
      });

      const result = hitTestHandles(
        customCtx,
        { x: 200, y: 175 },
        ['obj1'],
        () => makeBounds(100, 100, 200, 150),
        () => false,
        null,
        [customHandle],
        defaultConfig,
      );

      expect(result).not.toBeNull();
      expect(result!.region).toBe('warp-adjust');
      expect(result!.objectId).toBe('warp-1');
    });

    it('custom handles have higher priority than resize handles', () => {
      // Even if point would hit a resize handle, custom handle wins
      let callCount = 0;
      const ctx = createMockCtx((_path: any, _x: number, _y: number) => {
        callCount++;
        return true; // Everything hits
      });

      const result = hitTestHandles(
        ctx,
        { x: 200, y: 175 },
        ['obj1'],
        () => makeBounds(100, 100, 200, 150),
        () => false,
        null,
        [customHandle],
        defaultConfig,
      );

      // Custom handle should be tested and returned first
      expect(result!.region).toBe('warp-adjust');
      expect(callCount).toBe(1); // Only one call needed (custom handle hit)
    });
  });

  describe('hit area expansion', () => {
    it('hit area extends beyond visual handle size', () => {
      // handleSize = 12, expansion = 4 -> total hit area = 20x20
      // Handle center at (100, 100), hit area from (90, 90) to (110, 110)
      const bounds = makeBounds(100, 100, 200, 150);
      const ctx = createMockCtx();

      // Point at (92, 92) -- inside expanded area (90..110 on each axis)
      const result = hitTestHandles(
        ctx,
        { x: 92, y: 92 },
        ['obj1'],
        () => bounds,
        () => false,
        null,
        [],
        defaultConfig,
      );

      expect(result).not.toBeNull();
      expect(result!.region).toBe('resize-nw');
    });
  });

  describe('corners-only mode for small objects', () => {
    it('only tests corner handles for small objects', () => {
      // Object with min dimension 35 (< smallObjectThreshold 40)
      const smallBounds = makeBounds(100, 100, 35, 35);
      const testedRegions: string[] = [];

      const ctx = createMockCtx((path: any, _x: number, _y: number) => {
        // Track which paths are tested
        testedRegions.push('tested');
        return false;
      });

      hitTestHandles(
        ctx,
        { x: 999, y: 999 }, // Far away, won't hit anything
        ['obj1'],
        () => smallBounds,
        () => false,
        null,
        [],
        defaultConfig,
      );

      // corners-only: 4 corner handles + 1 rotation = 5 paths tested
      expect(testedRegions).toHaveLength(5);
    });

    it('tests no handles for tiny objects', () => {
      // Object with min dimension 15 (< tinyObjectThreshold 20)
      const tinyBounds = makeBounds(100, 100, 15, 15);
      const testedRegions: string[] = [];

      const ctx = createMockCtx((_path: any, _x: number, _y: number) => {
        testedRegions.push('tested');
        return false;
      });

      hitTestHandles(
        ctx,
        { x: 100, y: 100 },
        ['obj1'],
        () => tinyBounds,
        () => false,
        null,
        [],
        defaultConfig,
      );

      // none: no handles tested
      expect(testedRegions).toHaveLength(0);
    });
  });

  describe('rotation handling', () => {
    it('builds rotated paths for rotated objects', () => {
      // A rotated object should still produce handle paths
      const rotatedBounds = makeBounds(100, 100, 200, 150, 45);
      const ctx = createMockCtx((_path: any, _x: number, _y: number) => {
        // Accept the first test to verify paths are built
        return true;
      });

      const result = hitTestHandles(
        ctx,
        { x: 200, y: 75 },
        ['obj1'],
        () => rotatedBounds,
        () => false,
        null,
        [],
        defaultConfig,
      );

      // Should still get a result (rotation handle tested first)
      expect(result).not.toBeNull();
      expect(result!.region).toBe('rotation');
    });
  });

  describe('edge cases', () => {
    it('handles zero-size bounds', () => {
      const zeroBounds = makeBounds(100, 100, 0, 0);
      const ctx = createMockCtx();

      // Zero size is below tinyObjectThreshold (20), so no handles
      const result = hitTestHandles(
        ctx,
        { x: 100, y: 100 },
        ['obj1'],
        () => zeroBounds,
        () => false,
        null,
        [],
        defaultConfig,
      );

      expect(result).toBeNull();
    });

    it('handles negative coordinates', () => {
      const bounds = makeBounds(-100, -50, 200, 100);
      const ctx = createMockCtx();

      // NW handle at (-100, -50)
      const result = hitTestHandles(
        ctx,
        { x: -100, y: -50 },
        ['obj1'],
        () => bounds,
        () => false,
        null,
        [],
        defaultConfig,
      );

      expect(result).not.toBeNull();
    });

    it('with custom config values', () => {
      const customConfig: OverlayConfig = {
        ...defaultConfig,
        handleSize: 20,
        handleHitExpansion: 8,
        rotationHandleOffset: 40,
      };

      const bounds = makeBounds(100, 100, 200, 150);
      const ctx = createMockCtx();

      // Rotation handle at (200, 60) -- y=100-40=60
      const result = hitTestHandles(
        ctx,
        { x: 200, y: 60 },
        ['obj1'],
        () => bounds,
        () => false,
        null,
        [],
        customConfig,
      );

      expect(result).not.toBeNull();
      expect(result!.region).toBe('rotation');
    });
  });
});
