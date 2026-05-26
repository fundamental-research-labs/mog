/**
 * Tests exercising all validator error paths:
 * SHAPE_PATH_EMPTY, SHAPE_PATH_NAN, SHAPE_GENERATION_ERROR
 */
import { validateShape } from '../../src/diagnostics/validators';
import { registerPreset } from '../../src/presets/registry';

describe('Validator Error Paths', () => {
  describe('SHAPE_PATH_EMPTY', () => {
    it('should report SHAPE_PATH_EMPTY when path has no segments', () => {
      // Register a temporary shape that returns an empty path
      registerPreset('__test_empty_path', () => {
        return { segments: [], closed: false };
      });

      const result = validateShape({ shapeType: '__test_empty_path', width: 100, height: 100 });
      const emptyIssue = result.issues.find((i) => i.code === 'SHAPE_PATH_EMPTY');
      expect(emptyIssue).toBeDefined();
      expect(emptyIssue!.severity).toBe('error');
      expect(emptyIssue!.message).toContain('no segments');
    });
  });

  describe('SHAPE_PATH_NAN', () => {
    it('should report SHAPE_PATH_NAN when path contains NaN coordinates', () => {
      // Register a shape that returns a path with NaN
      registerPreset('__test_nan_path', () => {
        return {
          segments: [
            { type: 'M' as const, x: NaN, y: 0 },
            { type: 'L' as const, x: 100, y: 100 },
            { type: 'Z' as const },
          ],
          closed: true,
        };
      });

      const result = validateShape({ shapeType: '__test_nan_path', width: 100, height: 100 });
      const nanIssue = result.issues.find((i) => i.code === 'SHAPE_PATH_NAN');
      expect(nanIssue).toBeDefined();
      expect(nanIssue!.severity).toBe('error');
      expect(nanIssue!.message).toContain('NaN');
    });

    it('should report SHAPE_PATH_NAN for NaN in cubic bezier control points', () => {
      registerPreset('__test_nan_cubic', () => {
        return {
          segments: [
            { type: 'M' as const, x: 0, y: 0 },
            { type: 'C' as const, x1: NaN, y1: 0, x2: 50, y2: 50, x: 100, y: 100 },
            { type: 'Z' as const },
          ],
          closed: true,
        };
      });

      const result = validateShape({ shapeType: '__test_nan_cubic', width: 100, height: 100 });
      const nanIssue = result.issues.find((i) => i.code === 'SHAPE_PATH_NAN');
      expect(nanIssue).toBeDefined();
      expect(nanIssue!.message).toContain('control point');
    });

    it('should report SHAPE_PATH_NAN for NaN in quadratic bezier control points', () => {
      registerPreset('__test_nan_quad', () => {
        return {
          segments: [
            { type: 'M' as const, x: 0, y: 0 },
            { type: 'Q' as const, x1: NaN, y1: 50, x: 100, y: 100 },
            { type: 'Z' as const },
          ],
          closed: true,
        };
      });

      const result = validateShape({ shapeType: '__test_nan_quad', width: 100, height: 100 });
      const nanIssue = result.issues.find((i) => i.code === 'SHAPE_PATH_NAN');
      expect(nanIssue).toBeDefined();
    });
  });

  describe('SHAPE_GENERATION_ERROR', () => {
    it('should report SHAPE_GENERATION_ERROR when path generator throws', () => {
      // Register a shape that throws
      registerPreset('__test_throw_path', () => {
        throw new Error('Intentional test error');
      });

      const result = validateShape({ shapeType: '__test_throw_path', width: 100, height: 100 });
      expect(result.valid).toBe(false);
      const errorIssue = result.issues.find((i) => i.code === 'SHAPE_GENERATION_ERROR');
      expect(errorIssue).toBeDefined();
      expect(errorIssue!.severity).toBe('error');
      expect(errorIssue!.message).toContain('Intentional test error');
    });

    it('should handle non-Error throw values', () => {
      registerPreset('__test_throw_string', () => {
        throw 'string error';
      });

      const result = validateShape({ shapeType: '__test_throw_string', width: 100, height: 100 });
      const errorIssue = result.issues.find((i) => i.code === 'SHAPE_GENERATION_ERROR');
      expect(errorIssue).toBeDefined();
      expect(errorIssue!.message).toContain('string error');
    });
  });
});
