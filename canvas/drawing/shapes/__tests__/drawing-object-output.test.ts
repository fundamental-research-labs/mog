/**
 * Tests for createDrawingObject.
 */
import type { DrawingEffects, DrawingFill, DrawingStroke } from '@mog-sdk/contracts/drawing';
import type { ShapeVisualProperties } from '../src/drawing-object-output';
import { createDrawingObject } from '../src/drawing-object-output';

// Ensure presets are registered
import '../src/presets/basic';

describe('createDrawingObject', () => {
  describe('basic shape -> DrawingObject with geometry', () => {
    it('should produce a DrawingObject with geometry for a rectangle', () => {
      const result = createDrawingObject('rect', 200, 100);
      expect(result.geometry).toBeDefined();
      expect(result.geometry.segments.length).toBeGreaterThan(0);
    });

    it('should not include fill, stroke, effects, or text when no visual provided', () => {
      const result = createDrawingObject('rect', 200, 100);
      expect(result.fill).toBeUndefined();
      expect(result.stroke).toBeUndefined();
      expect(result.effects).toBeUndefined();
      expect(result.text).toBeUndefined();
    });
  });

  describe('no visual properties -> geometry only', () => {
    it('should produce a DrawingObject with only geometry when visual is undefined', () => {
      const result = createDrawingObject('ellipse', 100, 100, undefined, undefined);
      expect(result.geometry).toBeDefined();
      expect(result.fill).toBeUndefined();
      expect(result.stroke).toBeUndefined();
      expect(result.effects).toBeUndefined();
      expect(result.text).toBeUndefined();
    });

    it('should produce a DrawingObject with only geometry when visual is empty', () => {
      const result = createDrawingObject('rect', 200, 100, undefined, {});
      expect(result.geometry).toBeDefined();
      expect(result.fill).toBeUndefined();
      expect(result.stroke).toBeUndefined();
      expect(result.effects).toBeUndefined();
      expect(result.text).toBeUndefined();
    });
  });

  describe('shape with solid fill', () => {
    it('should include the fill on the DrawingObject', () => {
      const fill: DrawingFill = { type: 'solid', color: '#ff0000', opacity: 0.8 };
      const result = createDrawingObject('rect', 200, 100, undefined, { fill });
      expect(result.fill).toEqual({ type: 'solid', color: '#ff0000', opacity: 0.8 });
    });

    it('should not include stroke or text when only fill is specified', () => {
      const fill: DrawingFill = { type: 'solid', color: '#00ff00' };
      const result = createDrawingObject('rect', 200, 100, undefined, { fill });
      expect(result.fill).toBeDefined();
      expect(result.stroke).toBeUndefined();
      expect(result.text).toBeUndefined();
    });
  });

  describe('shape with stroke', () => {
    it('should include the stroke on the DrawingObject', () => {
      const stroke: DrawingStroke = { color: '#000000', width: 2 };
      const result = createDrawingObject('rect', 200, 100, undefined, { stroke });
      expect(result.stroke).toEqual({ color: '#000000', width: 2 });
    });

    it('should include stroke with dash and join options', () => {
      const stroke: DrawingStroke = {
        color: '#333',
        width: 3,
        dash: 'dashDot',
        join: 'round',
        cap: 'round',
      };
      const result = createDrawingObject('ellipse', 100, 100, undefined, { stroke });
      expect(result.stroke).toEqual(stroke);
    });
  });

  describe('shape with effects', () => {
    it('should include effects on the DrawingObject', () => {
      const effects: DrawingEffects = {
        outerShadow: [
          {
            color: '#000000',
            opacity: 0.4,
            blurRadius: 50800,
            distance: 38100,
            direction: 135,
          },
        ],
      };
      const result = createDrawingObject('rect', 200, 100, undefined, { effects });
      expect(result.effects).toEqual(effects);
    });
  });

  describe('shape with text', () => {
    it('should produce a DrawingTextBody with computed insets', () => {
      const visual: ShapeVisualProperties = {
        text: {
          content: 'Hello World',
        },
      };
      const result = createDrawingObject('rect', 200, 100, undefined, visual);
      expect(result.text).toBeDefined();
      expect(result.text!.paragraphs).toHaveLength(1);
      expect(result.text!.paragraphs[0].runs).toHaveLength(1);
      expect(result.text!.paragraphs[0].runs[0].text).toBe('Hello World');
      expect(result.text!.wrap).toBe(true);
    });

    it('should compute insets that are positive (inside the shape)', () => {
      const visual: ShapeVisualProperties = {
        text: { content: 'Test' },
      };
      const result = createDrawingObject('rect', 200, 100, undefined, visual);
      expect(result.text!.insets.top).toBeGreaterThan(0);
      expect(result.text!.insets.right).toBeGreaterThan(0);
      expect(result.text!.insets.bottom).toBeGreaterThan(0);
      expect(result.text!.insets.left).toBeGreaterThan(0);
    });

    it('should use 5% margin insets for rectangle', () => {
      const visual: ShapeVisualProperties = {
        text: { content: 'Test' },
      };
      const result = createDrawingObject('rect', 200, 100, undefined, visual);
      // Rectangle: 5% margin -> 10px left/right, 5px top/bottom
      expect(result.text!.insets.left).toBeCloseTo(10);
      expect(result.text!.insets.right).toBeCloseTo(10);
      expect(result.text!.insets.top).toBeCloseTo(5);
      expect(result.text!.insets.bottom).toBeCloseTo(5);
    });

    it('should apply text style to the run', () => {
      const visual: ShapeVisualProperties = {
        text: {
          content: 'Styled',
          style: {
            fontFamily: 'Arial',
            fontSize: 18,
            fontWeight: 'bold',
            fontStyle: 'italic',
            color: '#333',
          },
        },
      };
      const result = createDrawingObject('rect', 200, 100, undefined, visual);
      const runStyle = result.text!.paragraphs[0].runs[0].style;
      expect(runStyle).toBeDefined();
      expect(runStyle!.fontFamily).toBe('Arial');
      expect(runStyle!.fontSize).toBe(18);
      expect(runStyle!.fontWeight).toBe('bold');
      expect(runStyle!.fontStyle).toBe('italic');
      expect(runStyle!.color).toBe('#333');
    });

    it('should map text align to paragraph align', () => {
      const visual: ShapeVisualProperties = {
        text: {
          content: 'Centered',
          style: { align: 'center' },
        },
      };
      const result = createDrawingObject('rect', 200, 100, undefined, visual);
      expect(result.text!.paragraphs[0].align).toBe('center');
    });

    it('should map text verticalAlign to anchor', () => {
      const visual: ShapeVisualProperties = {
        text: {
          content: 'Bottom',
          style: { verticalAlign: 'bottom' },
        },
      };
      const result = createDrawingObject('rect', 200, 100, undefined, visual);
      expect(result.text!.anchor).toBe('bottom');
    });

    it('should default anchor to "top" when no verticalAlign specified', () => {
      const visual: ShapeVisualProperties = {
        text: { content: 'Default' },
      };
      const result = createDrawingObject('rect', 200, 100, undefined, visual);
      expect(result.text!.anchor).toBe('top');
    });

    it('should compute different insets for diamond vs rectangle', () => {
      const visual: ShapeVisualProperties = {
        text: { content: 'Test' },
      };
      const rectResult = createDrawingObject('rect', 200, 100, undefined, visual);
      const diamondResult = createDrawingObject('diamond', 200, 100, undefined, visual);
      // Diamond has 25% margin vs rectangle's 5%, so larger insets
      expect(diamondResult.text!.insets.left).toBeGreaterThan(rectResult.text!.insets.left);
    });
  });

  describe('unknown shape type', () => {
    it('should throw for an unknown shape type', () => {
      expect(() => createDrawingObject('nonexistentShape', 200, 100)).toThrow(/Unknown shape type/);
    });
  });

  describe('shape with adjustments', () => {
    it('should pass adjustments through to path generation', () => {
      const result = createDrawingObject('roundRect', 200, 100, [
        { name: 'cornerRadius', value: 0.3 },
      ]);
      expect(result.geometry).toBeDefined();
      expect(result.geometry.segments.length).toBeGreaterThan(0);
    });
  });

  describe('combined visual properties', () => {
    it('should include fill, stroke, and text together', () => {
      const visual: ShapeVisualProperties = {
        fill: { type: 'solid', color: '#ff0000' },
        stroke: { color: '#000', width: 2 },
        text: { content: 'Full shape' },
      };
      const result = createDrawingObject('rect', 200, 100, undefined, visual);
      expect(result.geometry).toBeDefined();
      expect(result.fill).toBeDefined();
      expect(result.stroke).toBeDefined();
      expect(result.text).toBeDefined();
    });
  });
});
