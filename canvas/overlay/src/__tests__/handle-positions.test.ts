/**
 * Handle Positions Tests
 *
 * Tests for resize and rotation handle position calculations.
 * Verifies correct positions at various object sizes, positions,
 * and validates corner-only mode for small objects.
 */

import {
  getCornerHandlePositions,
  getResizeHandlePositions,
  getRotationHandlePosition,
} from '../handle-positions';
import { getHandleVisibility } from '../types';
import type { ScreenBounds } from '../types';

// =============================================================================
// getResizeHandlePositions
// =============================================================================

describe('getResizeHandlePositions', () => {
  it('returns 8 positions for a simple bounds', () => {
    const bounds: ScreenBounds = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
    const positions = getResizeHandlePositions(bounds);

    expect(positions).toHaveLength(8);

    // Verify all 8 regions are present
    const regions = positions.map((p) => p.region);
    expect(regions).toEqual([
      'resize-nw',
      'resize-n',
      'resize-ne',
      'resize-e',
      'resize-se',
      'resize-s',
      'resize-sw',
      'resize-w',
    ]);
  });

  it('computes correct positions for corners', () => {
    const bounds: ScreenBounds = { x: 50, y: 50, width: 100, height: 80, rotation: 0 };
    const positions = getResizeHandlePositions(bounds);

    const nw = positions.find((p) => p.region === 'resize-nw')!;
    expect(nw.x).toBe(50);
    expect(nw.y).toBe(50);

    const ne = positions.find((p) => p.region === 'resize-ne')!;
    expect(ne.x).toBe(150); // 50 + 100
    expect(ne.y).toBe(50);

    const se = positions.find((p) => p.region === 'resize-se')!;
    expect(se.x).toBe(150);
    expect(se.y).toBe(130); // 50 + 80

    const sw = positions.find((p) => p.region === 'resize-sw')!;
    expect(sw.x).toBe(50);
    expect(sw.y).toBe(130);
  });

  it('computes correct positions for edge midpoints', () => {
    const bounds: ScreenBounds = { x: 0, y: 0, width: 200, height: 100, rotation: 0 };
    const positions = getResizeHandlePositions(bounds);

    const n = positions.find((p) => p.region === 'resize-n')!;
    expect(n.x).toBe(100); // width / 2
    expect(n.y).toBe(0);

    const e = positions.find((p) => p.region === 'resize-e')!;
    expect(e.x).toBe(200); // width
    expect(e.y).toBe(50); // height / 2

    const s = positions.find((p) => p.region === 'resize-s')!;
    expect(s.x).toBe(100);
    expect(s.y).toBe(100);

    const w = positions.find((p) => p.region === 'resize-w')!;
    expect(w.x).toBe(0);
    expect(w.y).toBe(50);
  });

  it('handles bounds at origin (0, 0)', () => {
    const bounds: ScreenBounds = { x: 0, y: 0, width: 50, height: 50, rotation: 0 };
    const positions = getResizeHandlePositions(bounds);

    const nw = positions.find((p) => p.region === 'resize-nw')!;
    expect(nw.x).toBe(0);
    expect(nw.y).toBe(0);

    const se = positions.find((p) => p.region === 'resize-se')!;
    expect(se.x).toBe(50);
    expect(se.y).toBe(50);
  });

  it('handles large bounds (simulates high zoom)', () => {
    const bounds: ScreenBounds = { x: 500, y: 300, width: 2000, height: 1500, rotation: 0 };
    const positions = getResizeHandlePositions(bounds);

    const se = positions.find((p) => p.region === 'resize-se')!;
    expect(se.x).toBe(2500);
    expect(se.y).toBe(1800);
  });

  it('handles very small bounds (tiny object)', () => {
    const bounds: ScreenBounds = { x: 100, y: 100, width: 5, height: 5, rotation: 0 };
    const positions = getResizeHandlePositions(bounds);

    // Should still return all 8 positions
    expect(positions).toHaveLength(8);

    const n = positions.find((p) => p.region === 'resize-n')!;
    expect(n.x).toBe(102.5);
    expect(n.y).toBe(100);
  });

  it('does not apply rotation to positions (rotation is handled by rendering)', () => {
    const boundsNoRotation: ScreenBounds = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
    const boundsWithRotation: ScreenBounds = {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      rotation: 45,
    };

    const noRot = getResizeHandlePositions(boundsNoRotation);
    const withRot = getResizeHandlePositions(boundsWithRotation);

    // Positions should be identical regardless of rotation
    for (let i = 0; i < 8; i++) {
      expect(withRot[i].x).toBe(noRot[i].x);
      expect(withRot[i].y).toBe(noRot[i].y);
      expect(withRot[i].region).toBe(noRot[i].region);
    }
  });
});

// =============================================================================
// getRotationHandlePosition
// =============================================================================

