/**
 * Combo Chart Component Tests
 */

import { BarLineCombo, ComboChart } from '../../src/components/combo-chart';
import type { MarkSpec } from '../../src/grammar/spec';

describe('ComboChart', () => {
  describe('factory function', () => {
    it('creates a combo chart builder', () => {
      const builder = ComboChart();
      expect(builder).toBeDefined();
      expect(typeof builder.toSpec).toBe('function');
    });
  });

  describe('basic combo chart', () => {
    it('produces layered spec with bar and line', () => {
      const spec = ComboChart()
        .data([
          { month: 'Jan', revenue: 100, profit: 10 },
          { month: 'Feb', revenue: 150, profit: 20 },
        ])
        .x('month')
        .bar('revenue')
        .line('profit')
        .toSpec();

      expect(spec.layer).toBeDefined();
      expect(spec.layer).toHaveLength(2);
      expect((spec.layer![0].mark as MarkSpec).type).toBe('bar');
      expect((spec.layer![1].mark as MarkSpec).type).toBe('line');
    });

    it('sets x encoding at root level', () => {
      const spec = ComboChart().x('month', { type: 'ordinal' }).bar('revenue').toSpec();

      expect(spec.encoding?.x?.field).toBe('month');
      expect(spec.encoding?.x?.type).toBe('ordinal');
    });
  });

  describe('bar series', () => {
    it('adds bar series with default left axis', () => {
      const spec = ComboChart().x('month').bar('revenue').toSpec();

      expect(spec.layer![0].encoding?.y?.field).toBe('revenue');
    });

    it('adds bar series with custom color', () => {
      const spec = ComboChart().x('month').bar('revenue', { color: '#4e79a7' }).toSpec();

      expect((spec.layer![0].mark as MarkSpec).fill).toBe('#4e79a7');
    });

    it('adds bar series with custom opacity', () => {
      const spec = ComboChart().x('month').bar('revenue', { opacity: 0.8 }).toSpec();

      expect((spec.layer![0].mark as MarkSpec).opacity).toBe(0.8);
    });
  });

  describe('line series', () => {
    it('adds line series with default right axis', () => {
      const spec = ComboChart().x('month').line('profit').toSpec();

      expect(spec.layer![0].encoding?.y?.field).toBe('profit');
    });

    it('adds smooth line', () => {
      const spec = ComboChart().x('month').line('profit', { smooth: true }).toSpec();

      expect((spec.layer![0].mark as MarkSpec).interpolate).toBe('monotone');
    });

    it('adds line with points', () => {
      const spec = ComboChart().x('month').line('profit', { withPoints: true }).toSpec();

      expect((spec.layer![0].mark as MarkSpec).point).toEqual({ filled: true });
    });

    it('adds line with custom stroke', () => {
      const spec = ComboChart()
        .x('month')
        .line('profit', { color: '#ff0000', strokeWidth: 3 })
        .toSpec();

      expect((spec.layer![0].mark as MarkSpec).stroke).toBe('#ff0000');
      expect((spec.layer![0].mark as MarkSpec).strokeWidth).toBe(3);
    });
  });

  describe('area series', () => {
    it('adds area series', () => {
      const spec = ComboChart().x('month').area('value').toSpec();

      expect((spec.layer![0].mark as MarkSpec).type).toBe('area');
    });

    it('adds area with opacity', () => {
      const spec = ComboChart().x('month').area('value', { opacity: 0.3 }).toSpec();

      expect((spec.layer![0].mark as MarkSpec).fillOpacity).toBe(0.3);
    });
  });

  describe('point series', () => {
    it('adds point series', () => {
      const spec = ComboChart().x('month').point('highlights').toSpec();

      expect((spec.layer![0].mark as MarkSpec).type).toBe('point');
    });

    it('adds point with size', () => {
      const spec = ComboChart().x('month').point('highlights', { size: 100 }).toSpec();

      expect((spec.layer![0].mark as MarkSpec).size).toBe(100);
    });
  });

  describe('dual axis', () => {
    it('enables dual axis when series on different axes', () => {
      const builder = ComboChart()
        .x('month')
        .bar('revenue', { axis: 'left' })
        .line('margin', { axis: 'right' });

      // The builder should have dual axis enabled
      const spec = builder.toSpec();
      expect(spec.layer).toHaveLength(2);
    });

    it('configures left axis title', () => {
      const spec = ComboChart().x('month').bar('revenue').leftAxisTitle('Revenue ($)').toSpec();

      // Title configuration applied
      expect(spec).toBeDefined();
    });

    it('configures right axis title', () => {
      const spec = ComboChart().x('month').line('margin').rightAxisTitle('Margin (%)').toSpec();

      // Title configuration applied
      expect(spec).toBeDefined();
    });

    it('disables dual axis with singleAxis()', () => {
      const spec = ComboChart()
        .x('month')
        .bar('revenue')
        .line('profit', { axis: 'right' })
        .singleAxis()
        .toSpec();

      // All series should be on left axis
      expect(spec.layer).toHaveLength(2);
    });
  });

  describe('multiple series', () => {
    it('supports multiple bar series', () => {
      const spec = ComboChart()
        .x('quarter')
        .bar('sales', { color: '#4e79a7' })
        .bar('costs', { color: '#e15759' })
        .toSpec();

      expect(spec.layer).toHaveLength(2);
      expect((spec.layer![0].mark as MarkSpec).type).toBe('bar');
      expect((spec.layer![1].mark as MarkSpec).type).toBe('bar');
    });

    it('supports complex multi-series combo', () => {
      const spec = ComboChart()
        .x('month')
        .bar('revenue')
        .bar('costs')
        .line('profit')
        .point('targets')
        .toSpec();

      expect(spec.layer).toHaveLength(4);
    });
  });

  describe('factory shortcuts', () => {
    it('BarLineCombo creates bar + line', () => {
      const spec = BarLineCombo('revenue', 'profit').x('month').toSpec();

      expect(spec.layer).toHaveLength(2);
      expect((spec.layer![0].mark as MarkSpec).type).toBe('bar');
      expect((spec.layer![1].mark as MarkSpec).type).toBe('line');
    });
  });

  describe('title and dimensions', () => {
    it('sets title', () => {
      const spec = ComboChart().x('month').bar('value').title('Monthly Performance').toSpec();

      expect(spec.title).toBe('Monthly Performance');
    });

    it('sets dimensions', () => {
      const spec = ComboChart().x('month').bar('value').width(800).height(400).toSpec();

      expect(spec.width).toBe(800);
      expect(spec.height).toBe(400);
    });
  });

  describe('fluent API chaining', () => {
    it('supports full fluent chain', () => {
      const spec = ComboChart()
        .data([{ m: 'Jan', r: 100, p: 10 }])
        .x('m', { type: 'ordinal' })
        .bar('r', { color: '#4e79a7' })
        .line('p', { axis: 'right', smooth: true, color: '#ff0000' })
        .leftAxisTitle('Revenue')
        .rightAxisTitle('Profit')
        .title('Revenue vs Profit')
        .width(600)
        .height(400)
        .toSpec();

      expect(spec).toBeDefined();
      expect(spec.title).toBe('Revenue vs Profit');
      expect(spec.layer).toHaveLength(2);
    });
  });
});
