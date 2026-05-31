import type { RectMark, TextMark } from '../../primitives/types';
import type { ChartConfig, ChartData } from '../../types';
import { compile } from '../../grammar/compiler';
import { configToSpec } from '../config-to-spec';
import { SERIES_FILL_FIELD } from '../config-to-spec/fields';

function importedBarConfig(): ChartConfig {
  return {
    type: 'bar',
    subType: 'clustered',
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 5,
    series: [
      {
        name: 'Before',
        idx: 0,
        order: 0,
        color: '2F75B5',
        format: {
          fill: { type: 'solid', color: '2F75B5' },
          line: { color: '2F75B5' },
        },
      },
      {
        name: 'After',
        idx: 1,
        order: 1,
        color: '70AD47',
        format: {
          fill: { type: 'solid', color: '70AD47' },
          line: { color: '70AD47' },
        },
      },
    ],
  };
}

function importedBarData(): ChartData {
  return {
    categories: ['North', 'South'],
    series: [
      {
        name: 'Before',
        data: [
          { x: 'North', y: 49 },
          { x: 'South', y: 26 },
        ],
      },
      {
        name: 'After',
        data: [
          { x: 'North', y: 79 },
          { x: 'South', y: 55 },
        ],
      },
    ],
  };
}

function isSeriesRect(mark: unknown): mark is RectMark {
  return (
    typeof mark === 'object' &&
    mark !== null &&
    (mark as { type?: unknown }).type === 'rect' &&
    typeof (mark as { datum?: { series?: unknown } }).datum?.series === 'string'
  );
}

function isDataLabel(mark: unknown): mark is TextMark {
  return (
    typeof mark === 'object' &&
    mark !== null &&
    (mark as { type?: unknown }).type === 'text' &&
    typeof (mark as { datum?: { series?: unknown } }).datum?.series === 'string'
  );
}