describe('getRotationHandlePosition', () => {
  it('returns position above top-center', () => {
    const bounds: ScreenBounds = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
    const pos = getRotationHandlePosition(bounds, 25);

    expect(pos.x).toBe(200); // x + width/2
    expect(pos.y).toBe(75); // y - offset
    expect(pos.region).toBe('rotation');
  });

  it('respects different offsets', () => {
    const bounds: ScreenBounds = { x: 50, y: 50, width: 100, height: 80, rotation: 0 };

    const pos10 = getRotationHandlePosition(bounds, 10);
    expect(pos10.y).toBe(40); // 50 - 10

    const pos50 = getRotationHandlePosition(bounds, 50);
    expect(pos50.y).toBe(0); // 50 - 50
  });

  it('can produce negative y coordinates', () => {
    const bounds: ScreenBounds = { x: 10, y: 10, width: 40, height: 40, rotation: 0 };
    const pos = getRotationHandlePosition(bounds, 25);

    expect(pos.y).toBe(-15); // 10 - 25
  });

  it('does not apply rotation to the position', () => {
    const bounds: ScreenBounds = { x: 100, y: 100, width: 200, height: 100, rotation: 90 };
    const pos = getRotationHandlePosition(bounds, 25);

    // Position is computed in unrotated space
    expect(pos.x).toBe(200);
    expect(pos.y).toBe(75);
  });
});

// =============================================================================
// getCornerHandlePositions
// =============================================================================

describe('getCornerHandlePositions', () => {
  it('returns exactly 4 corner positions', () => {
    const bounds: ScreenBounds = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
    const positions = getCornerHandlePositions(bounds);

    expect(positions).toHaveLength(4);
    const regions = positions.map((p) => p.region);
    expect(regions).toEqual(['resize-nw', 'resize-ne', 'resize-se', 'resize-sw']);
  });

  it('computes correct corner coordinates', () => {
    const bounds: ScreenBounds = { x: 20, y: 30, width: 60, height: 40, rotation: 0 };
    const positions = getCornerHandlePositions(bounds);

    const nw = positions.find((p) => p.region === 'resize-nw')!;
    expect(nw.x).toBe(20);
    expect(nw.y).toBe(30);

    const ne = positions.find((p) => p.region === 'resize-ne')!;
    expect(ne.x).toBe(80);
    expect(ne.y).toBe(30);

    const se = positions.find((p) => p.region === 'resize-se')!;
    expect(se.x).toBe(80);
    expect(se.y).toBe(70);

    const sw = positions.find((p) => p.region === 'resize-sw')!;
    expect(sw.x).toBe(20);
    expect(sw.y).toBe(70);
  });

  it('does not include edge midpoint handles', () => {
    const bounds: ScreenBounds = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
    const positions = getCornerHandlePositions(bounds);
    const regions = positions.map((p) => p.region);

    expect(regions).not.toContain('resize-n');
    expect(regions).not.toContain('resize-e');
    expect(regions).not.toContain('resize-s');
    expect(regions).not.toContain('resize-w');
  });
});

// =============================================================================
// Integration: Handle Visibility Thresholds
// =============================================================================

describe('handle visibility integration', () => {
  const config = { smallObjectThreshold: 40, tinyObjectThreshold: 20 };

  it('returns "all" for normal-sized objects', () => {
    expect(getHandleVisibility({ width: 200, height: 100 }, false, config)).toBe('all');
  });

  it('returns "corners-only" when min dimension is below smallObjectThreshold', () => {
    expect(getHandleVisibility({ width: 200, height: 35 }, false, config)).toBe('corners-only');
  });

  it('returns "none" when min dimension is below tinyObjectThreshold', () => {
    expect(getHandleVisibility({ width: 200, height: 15 }, false, config)).toBe('none');
  });

  it('returns "none" for locked objects regardless of size', () => {
    expect(getHandleVisibility({ width: 200, height: 100 }, true, config)).toBe('none');
  });

  it('correctly differentiates at boundary values', () => {
    // Exactly at threshold: minDim = 40 is NOT < 40, so should be 'all'
    expect(getHandleVisibility({ width: 40, height: 100 }, false, config)).toBe('all');

    // Just below threshold: minDim = 39 IS < 40, so should be 'corners-only'
    expect(getHandleVisibility({ width: 39, height: 100 }, false, config)).toBe('corners-only');

    // Exactly at tiny threshold: minDim = 20 is NOT < 20, so should be 'corners-only'
    expect(getHandleVisibility({ width: 20, height: 100 }, false, config)).toBe('corners-only');

    // Just below tiny threshold: minDim = 19 IS < 20, so should be 'none'
    expect(getHandleVisibility({ width: 19, height: 100 }, false, config)).toBe('none');
  });
});
