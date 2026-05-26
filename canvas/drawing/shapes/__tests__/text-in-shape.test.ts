/**
 * Tests for text-in-shape layout computation.
 */
import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import { computeTextInset } from '../src/text-in-shape';

describe('computeTextInset', () => {
  const bounds: BoundingBox = { x: 0, y: 0, width: 200, height: 100 };

  describe('rect (default margins)', () => {
    it('should return symmetric margins', () => {
      const result = computeTextInset('rect', bounds);
      expect(result.margins.left).toBe(result.margins.right);
      expect(result.margins.top).toBe(result.margins.bottom);
    });

    it('should return a smaller inset box', () => {
      const result = computeTextInset('rect', bounds);
      expect(result.insetBox.width).toBeLessThan(bounds.width);
      expect(result.insetBox.height).toBeLessThan(bounds.height);
    });

    it('should have middle vertical alignment', () => {
      const result = computeTextInset('rect', bounds);
      expect(result.verticalAlign).toBe('middle');
    });

    it('should use 5% margin fraction', () => {
      const result = computeTextInset('rect', bounds);
      expect(result.margins.left).toBeCloseTo(200 * 0.05);
      expect(result.margins.top).toBeCloseTo(100 * 0.05);
    });
  });

  describe('ellipse', () => {
    it('should have larger margins than rectangle', () => {
      const rectResult = computeTextInset('rect', bounds);
      const ovalResult = computeTextInset('ellipse', bounds);
      expect(ovalResult.margins.left).toBeGreaterThan(rectResult.margins.left);
    });

    it('should have exact (1 - sqrt(2)/2) / 2 margin fraction', () => {
      const result = computeTextInset('ellipse', bounds);
      const exactFraction = (1 - Math.SQRT1_2) / 2;
      expect(result.margins.left).toBeCloseTo(200 * exactFraction);
      expect(result.margins.top).toBeCloseTo(100 * exactFraction);
    });
  });

  describe('diamond', () => {
    it('should have 25% margin fraction', () => {
      const result = computeTextInset('diamond', bounds);
      expect(result.margins.left).toBeCloseTo(200 * 0.25);
      expect(result.margins.top).toBeCloseTo(100 * 0.25);
    });

    it('should be significantly smaller than the shape', () => {
      const result = computeTextInset('diamond', bounds);
      expect(result.insetBox.width).toBeCloseTo(bounds.width * 0.5);
      expect(result.insetBox.height).toBeCloseTo(bounds.height * 0.5);
    });
  });

  describe('triangle', () => {
    it('should have top vertical alignment', () => {
      const result = computeTextInset('triangle', bounds);
      expect(result.verticalAlign).toBe('top');
    });

    it('should have larger top margin than bottom', () => {
      const result = computeTextInset('triangle', bounds);
      expect(result.margins.top).toBeGreaterThan(result.margins.bottom);
    });

    it('should have non-zero width and height', () => {
      const result = computeTextInset('triangle', bounds);
      expect(result.insetBox.width).toBeGreaterThan(0);
      expect(result.insetBox.height).toBeGreaterThan(0);
    });
  });

  describe('parallelogram', () => {
    it('should have asymmetric left/right margins based on skew', () => {
      const result = computeTextInset('parallelogram', bounds);
      expect(result.insetBox.width).toBeLessThan(bounds.width);
      expect(result.insetBox.height).toBeLessThan(bounds.height);
    });

    it('should have middle vertical alignment', () => {
      const result = computeTextInset('parallelogram', bounds);
      expect(result.verticalAlign).toBe('middle');
    });
  });

  describe('trapezoid', () => {
    it('should have middle vertical alignment', () => {
      const result = computeTextInset('trapezoid', bounds);
      expect(result.verticalAlign).toBe('middle');
    });

    it('should shrink width due to slanted sides', () => {
      const result = computeTextInset('trapezoid', bounds);
      expect(result.insetBox.width).toBeLessThan(bounds.width);
    });
  });

  describe('roundRect', () => {
    it('should respect cornerRadius adjustment', () => {
      const smallCorner = computeTextInset('roundRect', bounds, [
        { name: 'cornerRadius', value: 0.05 },
      ]);
      const largeCorner = computeTextInset('roundRect', bounds, [
        { name: 'cornerRadius', value: 0.4 },
      ]);
      expect(largeCorner.margins.left).toBeGreaterThan(smallCorner.margins.left);
    });
  });

  describe('star shapes', () => {
    it('should have large margins for star5', () => {
      const result = computeTextInset('star5', bounds);
      expect(result.margins.left).toBeCloseTo(200 * 0.3);
    });

    it('should have 30% margin for star shapes', () => {
      const star4 = computeTextInset('star4', bounds);
      const star8 = computeTextInset('star8', bounds);
      expect(star4.margins.left).toBeCloseTo(200 * 0.3);
      expect(star8.margins.left).toBeCloseTo(200 * 0.3);
    });
  });

  describe('flowchart shapes', () => {
    it('flowChartProcess should use 5% margins', () => {
      const result = computeTextInset('flowChartProcess', bounds);
      expect(result.margins.left).toBeCloseTo(200 * 0.05);
    });

    it('flowChartDecision should use 25% margins (diamond)', () => {
      const result = computeTextInset('flowChartDecision', bounds);
      expect(result.margins.left).toBeCloseTo(200 * 0.25);
    });

    it('flowChartConnector should use oval margins', () => {
      const result = computeTextInset('flowChartConnector', bounds);
      const exactFraction = (1 - Math.SQRT1_2) / 2;
      expect(result.margins.left).toBeCloseTo(200 * exactFraction);
    });

    it('flowChartDocument should have bottom-heavy margins for wave', () => {
      const result = computeTextInset('flowChartDocument', bounds);
      expect(result.margins.bottom).toBeGreaterThan(result.margins.top);
    });
  });

  describe('can shape', () => {
    it('should have a larger top margin for the cylinder cap', () => {
      const result = computeTextInset('can', bounds);
      expect(result.margins.top).toBeGreaterThan(result.margins.bottom);
    });

    it('should respond to adjust parameter', () => {
      const small = computeTextInset('can', bounds, [{ name: 'adjust', value: 0.1 }]);
      const large = computeTextInset('can', bounds, [{ name: 'adjust', value: 0.5 }]);
      expect(large.margins.top).toBeGreaterThan(small.margins.top);
    });
  });

  describe('unknown shapes', () => {
    it('should use default 5% margins for unknown shapes', () => {
      const result = computeTextInset('someUnknownShape', bounds);
      expect(result.margins.left).toBeCloseTo(200 * 0.05);
      expect(result.verticalAlign).toBe('middle');
    });
  });

  describe('edge cases', () => {
    it('should handle zero-size bounds', () => {
      const result = computeTextInset('rect', { x: 0, y: 0, width: 0, height: 0 });
      expect(result.insetBox.width).toBe(0);
      expect(result.insetBox.height).toBe(0);
    });

    it('should preserve origin offset', () => {
      const result = computeTextInset('rect', { x: 50, y: 30, width: 200, height: 100 });
      expect(result.insetBox.x).toBeGreaterThan(50);
      expect(result.insetBox.y).toBeGreaterThan(30);
    });

    it('should handle no adjustments parameter', () => {
      const result = computeTextInset('roundRect', bounds);
      expect(result.insetBox.width).toBeGreaterThan(0);
    });
  });
});
