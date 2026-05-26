/**
 * Tests for the shape-to-path main API.
 */
import { PathOps } from '@mog/geometry';
import { getScalingMode } from '../src/presets/registry';
import {
  generateShapePath,
  getDefaultAdjustments,
  getRegisteredShapeTypes,
  isValidShapeType,
} from '../src/shape-to-path';

describe('generateShapePath', () => {
  it('should generate a valid path for rectangle', () => {
    const path = generateShapePath('rect', 100, 50);
    expect(path.segments.length).toBeGreaterThan(0);
    expect(path.closed).toBe(true);
  });

  it('should handle zero width gracefully', () => {
    const path = generateShapePath('rect', 0, 50);
    expect(path.segments.length).toBeGreaterThan(0);
  });

  it('should handle zero height gracefully', () => {
    const path = generateShapePath('rect', 50, 0);
    expect(path.segments.length).toBeGreaterThan(0);
  });

  it('should handle negative dimensions by clamping to 0', () => {
    const path = generateShapePath('rect', -10, -10);
    expect(path.segments.length).toBeGreaterThan(0);
  });

  it('should throw for unknown shape type', () => {
    expect(() => generateShapePath('unknownShape', 100, 100)).toThrow(/Unknown shape type/);
  });

  it('should pass adjustments through to generator', () => {
    const path1 = generateShapePath('roundRect', 100, 100, [{ name: 'adj', value: 5000 }]);
    const path2 = generateShapePath('roundRect', 100, 100, [{ name: 'adj', value: 40000 }]);
    // Different adjustments = different paths
    expect(JSON.stringify(path1)).not.toBe(JSON.stringify(path2));
  });

  it('should default to empty adjustments when none provided', () => {
    const withAdj = generateShapePath('rect', 100, 100, []);
    const withoutAdj = generateShapePath('rect', 100, 100);
    expect(JSON.stringify(withAdj)).toBe(JSON.stringify(withoutAdj));
  });
});

describe('getDefaultAdjustments', () => {
  it('should return adjustments for roundedRectangle', () => {
    const adj = getDefaultAdjustments('roundRect');
    expect(adj.length).toBeGreaterThan(0);
    expect(adj[0].name).toBe('adj');
  });

  it('should return empty array for shapes with no adjustments', () => {
    const adj = getDefaultAdjustments('rect');
    expect(adj).toEqual([]);
  });

  it('should return empty array for unknown shapes', () => {
    const adj = getDefaultAdjustments('unknownShape');
    expect(adj).toEqual([]);
  });
});

describe('isValidShapeType', () => {
  it('should return true for registered shapes', () => {
    expect(isValidShapeType('rect')).toBe(true);
    expect(isValidShapeType('ellipse')).toBe(true);
    expect(isValidShapeType('star5')).toBe(true);
  });

  it('should return false for unregistered shapes', () => {
    expect(isValidShapeType('nonExistent')).toBe(false);
    expect(isValidShapeType('')).toBe(false);
  });
});

describe('getRegisteredShapeTypes', () => {
  it('should return a non-empty array', () => {
    const types = getRegisteredShapeTypes();
    expect(types.length).toBeGreaterThan(0);
  });

  it('should include basic shapes', () => {
    const types = getRegisteredShapeTypes();
    expect(types).toContain('rect');
    expect(types).toContain('ellipse');
    expect(types).toContain('triangle');
  });

  it('should include flowchart shapes', () => {
    const types = getRegisteredShapeTypes();
    expect(types).toContain('flowChartProcess');
    expect(types).toContain('flowChartDecision');
  });

  it('should include star shapes', () => {
    const types = getRegisteredShapeTypes();
    expect(types).toContain('star5');
    expect(types).toContain('star8');
  });

  it('should include math shapes', () => {
    const types = getRegisteredShapeTypes();
    expect(types).toContain('mathPlus');
    expect(types).toContain('mathDivide');
  });
});

// =============================================================================
// Scaling Mode
// =============================================================================

describe('scaling mode: uniform', () => {
  it('should register star shapes as uniform', () => {
    expect(getScalingMode('star5')).toBe('uniform');
    expect(getScalingMode('star8')).toBe('uniform');
    expect(getScalingMode('star32')).toBe('uniform');
  });

  it('should register smileyFace as uniform', () => {
    expect(getScalingMode('smileyFace')).toBe('uniform');
  });

  it('should register flowchart circles as uniform', () => {
    expect(getScalingMode('flowChartConnector')).toBe('uniform');
    expect(getScalingMode('flowChartSummingJunction')).toBe('uniform');
    expect(getScalingMode('flowChartOr')).toBe('uniform');
  });

  it('should default to fill for unregistered shapes', () => {
    expect(getScalingMode('rect')).toBe('fill');
    expect(getScalingMode('ellipse')).toBe('fill');
    expect(getScalingMode('cloud')).toBe('fill');
  });

  it('should center a uniform shape in a wide bounding box', () => {
    const path = generateShapePath('star5', 200, 100);
    const bbox = PathOps.pathBoundingBox(path);
    // s = 100, tx = 50. Shape should be centered: bbox midpoint at x ≈ 100
    const midX = bbox.x + bbox.width / 2;
    expect(midX).toBeCloseTo(100, 0);
    // Width of the path should be ≈ 100 (the square size), not 200
    expect(bbox.width).toBeLessThanOrEqual(101);
  });

  it('should center a uniform shape in a tall bounding box', () => {
    const path = generateShapePath('star5', 100, 300);
    const bbox = PathOps.pathBoundingBox(path);
    // s = 100, ty = 100. Shape should be centered: bbox midpoint at y ≈ 150
    const midY = bbox.y + bbox.height / 2;
    expect(midY).toBeCloseTo(150, 0);
    expect(bbox.height).toBeLessThanOrEqual(101);
  });

  it('should not transform fill-mode shapes', () => {
    const path = generateShapePath('rect', 200, 100);
    const bbox = PathOps.pathBoundingBox(path);
    // Rectangle should fill the full 200x100 box
    expect(bbox.width).toBeCloseTo(200, 0);
    expect(bbox.height).toBeCloseTo(100, 0);
  });

  it('should produce identical paths for uniform shapes at square dimensions', () => {
    const path = generateShapePath('star5', 100, 100);
    const bbox = PathOps.pathBoundingBox(path);
    // At square dimensions, uniform mode is a no-op — no translation
    expect(bbox.x).toBeCloseTo(0, 0);
    expect(bbox.y).toBeCloseTo(0, 0);
  });
});
