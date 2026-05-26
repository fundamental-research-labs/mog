/**
 * Tests for shape validation diagnostics.
 */
import { validateShape } from '../../src/diagnostics/validators';

describe('validateShape', () => {
  describe('valid shapes', () => {
    it('should validate a simple rectangle', () => {
      const result = validateShape({ shapeType: 'rect' });
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.geometry).toBeDefined();
    });

    it('should validate rectangle with explicit dimensions', () => {
      const result = validateShape({ shapeType: 'rect', width: 200, height: 100 });
      expect(result.valid).toBe(true);
      expect(result.geometry!.boundingBox.width).toBeCloseTo(200);
      expect(result.geometry!.boundingBox.height).toBeCloseTo(100);
    });

    it('should validate oval', () => {
      const result = validateShape({ shapeType: 'ellipse' });
      expect(result.valid).toBe(true);
      expect(result.geometry!.pointCount).toBeGreaterThan(0);
    });

    it('should validate with adjustments', () => {
      const result = validateShape({
        shapeType: 'roundRect',
        adjustments: [{ name: 'cornerRadius', value: 0.2, min: 0, max: 0.5 }],
      });
      expect(result.valid).toBe(true);
    });

    it('should have path length greater than zero', () => {
      const result = validateShape({ shapeType: 'rect' });
      expect(result.geometry!.pathLength).toBeGreaterThan(0);
    });

    it('should have non-zero point count', () => {
      const result = validateShape({ shapeType: 'star5' });
      expect(result.geometry!.pointCount).toBeGreaterThan(0);
    });
  });

  describe('unknown shape type', () => {
    it('should report SHAPE_PRESET_UNKNOWN error', () => {
      const result = validateShape({ shapeType: 'nonExistent' });
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].code).toBe('SHAPE_PRESET_UNKNOWN');
      expect(result.issues[0].severity).toBe('error');
    });

    it('should not include geometry for unknown shape', () => {
      const result = validateShape({ shapeType: 'nonExistent' });
      expect(result.geometry).toBeUndefined();
    });
  });

  describe('invalid dimensions', () => {
    it('should report error for zero width', () => {
      const result = validateShape({ shapeType: 'rect', width: 0, height: 100 });
      const dimIssue = result.issues.find((i) => i.code === 'SHAPE_DIMENSIONS_INVALID');
      expect(dimIssue).toBeDefined();
      expect(dimIssue!.severity).toBe('error');
    });

    it('should report error for negative dimensions', () => {
      const result = validateShape({ shapeType: 'rect', width: -10, height: 100 });
      const dimIssue = result.issues.find((i) => i.code === 'SHAPE_DIMENSIONS_INVALID');
      expect(dimIssue).toBeDefined();
    });
  });

  describe('adjustment validation', () => {
    it('should warn for value below min', () => {
      const result = validateShape({
        shapeType: 'roundRect',
        adjustments: [{ name: 'cornerRadius', value: -0.1, min: 0, max: 0.5 }],
      });
      const oobIssue = result.issues.find((i) => i.code === 'SHAPE_ADJUSTMENT_OOB');
      expect(oobIssue).toBeDefined();
      expect(oobIssue!.severity).toBe('warning');
    });

    it('should warn for value above max', () => {
      const result = validateShape({
        shapeType: 'roundRect',
        adjustments: [{ name: 'cornerRadius', value: 0.8, min: 0, max: 0.5 }],
      });
      const oobIssue = result.issues.find((i) => i.code === 'SHAPE_ADJUSTMENT_OOB');
      expect(oobIssue).toBeDefined();
    });

    it('should error for NaN value', () => {
      const result = validateShape({
        shapeType: 'roundRect',
        adjustments: [{ name: 'cornerRadius', value: NaN }],
      });
      const nanIssue = result.issues.find((i) => i.code === 'SHAPE_ADJUSTMENT_NAN');
      expect(nanIssue).toBeDefined();
      expect(nanIssue!.severity).toBe('error');
    });

    it('should not report issues for adjustments without min/max', () => {
      const result = validateShape({
        shapeType: 'roundRect',
        adjustments: [{ name: 'cornerRadius', value: 10 }],
      });
      const oobIssue = result.issues.find((i) => i.code === 'SHAPE_ADJUSTMENT_OOB');
      expect(oobIssue).toBeUndefined();
    });
  });

  describe('default dimensions', () => {
    it('should use 100x100 default dimensions', () => {
      const result = validateShape({ shapeType: 'rect' });
      expect(result.valid).toBe(true);
      expect(result.geometry!.boundingBox.width).toBeCloseTo(100);
      expect(result.geometry!.boundingBox.height).toBeCloseTo(100);
    });
  });

  describe('multiple issues', () => {
    it('should accumulate multiple issues', () => {
      const result = validateShape({
        shapeType: 'roundRect',
        width: 0,
        height: 100,
        adjustments: [{ name: 'cornerRadius', value: 0.8, min: 0, max: 0.5 }],
      });
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    });
  });
});
