import type { SymbolMark, TextMark } from '../../primitives/types';
import { compile } from '../../grammar/compiler';
import type { UnitSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';
import { BUBBLE_SIZE_FIELD, SCATTER_X_FIELD, VALUE_FIELD } from '../config-to-spec/fields';

function asUnitSpec(config: ChartConfig, data: ChartData): UnitSpec {
  return configToSpec(config, data) as UnitSpec;
}

function specRows(spec: UnitSpec) {
  return spec.data && 'values' in spec.data ? spec.data.values : [];
}

function symbolMarks(config: ChartConfig, data: ChartData): SymbolMark[] {
  return compile(asUnitSpec(config, data)).marks.filter(
    (mark): mark is SymbolMark => mark.type === 'symbol',
  );
}

describe('configToSpec bubble size semantics', () => {
  it.each(['scatter', 'bubble'] as const)(
    'uses non-uniform quantitative x positions for %s charts',
    (type) => {
      const data: ChartData = {
        categories: [1, 2, 10],
        series: [
          {
            name: 'Series 1',
            data: [
              { x: 1, y: 10, size: 10 },
              { x: 2, y: 20, size: 10 },
              { x: 10, y: 30, size: 10 },
            ],
          },
        ],
      };
      const config: ChartConfig = {
        type,
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 5,
      };

      const marks = symbolMarks(config, data).sort((left, right) => left.x - right.x);
      expect(marks).toHaveLength(3);

      const first = marks[0]!;
      const second = marks[1]!;
      const third = marks[2]!;
      const firstGap = second.x - first.x;
      const secondGap = third.x - second.x;

      expect(firstGap).toBeGreaterThan(0);
      expect(secondGap).toBeGreaterThan(firstGap * 4);
    },
  );

  it('uses only renderable bubbles when normalizing width-based size values', () => {
    const data: ChartData = {
      categories: [1, 'not-x'],
      series: [
        {
          name: 'Bubbles',
          data: [
            { x: 1, y: 10, size: 10 },
            { x: 'not-x', y: 20, size: 100 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      sizeRepresents: 'w',
    };

    const spec = asUnitSpec(config, data);
    const rows = specRows(spec);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        [SCATTER_X_FIELD]: 1,
        [VALUE_FIELD]: 10,
        [BUBBLE_SIZE_FIELD]: 10,
      }),
    );
  });

  it('omits non-positive bubbles by default and uses absolute size when negatives are shown', () => {
    const data: ChartData = {
      categories: [1, 2, 3],
      series: [
        {
          name: 'Bubbles',
          data: [
            { x: 1, y: 10, size: -5 },
            { x: 2, y: 20, size: 0 },
            { x: 3, y: 30, size: 15 },
          ],
        },
      ],
    };
    const baseConfig: ChartConfig = {
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
    };

    const defaultRows = specRows(asUnitSpec(baseConfig, data));
    const negativeRows = specRows(asUnitSpec({ ...baseConfig, showNegBubbles: true }, data));

    expect(defaultRows.map((row) => row[SCATTER_X_FIELD])).toEqual([3]);
    expect(negativeRows.map((row) => row[BUBBLE_SIZE_FIELD])).toEqual([5, 0, 15]);
  });

  it('clamps bubbleScale to the OOXML 0-300 size range', () => {
    const data: ChartData = {
      categories: [1],
      series: [{ name: 'Bubbles', data: [{ x: 1, y: 10, size: 10 }] }],
    };

    const oversized = asUnitSpec(
      {
        type: 'bubble',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 5,
        bubbleScale: 500,
      },
      data,
    );
    const undersized = asUnitSpec(
      {
        type: 'bubble',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 5,
        bubbleScale: -50,
      },
      data,
    );

    expect(oversized.encoding?.size?.scale?.range).toEqual([0, 19200]);
    expect(undersized.encoding?.size?.scale?.range).toEqual([0, 0]);
  });

  it('renders imported single-series bubbles with category colors and point legend entries', () => {
    const categories = [39.14, 68.58, 18.47, 91.87, 17.74, 31.66, 15.32, 95.27];
    const data: ChartData = {
      categories,
      series: [
        {
          name: 'Products',
          data: [
            { x: 39.14, y: 127, size: 26875 },
            { x: 68.58, y: 87, size: 36119 },
            { x: 18.47, y: 348, size: 4801 },
            { x: 91.87, y: 159, size: 3457 },
            { x: 17.74, y: 264, size: 5578 },
            { x: 31.66, y: 332, size: 28821 },
            { x: 15.32, y: 339, size: 9113 },
            { x: 95.27, y: 372, size: 42119 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
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
    };

    const spec = asUnitSpec(config, data);
    expect(spec.encoding?.color).toMatchObject({
      field: 'category',
      type: 'nominal',
      scale: {
        domain: categories.map(String),
        range: ['#4F81BD', '#C0504D', '#9BBB59', '#8064A2', '#4BACC6', '#F79646'],
      },
      legend: {
        orient: 'right',
        values: categories.map(String),
        symbolType: 'circle',
      },
    });

    const result = compile(spec, undefined, { width: 854, height: 428 });
    const symbols = result.marks.filter((mark): mark is SymbolMark => mark.type === 'symbol');
    const legendLabels = result.legends
      .filter((mark): mark is TextMark => mark.type === 'text')
      .map((mark) => mark.text);

    expect(symbols.map((mark) => mark.style.fill)).toEqual([
      '#4F81BD',
      '#C0504D',
      '#9BBB59',
      '#8064A2',
      '#4BACC6',
      '#F79646',
      '#4F81BD',
      '#C0504D',
    ]);
    expect(Math.max(...symbols.map((mark) => mark.size))).toBeCloseTo(6400, 5);
    expect(symbols.every((mark) => mark.clip === undefined)).toBe(true);
    expect(legendLabels).toEqual(categories.map(String));
  });
});
