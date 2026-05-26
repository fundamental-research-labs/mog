/**
 * Line Chart Component Tests
 */

import { LineChart, SmoothLineChart, StepChart } from '../../src/components/line-chart';
import type { MarkSpec } from '../../src/grammar/spec';

describe('LineChart', () => {
  describe('factory function', () => {
    it('creates a line chart builder', () => {
      const builder = LineChart();
      expect(builder).toBeDefined();
      expect(typeof builder.toSpec).toBe('function');
    });
  });

  describe('basic line chart', () => {
    it('produces valid spec with x and y encodings', () => {
      const spec = LineChart()
        .data([
          { date: '2024-01', value: 100 },
          { date: '2024-02', value: 150 },
          { date: '2024-03', value: 120 },
        ])
        .x('date', { type: 'temporal' })
        .y('value')
        .toSpec();

      expect(spec.mark).toBe('line');
      expect(spec.data).toEqual({
        values: [
          { date: '2024-01', value: 100 },
          { date: '2024-02', value: 150 },
          { date: '2024-03', value: 120 },
        ],
      });
      expect(spec.encoding?.x?.field).toBe('date');
      expect(spec.encoding?.x?.type).toBe('temporal');
      expect(spec.encoding?.y?.field).toBe('value');
      expect(spec.encoding?.y?.type).toBe('quantitative');
    });

    it('sets title correctly', () => {
      const spec = LineChart().x('date').y('value').title('Time Series').toSpec();

      expect(spec.title).toBe('Time Series');
    });
  });

  describe('multi-series line chart', () => {
    it('supports color encoding for multiple series', () => {
      const spec = LineChart().x('date', { type: 'temporal' }).y('price').color('symbol').toSpec();

      expect(spec.encoding?.color).toEqual({
        field: 'symbol',
        type: 'nominal',
      });
    });
  });

  describe('interpolation methods', () => {
    it('creates smooth line with monotone interpolation', () => {
      const spec = LineChart().x('x').y('y').smooth().toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('monotone');
    });

    it('creates stepped line', () => {
      const spec = LineChart().x('x').y('y').stepped().toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('step');
    });

    it('creates step-before line', () => {
      const spec = LineChart().x('x').y('y').stepBefore().toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('step-before');
    });

    it('creates step-after line', () => {
      const spec = LineChart().x('x').y('y').stepAfter().toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('step-after');
    });

    it('creates basis spline', () => {
      const spec = LineChart().x('x').y('y').basis().toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('basis');
    });

    it('creates cardinal spline with tension', () => {
      const spec = LineChart().x('x').y('y').cardinal(0.5).toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('cardinal');
      expect((spec.mark as MarkSpec).tension).toBe(0.5);
    });
  });

  describe('points on lines', () => {
    it('adds points to line', () => {
      const spec = LineChart().x('x').y('y').withPoints().toSpec();

      expect((spec.mark as MarkSpec).point).toEqual({ filled: true });
    });

    it('adds points with custom options', () => {
      const spec = LineChart().x('x').y('y').withPoints({ color: '#ff0000', size: 50 }).toSpec();

      expect((spec.mark as MarkSpec).point).toEqual({
        color: '#ff0000',
        size: 50,
      });
    });
  });

  describe('stroke styling', () => {
    it('sets stroke color', () => {
      const spec = LineChart().x('x').y('y').stroke('#ff0000').toSpec();

      expect((spec.mark as MarkSpec).stroke).toBe('#ff0000');
    });

    it('sets stroke width', () => {
      const spec = LineChart().x('x').y('y').strokeWidth(3).toSpec();

      expect((spec.mark as MarkSpec).strokeWidth).toBe(3);
    });

    it('creates dashed line', () => {
      const spec = LineChart().x('x').y('y').dashed([8, 4]).toSpec();

      expect((spec.mark as MarkSpec).strokeDash).toEqual([8, 4]);
    });

    it('creates dotted line', () => {
      const spec = LineChart().x('x').y('y').dotted().toSpec();

      expect((spec.mark as MarkSpec).strokeDash).toEqual([2, 2]);
    });
  });

  describe('factory shortcuts', () => {
    it('SmoothLineChart creates smooth line', () => {
      const spec = SmoothLineChart().x('x').y('y').toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('monotone');
    });

    it('StepChart creates stepped line', () => {
      const spec = StepChart().x('x').y('y').toSpec();

      expect((spec.mark as MarkSpec).interpolate).toBe('step');
    });
  });

  describe('layered spec', () => {
    it('creates layered spec for line with points', () => {
      const spec = LineChart().x('x').y('y').withPoints().smooth().toLayeredSpec();

      expect(spec.layer).toHaveLength(2);
      expect((spec.layer![0].mark as MarkSpec).type).toBe('line');
      expect((spec.layer![1].mark as MarkSpec).type).toBe('point');
    });
  });
});
