import { resolveBarColumnAxisLayout } from '../chart-ir/bar-axis-layout';
import { configToSpec } from '../config-to-spec';
import { isLayerSpec, type ChartSpec, type UnitSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';

function dataWithCategories(categories: string[]): ChartData {
  return {
    categories,
    series: [
      {
        name: 'Series 1',
        data: categories.map((category, index) => ({
          x: category,
          y: index + 1,
        })),
      },
    ],
  };
}

function asUnitSpec(spec: ChartSpec): UnitSpec {
  expect(isLayerSpec(spec)).toBe(false);
  return spec as UnitSpec;
}

describe('bar/column axis layout', () => {
  it('uses chart width pixels directly for imported column category tick skipping', () => {
    const data = dataWithCategories(
      Array.from({ length: 12 }, (_, index) => `Very long imported label ${index + 1}`),
    );

    const layout = resolveBarColumnAxisLayout({
      sourceDialect: 'ooxml',
      orientation: 'vertical',
      grouping: 'clustered',
      data,
      categoryAxis: { visible: true },
      chartWidth: 640,
    });

    expect(layout.categoryTickSkipSource).toBe('importedAuto');
    expect(layout.categoryTickLabelSkip).toBe(5);
  });

  it('uses chart height pixels directly for imported horizontal bar category tick skipping', () => {
    const data = dataWithCategories(Array.from({ length: 20 }, (_, index) => `Cat ${index + 1}`));

    const layout = resolveBarColumnAxisLayout({
      sourceDialect: 'ooxml',
      orientation: 'horizontal',
      grouping: 'clustered',
      data,
      categoryAxis: { visible: true },
      chartHeight: 240,
    });

    expect(layout.categoryTickSkipSource).toBe('importedAuto');
    expect(layout.categoryTickLabelSkip).toBe(2);
  });

  it('threads point-sized imported column charts through configToSpec axis layout', () => {
    const data = dataWithCategories(
      Array.from({ length: 12 }, (_, index) => `Very long imported label ${index + 1}`),
    );
    const config: ChartConfig = {
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 480,
      height: 225,
      extra: { sourceDialect: 'ooxml' },
    };

    const spec = asUnitSpec(configToSpec(config, data));

    expect(spec.encoding.x?.axis).toMatchObject({
      tickLabelSkipSource: 'importedAuto',
    });
    expect(spec.encoding.x?.axis?.tickLabelSkip).toBe(5);
  });

  it('threads point-sized imported horizontal bar charts through configToSpec axis layout', () => {
    const data = dataWithCategories(Array.from({ length: 20 }, (_, index) => `Cat ${index + 1}`));
    const config: ChartConfig = {
      type: 'bar',
      anchorRow: 0,
      anchorCol: 0,
      width: 480,
      height: 240,
      extra: { sourceDialect: 'ooxml' },
    };

    const spec = asUnitSpec(configToSpec(config, data));

    expect(spec.encoding.y?.axis).toMatchObject({
      tickLabelSkipSource: 'importedAuto',
    });
    expect(spec.encoding.y?.axis?.tickLabelSkip).toBe(1);
  });
});
