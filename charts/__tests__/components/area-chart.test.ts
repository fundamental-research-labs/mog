/**
 * Area Chart Component Tests
 */

import { AreaChart, StackedAreaChart, StreamGraph } from '../../src/components/area-chart';
import type { MarkSpec } from '../../src/grammar/spec';

describe('AreaChart', () => {
  describe('factory function', () => {
    it('creates an area chart builder', () => {
      const builder = AreaChart();
      expect(builder).toBeDefined();
      expect(typeof builder.toSpec).toBe('function');
    });
  });

  describe('basic area chart', () => {
    it('produces valid spec with x and y encodings', () => {
      const spec = AreaChart()
        .data([
          { date: '2024-01', value: 100 },
          { date: '2024-02', value: 150 },
          { date: '2024-03', value: 120 },
        ])
        .x('date', { type: 'temporal' })
        .y('value')
        .toSpec();

      expect(spec.mark).toBe('area');
      expect(spec.data).toEqual({
        values: [
          { date: '2024-01', value: 100 },
          { date: '2024-02', value: 150 },
          { date: '2024-03', value: 120 },
        ],
      });
      expect(spec.encoding?.x?.field).toBe('date');
      expect(spec.encoding?.y?.field).toBe('value');
    });

    it('sets title correctly', () => {
      const spec = AreaChart().x('date').y('value').title('Area Chart').toSpec();

      expect(spec.title).toBe('Area Chart');
    });
  });

  describe('stacking modes', () => {
    it('creates stacked area chart', () => {
      const spec = AreaChart().x('month').y('amount').color('category').stacked().toSpec();

      expect(spec.config?.stack).toBe('zero');
    });

    it('creates percent stacked area chart', () => {
      const spec = AreaChart().x('month').y('amount').color('category').percentStacked().toSpec();

      expect(spec.config?.stack).toBe('normalize');
    });

    it('creates streamgraph', () => {
      const spec = AreaChart().x('date').y('value').color('series').streamgraph().toSpec();

      expect(spec.config?.stack).toBe('center');
    });

    it('creates overlapping areas', () => {
      const spec = AreaChart().x('date').y('value').color('series').overlapping().toSpec();

      expect(spec.config?.stack).toBe(false);
    });

    it('StackedAreaChart factory creates stacked chart', () => {
      const spec = StackedAreaChart().x('date').y('value').color('series').toSpec();

      expect(spec.config?.stack).toBe('zero');
    });

    it('StreamGraph factory creates streamgraph', () => {
      const spec = StreamGraph().x('date').y('value').color('series').toSpec();

      expect(spec.config?.stack).toBe('center');
      expect((spec.mark as MarkSpec).interpolate).toBe('monotone');
    });
  });

  describe('interpolation methods', () => {
    it('creates smooth area', () => {
      const spec = AreaChart().x('x').y('y').smooth().toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('monotone');
    });

    it('creates stepped area', () => {
      const spec = AreaChart().x('x').y('y').stepped().toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('step');
    });

    it('creates step-before area', () => {
      const spec = AreaChart().x('x').y('y').stepBefore().toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('step-before');
    });

    it('creates step-after area', () => {
      const spec = AreaChart().x('x').y('y').stepAfter().toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('step-after');
    });

    it('creates basis spline area', () => {
      const spec = AreaChart().x('x').y('y').basis().toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('basis');
    });

    it('creates cardinal spline area', () => {
      const spec = AreaChart().x('x').y('y').cardinal(0.5).toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('cardinal');
      expect((spec.mark as MarkSpec).tension).toBe(0.5);
    });
  });

  describe('styling', () => {
    it('sets fill color', () => {
      const spec = AreaChart().x('x').y('y').fill('#4e79a7').toSpec();

      expect((spec.mark as MarkSpec).fill).toBe('#4e79a7');
    });

    it('sets fill opacity', () => {
      const spec = AreaChart().x('x').y('y').fillOpacity(0.5).toSpec();

      expect((spec.mark as MarkSpec).fillOpacity).toBe(0.5);
    });

    it('sets stroke color', () => {
      const spec = AreaChart().x('x').y('y').stroke('#000000').toSpec();

      expect((spec.mark as MarkSpec).stroke).toBe('#000000');
    });

    it('sets stroke width', () => {
      const spec = AreaChart().x('x').y('y').strokeWidth(2).toSpec();

      expect((spec.mark as MarkSpec).strokeWidth).toBe(2);
    });
  });

  describe('line overlay', () => {
    it('adds line overlay', () => {
      const spec = AreaChart().x('x').y('y').withLine().toSpec();

      expect(spec.layer).toBeDefined();
      expect(spec.layer).toHaveLength(2);
      expect((spec.layer![0].mark as MarkSpec).type).toBe('area');
      expect((spec.layer![1].mark as MarkSpec).type).toBe('line');
    });

    it('adds line overlay with options', () => {
      const spec = AreaChart()
        .x('x')
        .y('y')
        .withLine({ color: '#ff0000', strokeWidth: 3 })
        .toSpec();

      expect(spec.layer).toBeDefined();
      expect((spec.layer![1].mark as MarkSpec).stroke).toBe('#ff0000');
      expect((spec.layer![1].mark as MarkSpec).strokeWidth).toBe(3);
    });

    it('removes line overlay', () => {
      const spec = AreaChart().x('x').y('y').withLine().withoutLine().toSpec();

      expect(spec.layer).toBeUndefined();
    });
  });

  describe('dimensions', () => {
    it('sets width and height', () => {
      const spec = AreaChart().x('x').y('y').width(800).height(400).toSpec();

      expect(spec.width).toBe(800);
      expect(spec.height).toBe(400);
    });
  });

  describe('fluent API chaining', () => {
    it('supports full fluent chain', () => {
      const spec = AreaChart()
        .data([{ date: '2024-01', val: 100, cat: 'A' }])
        .x('date', { type: 'temporal' })
        .y('val')
        .color('cat')
        .stacked()
        .smooth()
        .fillOpacity(0.7)
        .title('Stacked Area')
        .width(600)
        .height(400)
        .toSpec();

      expect(spec).toBeDefined();
      expect(spec.title).toBe('Stacked Area');
      expect(spec.config?.stack).toBe('zero');
      expect((spec.mark as MarkSpec).interpolate).toBe('monotone');
    });
  });
});
