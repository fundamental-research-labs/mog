/**
 * Bar Chart Component Tests
 */

import { BarChart, ColumnChart, HorizontalBarChart } from '../../src/components/bar-chart';

describe('BarChart', () => {
  describe('factory function', () => {
    it('creates a bar chart builder', () => {
      const builder = BarChart();
      expect(builder).toBeDefined();
      expect(typeof builder.toSpec).toBe('function');
    });
  });

  describe('basic bar chart', () => {
    it('produces valid spec with x and y encodings', () => {
      const spec = BarChart()
        .data([
          { category: 'A', value: 10 },
          { category: 'B', value: 20 },
          { category: 'C', value: 15 },
        ])
        .x('category')
        .y('value')
        .toSpec();

      expect(spec.mark).toBe('bar');
      expect(spec.data).toEqual({
        values: [
          { category: 'A', value: 10 },
          { category: 'B', value: 20 },
          { category: 'C', value: 15 },
        ],
      });
      expect(spec.encoding?.x).toEqual({
        field: 'category',
        type: 'nominal',
      });
      expect(spec.encoding?.y).toEqual({
        field: 'value',
        type: 'quantitative',
      });
    });

    it('sets title correctly', () => {
      const spec = BarChart().x('category').y('value').title('My Bar Chart').toSpec();

      expect(spec.title).toBe('My Bar Chart');
    });

    it('sets dimensions correctly', () => {
      const spec = BarChart().x('category').y('value').width(800).height(400).toSpec();

      expect(spec.width).toBe(800);
      expect(spec.height).toBe(400);
    });
  });

  describe('grouped bar chart', () => {
    it('creates xOffset encoding for grouped bars', () => {
      const spec = BarChart().x('quarter').y('sales').color('product').grouped().toSpec();

      expect(spec.encoding?.color).toEqual({
        field: 'product',
        type: 'nominal',
      });
      expect(spec.encoding?.xOffset).toEqual({
        field: 'product',
        type: 'nominal',
      });
      expect(spec.config?.stack).toBe(false);
    });
  });

  describe('stacked bar chart', () => {
    it('sets stack config to zero for stacked bars', () => {
      const spec = BarChart().x('quarter').y('sales').color('product').stacked().toSpec();

      expect(spec.config?.stack).toBe('zero');
    });

    it('sets stack config to normalize for percent stacked', () => {
      const spec = BarChart().x('quarter').y('sales').color('product').percentStacked().toSpec();

      expect(spec.config?.stack).toBe('normalize');
    });
  });

  describe('horizontal bar chart', () => {
    it('swaps x and y encodings', () => {
      const spec = BarChart().x('category').y('value').horizontal().toSpec();

      // After horizontal(), x and y should be swapped
      expect(spec.encoding?.x?.field).toBe('value');
      expect(spec.encoding?.y?.field).toBe('category');
    });

    it('HorizontalBarChart factory creates horizontal chart', () => {
      const spec = HorizontalBarChart().x('category').y('value').toSpec();

      // x and y should be swapped
      expect(spec.encoding?.x?.field).toBe('value');
      expect(spec.encoding?.y?.field).toBe('category');
    });
  });

  describe('styling', () => {
    it('applies corner radius', () => {
      const spec = BarChart().x('category').y('value').cornerRadius(4).toSpec();

      expect((spec.mark as any).cornerRadius).toBe(4);
    });

    it('applies opacity', () => {
      const spec = BarChart().x('category').y('value').opacity(0.8).toSpec();

      expect((spec.mark as any).opacity).toBe(0.8);
    });

    it('applies stroke properties', () => {
      const spec = BarChart().x('category').y('value').stroke('#000000').strokeWidth(2).toSpec();

      expect((spec.mark as any).stroke).toBe('#000000');
      expect((spec.mark as any).strokeWidth).toBe(2);
    });
  });

  describe('ColumnChart alias', () => {
    it('creates same spec as BarChart', () => {
      const barSpec = BarChart().x('cat').y('val').toSpec();
      const colSpec = ColumnChart().x('cat').y('val').toSpec();

      expect(barSpec).toEqual(colSpec);
    });
  });

  describe('fluent API chaining', () => {
    it('supports full fluent chain', () => {
      const spec = BarChart()
        .data([{ a: 1, b: 2 }])
        .x('a')
        .y('b')
        .color('c')
        .stacked()
        .cornerRadius(4)
        .title('Test')
        .width(500)
        .height(300)
        .theme('dark')
        .toSpec();

      expect(spec).toBeDefined();
      expect(spec.title).toBe('Test');
      expect(spec.width).toBe(500);
      expect(spec.height).toBe(300);
      expect(spec.theme).toBe('dark');
    });
  });

  describe('toSpec() stability', () => {
    it('toSpec() called twice on horizontal bar produces identical encoding', () => {
      const chart = BarChart()
        .data([
          { category: 'A', value: 10 },
          { category: 'B', value: 20 },
        ])
        .x('category')
        .y('value')
        .horizontal();

      const spec1 = chart.toSpec();
      const spec2 = chart.toSpec();

      // Both calls should produce the same horizontal encoding:
      // x should be the value (quantitative) and y should be the category (nominal)
      expect(spec1.encoding?.x?.field).toBe('value');
      expect(spec1.encoding?.y?.field).toBe('category');

      expect(spec2.encoding?.x?.field).toBe('value');
      expect(spec2.encoding?.y?.field).toBe('category');
    });

    it('toSpec() called twice on vertical bar produces identical encoding', () => {
      const chart = BarChart()
        .data([
          { category: 'A', value: 10 },
          { category: 'B', value: 20 },
        ])
        .x('category')
        .y('value');

      const spec1 = chart.toSpec();
      const spec2 = chart.toSpec();

      // Both calls should produce the same vertical encoding
      expect(spec1.encoding?.x?.field).toBe('category');
      expect(spec1.encoding?.y?.field).toBe('value');

      expect(spec2.encoding?.x?.field).toBe('category');
      expect(spec2.encoding?.y?.field).toBe('value');
    });

    it('toSpec() result is not mutated by subsequent calls', () => {
      const chart = BarChart()
        .data([
          { category: 'A', value: 10 },
          { category: 'B', value: 20 },
        ])
        .x('category')
        .y('value')
        .horizontal();

      const spec1 = chart.toSpec();

      // Capture the encoding fields from the first result
      const spec1XField = spec1.encoding?.x?.field;
      const spec1YField = spec1.encoding?.y?.field;

      // Call toSpec() again
      chart.toSpec();

      // The first result's encoding should not have been mutated
      expect(spec1.encoding?.x?.field).toBe(spec1XField);
      expect(spec1.encoding?.y?.field).toBe(spec1YField);
    });

    it('horizontal then vertical then toSpec produces correct vertical spec', () => {
      const chart = BarChart()
        .data([
          { category: 'A', value: 10 },
          { category: 'B', value: 20 },
        ])
        .x('category')
        .y('value')
        .horizontal()
        .vertical();

      const spec = chart.toSpec();

      // After calling vertical(), the chart should be back to vertical orientation:
      // x = category (nominal), y = value (quantitative)
      expect(spec.encoding?.x?.field).toBe('category');
      expect(spec.encoding?.x?.type).toBe('nominal');
      expect(spec.encoding?.y?.field).toBe('value');
      expect(spec.encoding?.y?.type).toBe('quantitative');
    });
  });
});
