import type { Path } from '@mog-sdk/contracts/geometry';
import { validateBoundingBox, validatePath, validateTransform } from '../src/diagnostics';

describe('Diagnostics validators', () => {
  // ─── validatePath ────────────────────────────────────────────────────

  describe('validatePath', () => {
    test('valid simple path', () => {
      const path: Path = {
        segments: [
          { type: 'M', x: 0, y: 0 },
          { type: 'L', x: 100, y: 0 },
          { type: 'L', x: 100, y: 100 },
          { type: 'Z' },
        ],
        closed: true,
      };
      const result = validatePath(path);
      expect(result.valid).toBe(true);
      expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });

    test('empty path has warning', () => {
      const path: Path = { segments: [], closed: false };
      const result = validatePath(path);
      expect(result.issues.some((i) => i.code === 'PATH_EMPTY')).toBe(true);
    });

    test('NaN coordinate is error', () => {
      const path: Path = {
        segments: [
          { type: 'M', x: NaN, y: 0 },
          { type: 'L', x: 100, y: 0 },
        ],
        closed: false,
      };
      const result = validatePath(path);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'PATH_NAN_COORDINATE')).toBe(true);
    });

    test('Infinity coordinate is error', () => {
      const path: Path = {
        segments: [
          { type: 'M', x: 0, y: 0 },
          { type: 'L', x: Infinity, y: 0 },
        ],
        closed: false,
      };
      const result = validatePath(path);
      expect(result.valid).toBe(false);
    });

    test('NaN in cubic control point', () => {
      const path: Path = {
        segments: [
          { type: 'M', x: 0, y: 0 },
          { type: 'C', x1: NaN, y1: 20, x2: 30, y2: 40, x: 50, y: 0 },
        ],
        closed: false,
      };
      const result = validatePath(path);
      expect(result.valid).toBe(false);
    });

    test('NaN in quadratic control point', () => {
      const path: Path = {
        segments: [
          { type: 'M', x: 0, y: 0 },
          { type: 'Q', x1: 50, y1: NaN, x: 100, y: 0 },
        ],
        closed: false,
      };
      const result = validatePath(path);
      expect(result.valid).toBe(false);
    });

    test('path not starting with MoveTo has warning', () => {
      const path: Path = {
        segments: [{ type: 'L', x: 100, y: 0 }],
        closed: false,
      };
      const result = validatePath(path);
      expect(result.issues.some((i) => i.code === 'PATH_NO_MOVETO')).toBe(true);
    });

    test('zero-length line segment has info', () => {
      const path: Path = {
        segments: [
          { type: 'M', x: 10, y: 20 },
          { type: 'L', x: 10, y: 20 },
        ],
        closed: false,
      };
      const result = validatePath(path);
      expect(result.issues.some((i) => i.code === 'PATH_ZERO_LENGTH_SEGMENT')).toBe(true);
    });

    test('closed flag without Z command has info', () => {
      const path: Path = {
        segments: [
          { type: 'M', x: 0, y: 0 },
          { type: 'L', x: 100, y: 0 },
          { type: 'L', x: 100, y: 100 },
        ],
        closed: true,
      };
      const result = validatePath(path);
      expect(result.issues.some((i) => i.code === 'PATH_CLOSED_NO_Z')).toBe(true);
    });

    test('valid path with curves', () => {
      const path: Path = {
        segments: [
          { type: 'M', x: 0, y: 0 },
          { type: 'C', x1: 10, y1: 20, x2: 30, y2: 40, x: 50, y: 0 },
          { type: 'Q', x1: 75, y1: 50, x: 100, y: 0 },
          { type: 'Z' },
        ],
        closed: true,
      };
      const result = validatePath(path);
      expect(result.valid).toBe(true);
    });
  });

  // ─── validateTransform ───────────────────────────────────────────────

  describe('validateTransform', () => {
    test('valid identity transform', () => {
      const result = validateTransform({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    test('valid scale + translate', () => {
      const result = validateTransform({ a: 2, b: 0, c: 0, d: 3, tx: 10, ty: 20 });
      expect(result.valid).toBe(true);
    });

    test('NaN in transform component is error', () => {
      const result = validateTransform({ a: NaN, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'TRANSFORM_NAN')).toBe(true);
    });

    test('Infinity in transform component is error', () => {
      const result = validateTransform({ a: 1, b: 0, c: 0, d: 1, tx: Infinity, ty: 0 });
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'TRANSFORM_NAN')).toBe(true);
    });

    test('singular matrix is error', () => {
      // Scale by 0 in one axis
      const result = validateTransform({ a: 0, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'TRANSFORM_SINGULAR')).toBe(true);
    });

    test('extreme values have warning', () => {
      const result = validateTransform({ a: 1e7, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
      expect(result.issues.some((i) => i.code === 'TRANSFORM_EXTREME')).toBe(true);
    });

    test('rotation matrix is valid', () => {
      const angle = Math.PI / 4;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const result = validateTransform({ a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 });
      expect(result.valid).toBe(true);
    });
  });

  // ─── validateBoundingBox ─────────────────────────────────────────────

  describe('validateBoundingBox', () => {
    test('valid box', () => {
      const result = validateBoundingBox({ x: 0, y: 0, width: 100, height: 50 });
      expect(result.valid).toBe(true);
    });

    test('NaN in box is error', () => {
      const result = validateBoundingBox({ x: NaN, y: 0, width: 100, height: 50 });
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'BBOX_NAN')).toBe(true);
    });

    test('Infinity in box is error', () => {
      const result = validateBoundingBox({ x: 0, y: 0, width: Infinity, height: 50 });
      expect(result.valid).toBe(false);
    });

    test('negative width is error', () => {
      const result = validateBoundingBox({ x: 0, y: 0, width: -10, height: 50 });
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'BBOX_NEGATIVE_WIDTH')).toBe(true);
    });

    test('negative height is error', () => {
      const result = validateBoundingBox({ x: 0, y: 0, width: 10, height: -50 });
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'BBOX_NEGATIVE_HEIGHT')).toBe(true);
    });

    test('zero area (point) has info', () => {
      const result = validateBoundingBox({ x: 5, y: 10, width: 0, height: 0 });
      expect(result.valid).toBe(true);
      expect(result.issues.some((i) => i.code === 'BBOX_ZERO_AREA')).toBe(true);
    });

    test('zero width (vertical line) has info', () => {
      const result = validateBoundingBox({ x: 0, y: 0, width: 0, height: 10 });
      expect(result.valid).toBe(true);
      expect(result.issues.some((i) => i.code === 'BBOX_ZERO_WIDTH')).toBe(true);
    });

    test('zero height (horizontal line) has info', () => {
      const result = validateBoundingBox({ x: 0, y: 0, width: 10, height: 0 });
      expect(result.valid).toBe(true);
      expect(result.issues.some((i) => i.code === 'BBOX_ZERO_HEIGHT')).toBe(true);
    });

    test('extreme values have warning', () => {
      const result = validateBoundingBox({ x: 1e9, y: 0, width: 10, height: 10 });
      expect(result.issues.some((i) => i.code === 'BBOX_EXTREME')).toBe(true);
    });
  });
});
