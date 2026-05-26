/**
 * Scatter Chart Component Tests
 */

import {
  BubbleChart,
  ScatterChart,
  ScatterWithTrendline,
} from '../../src/components/scatter-chart';
import type { MarkSpec } from '../../src/grammar/spec';

describe('ScatterChart', () => {
  describe('factory function', () => {
    it('creates a scatter chart builder', () => {
      const builder = ScatterChart();
      expect(builder).toBeDefined();
      expect(typeof builder.toSpec).toBe('function');
    });
  });

  describe('basic scatter chart', () => {
    it('produces valid spec with x and y encodings', () => {
      const spec = ScatterChart()
        .data([
          { x: 1, y: 2 },
          { x: 3, y: 4 },
          { x: 5, y: 6 },
        ])
        .x('x')
        .y('y')
        .toSpec();

      expect((spec.mark as MarkSpec).type).toBe('point');
      // By default, points are filled (no fillOpacity restriction)
      expect((spec.mark as MarkSpec).fillOpacity).toBeUndefined();
      expect(spec.data).toEqual({
        values: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
          { x: 5, y: 6 },
        ],
      });
      expect(spec.encoding?.x).toEqual({
        field: 'x',
        type: 'quantitative',
      });
      expect(spec.encoding?.y).toEqual({
        field: 'y',
        type: 'quantitative',
      });
    });

    it('sets title correctly', () => {
      const spec = ScatterChart().x('x').y('y').title('Scatter Plot').toSpec();

      expect(spec.title).toBe('Scatter Plot');
    });
  });

  describe('color encoding', () => {
    it('supports color encoding for grouping', () => {
      const spec = ScatterChart().x('sepalLength').y('sepalWidth').color('species').toSpec();

      expect(spec.encoding?.color).toEqual({
        field: 'species',
        type: 'nominal',
      });
    });
  });

  describe('bubble chart (size encoding)', () => {
    it('supports size encoding', () => {
      const spec = ScatterChart().x('gdp').y('lifeExpectancy').size('population').toSpec();

      expect(spec.encoding?.size).toEqual({
        field: 'population',
        type: 'quantitative',
      });
    });

    it('BubbleChart factory creates scatter', () => {
      const spec = BubbleChart().x('x').y('y').size('z').toSpec();

      expect((spec.mark as MarkSpec).type).toBe('point');
      expect(spec.encoding?.size?.field).toBe('z');
    });
  });

  describe('shape encoding', () => {
    it('supports shape encoding', () => {
      const spec = ScatterChart().x('x').y('y').shape('category').toSpec();

      expect(spec.encoding?.shape).toEqual({
        field: 'category',
        type: 'nominal',
      });
    });
  });

  describe('styling', () => {
    it('sets point size', () => {
      const spec = ScatterChart().x('x').y('y').pointSize(100).toSpec();

      expect((spec.mark as MarkSpec).size).toBe(100);
    });

    it('creates filled points by default', () => {
      const spec = ScatterChart().x('x').y('y').filled().toSpec();

      // filled() removes fillOpacity restriction, showing filled points
      expect((spec.mark as MarkSpec).fillOpacity).toBeUndefined();
    });

    it('creates unfilled points', () => {
      const spec = ScatterChart().x('x').y('y').unfilled().toSpec();

      // unfilled() sets fillOpacity to 0 to show outline only
      expect((spec.mark as MarkSpec).fillOpacity).toBe(0);
    });

    it('sets fill color', () => {
      const spec = ScatterChart().x('x').y('y').fill('#ff0000').toSpec();

      expect((spec.mark as MarkSpec).fill).toBe('#ff0000');
    });

    it('sets stroke color', () => {
      const spec = ScatterChart().x('x').y('y').stroke('#000000').toSpec();

      expect((spec.mark as MarkSpec).stroke).toBe('#000000');
    });

    it('sets opacity', () => {
      const spec = ScatterChart().x('x').y('y').opacityValue(0.7).toSpec();

      expect((spec.mark as MarkSpec).opacity).toBe(0.7);
    });
  });

  describe('trendline', () => {
    it('adds linear trendline', () => {
      const spec = ScatterChart().x('x').y('y').linearTrendline().toSpec();

      expect(spec.layer).toBeDefined();
      expect(spec.layer).toHaveLength(2);
      // First layer is points
      expect((spec.layer![0].mark as MarkSpec).type).toBe('point');
      // Second layer is trendline
      expect((spec.layer![1].mark as MarkSpec).type).toBe('line');
      expect(spec.layer![1].transform).toBeDefined();
    });

    it('adds polynomial trendline', () => {
      const spec = ScatterChart().x('x').y('y').polynomialTrendline(2).toSpec();

      expect(spec.layer).toBeDefined();
      expect(spec.layer![1].transform![0]).toMatchObject({
        regression: 'y',
        on: 'x',
        method: 'poly',
        order: 2,
      });
    });

    it('ScatterWithTrendline factory creates scatter with trendline', () => {
      const spec = ScatterWithTrendline().x('x').y('y').toSpec();

      expect(spec.layer).toBeDefined();
      expect(spec.layer).toHaveLength(2);
    });

    it('trendline with custom color', () => {
      const spec = ScatterChart().x('x').y('y').linearTrendline('#ff0000').toSpec();

      expect((spec.layer![1].mark as MarkSpec).stroke).toBe('#ff0000');
    });

    it('removes trendline', () => {
      const spec = ScatterChart().x('x').y('y').linearTrendline().noTrendline().toSpec();

      expect(spec.layer).toBeUndefined();
    });
  });

  describe('dimensions', () => {
    it('sets width and height', () => {
      const spec = ScatterChart().x('x').y('y').width(600).height(400).toSpec();

      expect(spec.width).toBe(600);
      expect(spec.height).toBe(400);
    });
  });

  describe('fluent API chaining', () => {
    it('supports full fluent chain', () => {
      const spec = ScatterChart()
        .data([{ x: 1, y: 2, z: 3, cat: 'A' }])
        .x('x')
        .y('y')
        .size('z')
        .color('cat')
        .pointSize(80)
        .opacityValue(0.8)
        .title('Bubble Chart')
        .width(500)
        .height(400)
        .toSpec();

      expect(spec).toBeDefined();
      expect(spec.title).toBe('Bubble Chart');
      expect(spec.encoding?.size?.field).toBe('z');
      expect(spec.encoding?.color?.field).toBe('cat');
    });
  });
});
