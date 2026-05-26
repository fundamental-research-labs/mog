/**
 * Ink Data Model Tests
 *
 * Tests for the ink/drawing engine types, schemas, and utilities.
 */

// Types from ink module (contracts)
import type { InkBoundingBox, InkPoint, InkStroke } from '@mog-sdk/contracts/ink';
// Runtime utilities from spreadsheet-utils
import {
  deserializeStroke,
  generateStrokeId,
  isStrokeId,
  serializeStroke,
} from '@mog/spreadsheet-utils/ink/types';
import {
  EMPTY_BOUNDING_BOX,
  boundsContains,
  boundsIntersect,
  computePointsBounds,
  computeStrokeBounds,
  expandBounds,
  getBoundsArea,
  getBoundsCenter,
  getBoundsHeight,
  getBoundsWidth,
  intersectBounds,
  isValidBounds,
  pointHitsStroke,
  pointIntersectsBounds,
  pointToSegmentDistanceSquared,
  pointToStrokeDistance,
  unionBounds,
} from '@mog/spreadsheet-utils/ink/types';

// Use InkBoundingBox as BoundingBox alias for test readability
type BoundingBox = InkBoundingBox;

describe('Ink Types', () => {
  // ===========================================================================
  // StrokeId Generation and Validation
  // ===========================================================================

  describe('StrokeId', () => {
    it('should generate unique StrokeIds', () => {
      const id1 = generateStrokeId();
      const id2 = generateStrokeId();
      expect(id1).not.toBe(id2);
    });

    it('should generate valid UUID v7 format', () => {
      const id = generateStrokeId();
      // UUID format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should validate StrokeId format', () => {
      const validId = generateStrokeId();
      expect(isStrokeId(validId)).toBe(true);

      expect(isStrokeId('not-a-valid-uuid')).toBe(false);
      expect(isStrokeId('')).toBe(false);
      expect(isStrokeId(123)).toBe(false);
      expect(isStrokeId(null)).toBe(false);
      expect(isStrokeId(undefined)).toBe(false);
    });
  });

  // ===========================================================================
  // Stroke Serialization
  // ===========================================================================

  describe('Stroke Serialization', () => {
    const createTestStroke = (): InkStroke => ({
      id: generateStrokeId(),
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10, pressure: 0.5 },
        { x: 20, y: 20, pressure: 0.8, tilt: 0.2 },
        { x: 30, y: 30, pressure: 0.6, tilt: 0.1, timestamp: 100 },
      ],
      tool: 'pen',
      color: '#000000',
      width: 2,
      opacity: 1.0,
      createdBy: 'test-user',
      createdAt: Date.now(),
    });

    it('should serialize stroke with all point variations', () => {
      const stroke = createTestStroke();
      const serialized = serializeStroke(stroke);

      expect(serialized.id).toBe(stroke.id);
      expect(serialized.tool).toBe(stroke.tool);
      expect(serialized.color).toBe(stroke.color);
      expect(serialized.width).toBe(stroke.width);
      expect(serialized.opacity).toBe(stroke.opacity);
      expect(serialized.createdBy).toBe(stroke.createdBy);
      expect(serialized.createdAt).toBe(stroke.createdAt);

      // Check points array format
      expect(serialized.points).toHaveLength(4);
      expect(serialized.points[0]).toEqual([0, 0]);
      expect(serialized.points[1]).toEqual([10, 10, 0.5]);
      expect(serialized.points[2]).toEqual([20, 20, 0.8, 0.2]);
      expect(serialized.points[3]).toEqual([30, 30, 0.6, 0.1, 100]);
    });

    it('should deserialize stroke correctly', () => {
      const original = createTestStroke();
      const serialized = serializeStroke(original);
      const deserialized = deserializeStroke(serialized);

      expect(deserialized.id).toBe(original.id);
      expect(deserialized.tool).toBe(original.tool);
      expect(deserialized.color).toBe(original.color);
      expect(deserialized.width).toBe(original.width);
      expect(deserialized.opacity).toBe(original.opacity);
      expect(deserialized.createdBy).toBe(original.createdBy);
      expect(deserialized.createdAt).toBe(original.createdAt);

      // Check points
      expect(deserialized.points).toHaveLength(4);
      expect(deserialized.points[0]).toEqual({ x: 0, y: 0 });
      expect(deserialized.points[1]).toEqual({ x: 10, y: 10, pressure: 0.5 });
      expect(deserialized.points[2]).toEqual({ x: 20, y: 20, pressure: 0.8, tilt: 0.2 });
      expect(deserialized.points[3]).toEqual({
        x: 30,
        y: 30,
        pressure: 0.6,
        tilt: 0.1,
        timestamp: 100,
      });
    });

    it('should roundtrip serialize/deserialize correctly', () => {
      const original = createTestStroke();
      const roundtrip = deserializeStroke(serializeStroke(original));

      // Compare all fields
      expect(roundtrip.id).toBe(original.id);
      expect(roundtrip.tool).toBe(original.tool);
      expect(roundtrip.color).toBe(original.color);
      expect(roundtrip.width).toBe(original.width);
      expect(roundtrip.opacity).toBe(original.opacity);
      expect(roundtrip.createdBy).toBe(original.createdBy);
      expect(roundtrip.createdAt).toBe(original.createdAt);
      expect(roundtrip.points).toHaveLength(original.points.length);
    });
  });
});

