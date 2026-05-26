/**
 * Tests for shape comparison diagnostics.
 */
import { compareShapes } from '../../src/diagnostics/comparators';

describe('compareShapes', () => {
  describe('matching data', () => {
    it('should match identical objects', () => {
      const data = { shapeType: 'rect', width: 100, height: 50 };
      const result = compareShapes(data, { ...data });
      expect(result.match).toBe(true);
      expect(result.differences).toEqual([]);
    });

    it('should match empty objects', () => {
      const result = compareShapes({}, {});
      expect(result.match).toBe(true);
    });

    it('should match null with null', () => {
      const result = compareShapes(null, null);
      expect(result.match).toBe(true);
    });

    it('should match identical nested objects', () => {
      const data = { fill: { type: 'solid', color: '#fff' }, position: { x: 0, y: 0 } };
      const result = compareShapes(data, JSON.parse(JSON.stringify(data)));
      expect(result.match).toBe(true);
    });
  });

  describe('simple differences', () => {
    it('should detect string differences', () => {
      const result = compareShapes({ shapeType: 'rect' }, { shapeType: 'ellipse' });
      expect(result.match).toBe(false);
      expect(result.differences.length).toBe(1);
      expect(result.differences[0].property).toBe('shapeType');
      expect(result.differences[0].source).toBe('rect');
      expect(result.differences[0].stored).toBe('ellipse');
    });

    it('should detect missing properties in stored', () => {
      const result = compareShapes({ shapeType: 'rect', width: 100 }, { shapeType: 'rect' });
      expect(result.match).toBe(false);
      expect(result.differences.some((d) => d.property === 'width')).toBe(true);
    });

    it('should detect extra properties in stored', () => {
      const result = compareShapes({ shapeType: 'rect' }, { shapeType: 'rect', extra: true });
      expect(result.match).toBe(false);
      expect(result.differences.some((d) => d.property === 'extra')).toBe(true);
    });
  });

  describe('numeric tolerance', () => {
    it('should match numbers within tolerance (1e-6)', () => {
      const result = compareShapes({ x: 100.00000001 }, { x: 100.00000002 });
      expect(result.match).toBe(true);
    });

    it('should detect numbers outside tolerance', () => {
      const result = compareShapes({ x: 100.0 }, { x: 100.001 });
      expect(result.match).toBe(false);
    });
  });

  describe('nested objects', () => {
    it('should detect differences in nested objects', () => {
      const result = compareShapes({ fill: { color: '#ff0000' } }, { fill: { color: '#0000ff' } });
      expect(result.match).toBe(false);
      expect(result.differences[0].property).toBe('fill.color');
    });

    it('should detect deeply nested differences', () => {
      const result = compareShapes({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } });
      expect(result.match).toBe(false);
      expect(result.differences[0].property).toContain('c');
    });
  });

  describe('null/undefined handling', () => {
    it('should detect null vs undefined', () => {
      const result = compareShapes(null, undefined);
      expect(result.match).toBe(false);
      expect(result.differences[0].property).toBe('(root)');
    });

    it('should detect null vs object', () => {
      const result = compareShapes(null, { x: 1 });
      expect(result.match).toBe(false);
    });

    it('should detect primitive vs object', () => {
      const result = compareShapes('hello', 'world');
      expect(result.match).toBe(false);
      expect(result.differences[0].property).toBe('(root)');
    });

    it('should match identical primitives', () => {
      const result = compareShapes('hello', 'hello');
      expect(result.match).toBe(true);
    });
  });

  describe('array handling', () => {
    it('should detect array length differences', () => {
      const result = compareShapes({ items: [1, 2, 3] }, { items: [1, 2] });
      expect(result.match).toBe(false);
      expect(result.differences.length).toBeGreaterThan(0);
    });

    it('should detect array element differences', () => {
      const result = compareShapes({ items: [1, 2, 3] }, { items: [1, 99, 3] });
      expect(result.match).toBe(false);
    });

    it('should match identical arrays', () => {
      const result = compareShapes({ items: [1, 2, 3] }, { items: [1, 2, 3] });
      expect(result.match).toBe(true);
    });
  });

  describe('complex scenarios', () => {
    it('should handle multiple differences at once', () => {
      const result = compareShapes({ a: 1, b: 'x', c: true }, { a: 2, b: 'y', c: false });
      expect(result.match).toBe(false);
      expect(result.differences.length).toBe(3);
    });

    it('should handle real shape data', () => {
      const source = {
        shapeType: 'rect',
        width: 100,
        height: 50,
        fill: { type: 'solid', color: '#ff0000' },
        position: { x: 10, y: 20 },
      };
      const stored = {
        shapeType: 'rect',
        width: 100,
        height: 50,
        fill: { type: 'solid', color: '#ff0000' },
        position: { x: 10, y: 20 },
      };
      const result = compareShapes(source, stored);
      expect(result.match).toBe(true);
    });

    it('should handle shape data with subtle differences', () => {
      const source = {
        shapeType: 'rect',
        fill: { type: 'solid', color: '#ff0000' },
      };
      const stored = {
        shapeType: 'rect',
        fill: { type: 'solid', color: '#ff0001' },
      };
      const result = compareShapes(source, stored);
      expect(result.match).toBe(false);
      expect(result.differences[0].property).toBe('fill.color');
    });
  });
});
