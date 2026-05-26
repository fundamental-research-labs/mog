/**
 * Pie Chart Component Tests
 */

import { DonutChart, DoughnutChart, PieChart } from '../../src/components/pie-chart';
import type { MarkSpec } from '../../src/grammar/spec';

describe('PieChart', () => {
  describe('factory function', () => {
    it('creates a pie chart builder', () => {
      const builder = PieChart();
      expect(builder).toBeDefined();
      expect(typeof builder.toSpec).toBe('function');
    });
  });

  describe('basic pie chart', () => {
    it('produces valid spec with theta and color encodings', () => {
      const spec = PieChart()
        .data([
          { category: 'A', value: 30 },
          { category: 'B', value: 50 },
          { category: 'C', value: 20 },
        ])
        .theta('value')
        .category('category')
        .toSpec();

      expect(spec.mark).toBe('arc');
      expect(spec.data).toEqual({
        values: [
          { category: 'A', value: 30 },
          { category: 'B', value: 50 },
          { category: 'C', value: 20 },
        ],
      });
      expect(spec.encoding?.theta).toEqual({
        field: 'value',
        type: 'quantitative',
      });
      expect(spec.encoding?.color).toEqual({
        field: 'category',
        type: 'nominal',
      });
    });

    it('value() is alias for theta()', () => {
      const spec1 = PieChart().value('amount').toSpec();
      const spec2 = PieChart().theta('amount').toSpec();

      expect(spec1.encoding?.theta).toEqual(spec2.encoding?.theta);
    });

    it('color() is alias for category()', () => {
      const spec1 = PieChart().color('type').toSpec();
      const spec2 = PieChart().category('type').toSpec();

      expect(spec1.encoding?.color).toEqual(spec2.encoding?.color);
    });
  });

  describe('doughnut chart', () => {
    it('sets inner radius with donut()', () => {
      const spec = PieChart().theta('value').category('category').donut(0.5).toSpec();

      expect((spec.mark as MarkSpec).innerRadius).toBe(0.5);
    });

    it('sets inner radius with doughnut()', () => {
      const spec = PieChart().theta('value').category('category').doughnut(0.6).toSpec();

      expect((spec.mark as MarkSpec).innerRadius).toBe(0.6);
    });

    it('DonutChart factory creates doughnut', () => {
      const spec = DonutChart(0.5).theta('value').category('category').toSpec();

      expect((spec.mark as MarkSpec).innerRadius).toBe(0.5);
    });

    it('DoughnutChart factory creates doughnut', () => {
      const spec = DoughnutChart(0.4).theta('value').category('category').toSpec();

      expect((spec.mark as MarkSpec).innerRadius).toBe(0.4);
    });

    it('sets outer radius explicitly', () => {
      const spec = PieChart().theta('value').outerRadius(100).toSpec();

      expect((spec.mark as MarkSpec).outerRadius).toBe(100);
    });
  });

  describe('styling', () => {
    it('sets corner radius', () => {
      const spec = PieChart().theta('value').cornerRadius(4).toSpec();

      expect((spec.mark as MarkSpec).cornerRadius).toBe(4);
    });

    it('sets pad angle', () => {
      const spec = PieChart().theta('value').padAngle(0.02).toSpec();

      expect((spec.mark as MarkSpec).padAngle).toBe(0.02);
    });

    it('sets spacing between slices', () => {
      const spec = PieChart().theta('value').spacing(3).toSpec();

      expect((spec.mark as MarkSpec).padAngle).toBeDefined();
    });

    it('sets stroke color', () => {
      const spec = PieChart().theta('value').stroke('#ffffff').toSpec();

      expect((spec.mark as MarkSpec).stroke).toBe('#ffffff');
    });

    it('sets stroke width', () => {
      const spec = PieChart().theta('value').strokeWidth(2).toSpec();

      expect((spec.mark as MarkSpec).strokeWidth).toBe(2);
    });
  });

  describe('labels', () => {
    it('creates layered spec with labels', () => {
      const spec = PieChart().theta('value').category('category').withLabels().toSpec();

      expect(spec.layer).toBeDefined();
      expect(spec.layer).toHaveLength(2);
      expect((spec.layer![0].mark as MarkSpec).type).toBe('arc');
      expect((spec.layer![1].mark as MarkSpec).type).toBe('text');
    });

    it('creates percent labels', () => {
      const spec = PieChart()
        .theta('value')
        .category('category')
        .percentLabels({ decimals: 1 })
        .toSpec();

      expect(spec.layer).toBeDefined();
      expect(spec.layer![1].encoding?.text?.format).toBe('.1%');
    });
  });

  describe('title and dimensions', () => {
    it('sets title', () => {
      const spec = PieChart().theta('value').title('Sales Distribution').toSpec();

      expect(spec.title).toBe('Sales Distribution');
    });

    it('sets dimensions', () => {
      const spec = PieChart().theta('value').width(400).height(400).toSpec();

      expect(spec.width).toBe(400);
      expect(spec.height).toBe(400);
    });
  });

  describe('fluent API chaining', () => {
    it('supports full fluent chain', () => {
      const spec = PieChart()
        .data([{ cat: 'A', val: 100 }])
        .theta('val')
        .category('cat')
        .donut(0.5)
        .cornerRadius(3)
        .padAngle(0.01)
        .stroke('#fff')
        .title('Test Pie')
        .width(300)
        .height(300)
        .toSpec();

      expect(spec).toBeDefined();
      expect(spec.title).toBe('Test Pie');
      expect((spec.mark as MarkSpec).innerRadius).toBe(0.5);
    });
  });
});