// =============================================================================
// Spatial Index Utilities
// =============================================================================

describe('Spatial Index Utilities', () => {
  describe('BoundingBox', () => {
    it('should have correct EMPTY_BOUNDING_BOX', () => {
      expect(EMPTY_BOUNDING_BOX.minX).toBe(Infinity);
      expect(EMPTY_BOUNDING_BOX.minY).toBe(Infinity);
      expect(EMPTY_BOUNDING_BOX.maxX).toBe(-Infinity);
      expect(EMPTY_BOUNDING_BOX.maxY).toBe(-Infinity);
    });

    it('should validate empty bounds as invalid', () => {
      expect(isValidBounds(EMPTY_BOUNDING_BOX)).toBe(false);
    });

    it('should validate valid bounds', () => {
      const bounds: BoundingBox = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      expect(isValidBounds(bounds)).toBe(true);
    });

    it('should validate inverted bounds as invalid', () => {
      const bounds: BoundingBox = { minX: 100, minY: 100, maxX: 0, maxY: 0 };
      expect(isValidBounds(bounds)).toBe(false);
    });
  });

  describe('computeStrokeBounds', () => {
    it('should compute bounds for a stroke', () => {
      const stroke: InkStroke = {
        id: generateStrokeId(),
        points: [
          { x: 10, y: 20 },
          { x: 50, y: 40 },
          { x: 30, y: 60 },
        ],
        tool: 'pen',
        color: '#000000',
        width: 4,
        opacity: 1.0,
        createdBy: 'test',
        createdAt: Date.now(),
      };

      const bounds = computeStrokeBounds(stroke);

      // Should expand by half stroke width (4/2 = 2)
      expect(bounds.minX).toBe(10 - 2); // 8
      expect(bounds.minY).toBe(20 - 2); // 18
      expect(bounds.maxX).toBe(50 + 2); // 52
      expect(bounds.maxY).toBe(60 + 2); // 62
    });

    it('should handle empty stroke', () => {
      const stroke: InkStroke = {
        id: generateStrokeId(),
        points: [],
        tool: 'pen',
        color: '#000000',
        width: 2,
        opacity: 1.0,
        createdBy: 'test',
        createdAt: Date.now(),
      };

      const bounds = computeStrokeBounds(stroke);
      expect(isValidBounds(bounds)).toBe(false);
    });
  });

  describe('computePointsBounds', () => {
    it('should compute bounds for points', () => {
      const points: InkPoint[] = [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
        { x: 50, y: 100 },
      ];

      const bounds = computePointsBounds(points);

      expect(bounds.minX).toBe(0);
      expect(bounds.minY).toBe(0);
      expect(bounds.maxX).toBe(100);
      expect(bounds.maxY).toBe(100);
    });
  });

  describe('pointIntersectsBounds', () => {
    const bounds: BoundingBox = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

    it('should detect point inside bounds', () => {
      expect(pointIntersectsBounds(50, 50, bounds)).toBe(true);
    });

    it('should detect point on edge', () => {
      expect(pointIntersectsBounds(0, 0, bounds)).toBe(true);
      expect(pointIntersectsBounds(100, 100, bounds)).toBe(true);
    });

    it('should detect point outside bounds', () => {
      expect(pointIntersectsBounds(-1, 50, bounds)).toBe(false);
      expect(pointIntersectsBounds(101, 50, bounds)).toBe(false);
      expect(pointIntersectsBounds(50, -1, bounds)).toBe(false);
      expect(pointIntersectsBounds(50, 101, bounds)).toBe(false);
    });
  });

  describe('boundsIntersect', () => {
    it('should detect overlapping bounds', () => {
      const a: BoundingBox = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      const b: BoundingBox = { minX: 50, minY: 50, maxX: 150, maxY: 150 };
      expect(boundsIntersect(a, b)).toBe(true);
    });

    it('should detect touching bounds', () => {
      const a: BoundingBox = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      const b: BoundingBox = { minX: 100, minY: 0, maxX: 200, maxY: 100 };
      expect(boundsIntersect(a, b)).toBe(true);
    });

    it('should detect non-intersecting bounds', () => {
      const a: BoundingBox = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      const b: BoundingBox = { minX: 200, minY: 200, maxX: 300, maxY: 300 };
      expect(boundsIntersect(a, b)).toBe(false);
    });
  });

  describe('boundsContains', () => {
    it('should detect contained bounds', () => {
      const outer: BoundingBox = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      const inner: BoundingBox = { minX: 25, minY: 25, maxX: 75, maxY: 75 };
      expect(boundsContains(outer, inner)).toBe(true);
    });

    it('should detect non-contained bounds', () => {
      const a: BoundingBox = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      const b: BoundingBox = { minX: 50, minY: 50, maxX: 150, maxY: 150 };
      expect(boundsContains(a, b)).toBe(false);
    });
  });

  describe('unionBounds', () => {
    it('should compute union of bounds', () => {
      const a: BoundingBox = { minX: 0, minY: 0, maxX: 50, maxY: 50 };
      const b: BoundingBox = { minX: 50, minY: 50, maxX: 100, maxY: 100 };

      const union = unionBounds(a, b);

      expect(union.minX).toBe(0);
      expect(union.minY).toBe(0);
      expect(union.maxX).toBe(100);
      expect(union.maxY).toBe(100);
    });
  });

  describe('intersectBounds', () => {
    it('should compute intersection of overlapping bounds', () => {
      const a: BoundingBox = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      const b: BoundingBox = { minX: 50, minY: 50, maxX: 150, maxY: 150 };

      const intersection = intersectBounds(a, b);

      expect(intersection).not.toBeNull();
      expect(intersection!.minX).toBe(50);
      expect(intersection!.minY).toBe(50);
      expect(intersection!.maxX).toBe(100);
      expect(intersection!.maxY).toBe(100);
    });

    it('should return null for non-intersecting bounds', () => {
      const a: BoundingBox = { minX: 0, minY: 0, maxX: 50, maxY: 50 };
      const b: BoundingBox = { minX: 100, minY: 100, maxX: 150, maxY: 150 };

      const intersection = intersectBounds(a, b);
      expect(intersection).toBeNull();
    });
  });

  describe('expandBounds', () => {
    it('should expand bounds by margin', () => {
      const bounds: BoundingBox = { minX: 10, minY: 10, maxX: 90, maxY: 90 };
      const expanded = expandBounds(bounds, 5);

      expect(expanded.minX).toBe(5);
      expect(expanded.minY).toBe(5);
      expect(expanded.maxX).toBe(95);
      expect(expanded.maxY).toBe(95);
    });
  });

  describe('getBoundsWidth/Height/Center/Area', () => {
    const bounds: BoundingBox = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

    it('should get width', () => {
      expect(getBoundsWidth(bounds)).toBe(100);
    });

    it('should get height', () => {
      expect(getBoundsHeight(bounds)).toBe(50);
    });

    it('should get center', () => {
      const center = getBoundsCenter(bounds);
      expect(center.x).toBe(50);
      expect(center.y).toBe(25);
    });

    it('should get area', () => {
      expect(getBoundsArea(bounds)).toBe(5000);
    });
  });

  describe('pointToSegmentDistanceSquared', () => {
    it('should compute distance to segment endpoint', () => {
      // Point directly above start of horizontal segment
      const dist = Math.sqrt(pointToSegmentDistanceSquared(0, 10, 0, 0, 100, 0));
      expect(dist).toBe(10);
    });

    it('should compute perpendicular distance to segment', () => {
      // Point above middle of horizontal segment
      const dist = Math.sqrt(pointToSegmentDistanceSquared(50, 10, 0, 0, 100, 0));
      expect(dist).toBeCloseTo(10);
    });

    it('should compute distance to segment as point', () => {
      // Segment is a point
      const dist = Math.sqrt(pointToSegmentDistanceSquared(3, 4, 0, 0, 0, 0));
      expect(dist).toBe(5); // 3-4-5 triangle
    });
  });

  describe('pointToStrokeDistance', () => {
    it('should compute distance to stroke', () => {
      const stroke: InkStroke = {
        id: generateStrokeId(),
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        tool: 'pen',
        color: '#000000',
        width: 2,
        opacity: 1.0,
        createdBy: 'test',
        createdAt: Date.now(),
      };

      // Point 10 pixels above the horizontal stroke
      const dist = pointToStrokeDistance(50, 10, stroke);
      expect(dist).toBeCloseTo(10);
    });

    it('should handle single point stroke', () => {
      const stroke: InkStroke = {
        id: generateStrokeId(),
        points: [{ x: 0, y: 0 }],
        tool: 'pen',
        color: '#000000',
        width: 2,
        opacity: 1.0,
        createdBy: 'test',
        createdAt: Date.now(),
      };

      const dist = pointToStrokeDistance(3, 4, stroke);
      expect(dist).toBe(5); // 3-4-5 triangle
    });

    it('should return Infinity for empty stroke', () => {
      const stroke: InkStroke = {
        id: generateStrokeId(),
        points: [],
        tool: 'pen',
        color: '#000000',
        width: 2,
        opacity: 1.0,
        createdBy: 'test',
        createdAt: Date.now(),
      };

      const dist = pointToStrokeDistance(0, 0, stroke);
      expect(dist).toBe(Infinity);
    });
  });

  describe('pointHitsStroke', () => {
    it('should detect hit within stroke width', () => {
      const stroke: InkStroke = {
        id: generateStrokeId(),
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        tool: 'pen',
        color: '#000000',
        width: 10,
        opacity: 1.0,
        createdBy: 'test',
        createdAt: Date.now(),
      };

      // Point within stroke width (5 pixels from line, width is 10)
      expect(pointHitsStroke(50, 4, stroke)).toBe(true);
    });

    it('should not detect hit outside stroke width', () => {
      const stroke: InkStroke = {
        id: generateStrokeId(),
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        tool: 'pen',
        color: '#000000',
        width: 4,
        opacity: 1.0,
        createdBy: 'test',
        createdAt: Date.now(),
      };

      // Point outside stroke width + tolerance (2 + 2 = 4, point is 10 away)
      expect(pointHitsStroke(50, 10, stroke)).toBe(false);
    });

    it('should use custom tolerance', () => {
      const stroke: InkStroke = {
        id: generateStrokeId(),
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        tool: 'pen',
        color: '#000000',
        width: 2,
        opacity: 1.0,
        createdBy: 'test',
        createdAt: Date.now(),
      };

      // Width/2 = 1, tolerance = 10, total = 11
      // Point at 10 should hit
      expect(pointHitsStroke(50, 10, stroke, 10)).toBe(true);

      // Point at 15 should not hit
      expect(pointHitsStroke(50, 15, stroke, 10)).toBe(false);
    });
  });
});
