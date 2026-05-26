/**
 * Boundary condition tests for shape-engine public API.
 *
 * Tests NaN, Infinity, -0, Number.MAX_VALUE, negative dimensions
 * on all public functions.
 */
import type { CustomGuide, CustomPath } from '../src/custom-geometry';
import { customGeometryToPath, evaluateGuides } from '../src/custom-geometry';
import { createDrawingObject } from '../src/drawing-object-output';
import { generateShapePath } from '../src/shape-to-path';
import { computeTextInset } from '../src/text-in-shape';

// Use a representative sample of shape types for boundary tests
const sampleShapes = ['rect', 'ellipse', 'star5', 'rightArrow', 'diamond', 'roundRect'];

describe('Boundary Conditions', () => {
  // -- generateShapePath ------------------------------------------------------

  describe('generateShapePath', () => {
    describe.each(sampleShapes)('shape "%s"', (shapeType) => {
      it('should handle NaN width gracefully', () => {
        expect(() => generateShapePath(shapeType, NaN, 100)).not.toThrow();
        const path = generateShapePath(shapeType, NaN, 100);
        expect(path.segments).toBeDefined();
      });

      it('should handle NaN height gracefully', () => {
        expect(() => generateShapePath(shapeType, 100, NaN)).not.toThrow();
        const path = generateShapePath(shapeType, 100, NaN);
        expect(path.segments).toBeDefined();
      });

      it('should handle Infinity width gracefully', () => {
        expect(() => generateShapePath(shapeType, Infinity, 100)).not.toThrow();
        const path = generateShapePath(shapeType, Infinity, 100);
        expect(path.segments).toBeDefined();
      });

      it('should handle -Infinity height gracefully', () => {
        expect(() => generateShapePath(shapeType, 100, -Infinity)).not.toThrow();
      });

      it('should handle zero dimensions', () => {
        expect(() => generateShapePath(shapeType, 0, 0)).not.toThrow();
        const path = generateShapePath(shapeType, 0, 0);
        expect(path.segments).toBeDefined();
      });

      it('should handle negative dimensions (clamped to 0)', () => {
        expect(() => generateShapePath(shapeType, -100, -100)).not.toThrow();
        const path = generateShapePath(shapeType, -100, -100);
        expect(path.segments).toBeDefined();
      });

      it('should handle -0 dimensions', () => {
        expect(() => generateShapePath(shapeType, -0, -0)).not.toThrow();
        const path = generateShapePath(shapeType, -0, -0);
        expect(path.segments).toBeDefined();
      });

      it('should handle Number.MAX_VALUE dimensions', () => {
        expect(() =>
          generateShapePath(shapeType, Number.MAX_VALUE, Number.MAX_VALUE),
        ).not.toThrow();
        const path = generateShapePath(shapeType, Number.MAX_VALUE, Number.MAX_VALUE);
        expect(path.segments).toBeDefined();
      });

      it('should handle very small positive dimensions', () => {
        expect(() => generateShapePath(shapeType, 1e-10, 1e-10)).not.toThrow();
        const path = generateShapePath(shapeType, 1e-10, 1e-10);
        expect(path.segments).toBeDefined();
      });
    });
  });

  // -- createDrawingObject ----------------------------------------------------

  describe('createDrawingObject', () => {
    it('should handle NaN dimensions without throwing', () => {
      expect(() => createDrawingObject('rect', NaN, 100)).not.toThrow();
      const obj = createDrawingObject('rect', NaN, 100);
      expect(obj.geometry).toBeDefined();
    });

    it('should handle Infinity dimensions without throwing', () => {
      expect(() => createDrawingObject('rect', Infinity, 100)).not.toThrow();
      const obj = createDrawingObject('rect', Infinity, 100);
      expect(obj.geometry).toBeDefined();
    });

    it('should handle zero dimensions', () => {
      expect(() => createDrawingObject('rect', 0, 0)).not.toThrow();
      const obj = createDrawingObject('rect', 0, 0);
      expect(obj.geometry).toBeDefined();
    });

    it('should handle negative dimensions', () => {
      expect(() => createDrawingObject('rect', -100, -100)).not.toThrow();
      const obj = createDrawingObject('rect', -100, -100);
      expect(obj.geometry).toBeDefined();
    });

    it('should sanitize NaN fill opacity', () => {
      const obj = createDrawingObject('rect', 100, 100, undefined, {
        fill: { type: 'solid', color: '#ff0000', opacity: NaN },
      });
      expect(obj.fill).toBeDefined();
      expect(obj.fill!.type).toBe('solid');
      if (obj.fill!.type === 'solid') {
        expect(obj.fill!.opacity).toBe(1);
      }
    });

    it('should sanitize Infinity fill opacity', () => {
      const obj = createDrawingObject('rect', 100, 100, undefined, {
        fill: { type: 'solid', color: '#ff0000', opacity: Infinity },
      });
      expect(obj.fill).toBeDefined();
      expect(obj.fill!.type).toBe('solid');
      if (obj.fill!.type === 'solid') {
        expect(obj.fill!.opacity).toBe(1);
      }
    });

    it('should handle text with NaN dimensions', () => {
      expect(() =>
        createDrawingObject('rect', NaN, NaN, undefined, {
          text: { content: 'Hello' },
        }),
      ).not.toThrow();
    });
  });

  // -- computeTextInset -------------------------------------------------------

  describe('computeTextInset', () => {
    it('should handle zero-size bounds', () => {
      const result = computeTextInset('rect', { x: 0, y: 0, width: 0, height: 0 });
      expect(result.insetBox.width).toBe(0);
      expect(result.insetBox.height).toBe(0);
    });

    it('should handle NaN in bounds', () => {
      expect(() =>
        computeTextInset('rect', { x: NaN, y: 0, width: 100, height: 100 }),
      ).not.toThrow();
    });

    it('should handle negative width/height', () => {
      expect(() =>
        computeTextInset('rect', { x: 0, y: 0, width: -100, height: -100 }),
      ).not.toThrow();
    });
  });

  // -- evaluateGuides ---------------------------------------------------------

  describe('evaluateGuides', () => {
    it('should handle NaN width', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'val w' }];
      const result = evaluateGuides(guides, NaN, 100);
      expect(result.get('g1')).toBeNaN();
    });

    it('should handle Infinity height', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'val h' }];
      const result = evaluateGuides(guides, 100, Infinity);
      expect(result.get('g1')).toBe(Infinity);
    });

    it('should handle zero dimensions', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: '*/ w 2 0' }];
      const result = evaluateGuides(guides, 0, 0);
      // Division by zero should return 0
      expect(result.get('g1')).toBe(0);
    });

    it('should handle negative dimensions', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'val w' }];
      const result = evaluateGuides(guides, -100, -50);
      expect(result.get('g1')).toBe(-100);
    });
  });

  // -- customGeometryToPath ---------------------------------------------------

  describe('customGeometryToPath', () => {
    it('should handle empty guides and paths', () => {
      const path = customGeometryToPath([], []);
      expect(path.segments).toEqual([]);
    });

    it('should handle NaN in guide values', () => {
      const guides: CustomGuide[] = [{ name: 'g1', formula: 'val 100', value: NaN }];
      const paths: CustomPath[] = [
        {
          commands: [
            { type: 'moveTo', x: 0, y: 0 },
            { type: 'lineTo', x: 1, y: 1 },
            { type: 'close' },
          ],
        },
      ];
      expect(() => customGeometryToPath(guides, paths)).not.toThrow();
    });

    it('should handle zero-size options', () => {
      const paths: CustomPath[] = [
        {
          width: 0,
          height: 0,
          commands: [{ type: 'moveTo', x: 0, y: 0 }, { type: 'close' }],
        },
      ];
      expect(() => customGeometryToPath([], paths, { width: 0, height: 0 })).not.toThrow();
    });
  });
});