describe('configToSpec bar series colors', () => {
  it('lets per-series imported fills override the primary series fill paint', () => {
    const spec = configToSpec(importedBarConfig(), importedBarData());
    const mark = spec.mark;
    expect(typeof mark).toBe('object');
    expect((mark as { fillField?: string }).fillField).toBe(SERIES_FILL_FIELD);

    const rects = compile(spec).marks.filter(isSeriesRect);

    expect(rects).toHaveLength(4);
    expect(new Set(rects.map((rect) => rect.style.fill))).toEqual(new Set(['#2F75B5', '#70AD47']));
    expect(rects.every((rect) => rect.style.fillPaint === undefined)).toBe(true);
    expect(rects.every((rect) => rect.datum[SERIES_FILL_FIELD] === rect.style.fill)).toBe(true);
  });

  it('renders imported single-series vary-by-category columns with category legend entries', () => {
    const data: ChartData = {
      categories: ['Category A', 'Category B', 'Category C', 'Category D', 'Category E'],
      series: [
        {
          name: 'Measure',
          data: [
            { x: 'Category A', y: 50 },
            { x: 'Category B', y: 40 },
            { x: 'Category C', y: 30 },
            { x: 'Category D', y: 20 },
            { x: 'Category E', y: 10 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'column',
      subType: 'clustered',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      varyByCategories: true,
      legend: { show: true, visible: true, position: 'right' },
      workbookTheme: {
        colors: [
          { name: 'accent1', color: '#4F81BD' },
          { name: 'accent2', color: '#C0504D' },
          { name: 'accent3', color: '#9BBB59' },
          { name: 'accent4', color: '#8064A2' },
          { name: 'accent5', color: '#4BACC6' },
          { name: 'accent6', color: '#F79646' },
        ],
        colorScheme: {
          accent1: { type: 'SrgbClr', val: '4F81BD', transforms: [] },
          accent2: { type: 'SrgbClr', val: 'C0504D', transforms: [] },
          accent3: { type: 'SrgbClr', val: '9BBB59', transforms: [] },
          accent4: { type: 'SrgbClr', val: '8064A2', transforms: [] },
          accent5: { type: 'SrgbClr', val: '4BACC6', transforms: [] },
          accent6: { type: 'SrgbClr', val: 'F79646', transforms: [] },
        },
      },
      series: [
        {
          name: 'Measure',
          idx: 0,
          order: 0,
          format: { line: { dashStyle: 'solid' } },
        },
      ],
    };

    const spec = configToSpec(config, data);
    expect(spec.encoding?.color).toMatchObject({
      field: 'category',
      type: 'nominal',
      scale: {
        domain: ['Category A', 'Category B', 'Category C', 'Category D', 'Category E'],
        range: ['#4F81BD', '#C0504D', '#9BBB59', '#8064A2', '#4BACC6', '#F79646'],
      },
      legend: {
        orient: 'right',
        title: null,
        values: ['Category A', 'Category B', 'Category C', 'Category D', 'Category E'],
      },
    });

    const result = compile(spec, undefined, { width: 640, height: 360 });
    const rects = result.marks.filter(isSeriesRect);
    const legendLabels = result.legends
      .filter((mark): mark is TextMark => mark.type === 'text')
      .map((mark) => mark.text);

    expect(rects).toHaveLength(5);
    expect(rects.map((rect) => rect.style.fill)).toEqual([
      '#4F81BD',
      '#C0504D',
      '#9BBB59',
      '#8064A2',
      '#4BACC6',
    ]);
    expect(legendLabels).toEqual(['Category A', 'Category B', 'Category C', 'Category D', 'Category E']);
    for (const rect of rects) {
      const category = String(rect.datum.category);
      const categoryX = result.scales.x?.(category) as number;
      const bandwidth = result.scales.x?.bandwidth?.() ?? 0;
      expect(rect.x + rect.width / 2).toBeCloseTo(categoryX + bandwidth / 2, 5);
    }
  });

  it('matches Excel horizontal clustered bar series order and data-label slots', () => {
    const categories = Array.from({ length: 11 }, (_value, index) => `Item ${index + 1}`);
    const negativeValues = Array.from({ length: categories.length }, (_value, index) => -(index + 1));
    const positiveValues = Array.from({ length: categories.length }, (_value, index) => index + 1);
    const data: ChartData = {
      categories,
      series: [
        {
          name: 'Negative',
          data: negativeValues.map((y, index) => ({ x: categories[index], y })),
        },
        {
          name: 'Positive',
          data: positiveValues.map((y, index) => ({ x: categories[index], y })),
        },
      ],
    };
    const config: ChartConfig = {
      type: 'bar',
      subType: 'clustered',
      anchorRow: 0,
      anchorCol: 0,
      width: 12,
      height: 8,
      extra: { sourceDialect: 'ooxml' },
      legend: { show: true, visible: true, position: 'top' },
      series: [
        {
          name: 'Negative',
          idx: 0,
          order: 0,
          color: '2F75B5',
          format: {
            fill: { type: 'solid', color: '2F75B5' },
            line: { color: '2F75B5' },
          },
          dataLabels: { show: true, showValue: true, numberFormat: '#,##0.0' },
        },
        {
          name: 'Positive',
          idx: 1,
          order: 1,
          color: '70AD47',
          format: {
            fill: { type: 'solid', color: '70AD47' },
            line: { color: '70AD47' },
          },
          dataLabels: { show: true, showValue: true, numberFormat: '#,##0.0' },
        },
      ],
    };

    const result = compile(configToSpec(config, data), undefined, { width: 800, height: 500 });
    const rects = result.marks
      .filter(isSeriesRect)
      .filter((rect) => rect.datum.category === 'Item 11');
    const labels = result.marks
      .filter(isDataLabel)
      .filter((label) => label.datum.category === 'Item 11');
    const legendLabels = result.legends
      .filter((mark): mark is TextMark => mark.type === 'text')
      .map((mark) => mark.text);
    const legendFills = result.legends
      .filter((mark): mark is RectMark => mark.type === 'rect')
      .map((mark) => mark.style.fill);

    const negativeRect = rects.find((rect) => rect.datum.series === 'Negative')!;
    const positiveRect = rects.find((rect) => rect.datum.series === 'Positive')!;
    const negativeLabel = labels.find((label) => label.datum.series === 'Negative')!;
    const positiveLabel = labels.find((label) => label.datum.series === 'Positive')!;

    expect(result.scales.y?.domain?.()[0]).toBe('Item 11');
    expect(positiveRect.y).toBeLessThan(negativeRect.y);
    expect(positiveLabel.y).toBeCloseTo(positiveRect.y + positiveRect.height / 2, 5);
    expect(negativeLabel.y).toBeCloseTo(negativeRect.y + negativeRect.height / 2, 5);
    expect(positiveLabel.x).toBeGreaterThan(positiveRect.x + positiveRect.width);
    expect(negativeLabel.x).toBeLessThan(negativeRect.x);
    expect(positiveLabel.textAlign).toBe('left');
    expect(negativeLabel.textAlign).toBe('right');
    expect(legendLabels).toEqual(['Positive', 'Negative']);
    expect(legendFills).toEqual(['#70AD47', '#2F75B5']);
  });

  it('aligns clustered column data labels to each series slot', () => {
    const data: ChartData = {
      categories: ['A'],
      series: [
        { name: 'Plan', data: [{ x: 'A', y: 10 }] },
        { name: 'Actual', data: [{ x: 'A', y: 15 }] },
      ],
    };
    const config: ChartConfig = {
      type: 'column',
      subType: 'clustered',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      series: [
        { name: 'Plan', idx: 0, order: 0, dataLabels: { show: true, showValue: true } },
        { name: 'Actual', idx: 1, order: 1, dataLabels: { show: true, showValue: true } },
      ],
    };

    const result = compile(configToSpec(config, data), undefined, {
      width: 500,
      height: 300,
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    const rects = result.marks.filter(isSeriesRect);
    const labels = result.marks.filter(isDataLabel);

    expect(rects).toHaveLength(2);
    expect(labels).toHaveLength(2);
    for (const rect of rects) {
      const label = labels.find((item) => item.datum.series === rect.datum.series)!;
      expect(label.x).toBeCloseTo(rect.x + rect.width / 2, 5);
    }
    expect(labels[0].x).not.toBeCloseTo(labels[1].x, 5);
  });
});
