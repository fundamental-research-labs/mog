import type { PathMark, TextMark } from '../../primitives/types';
import { compile } from '../compiler';
import type { ChartSpec } from '../spec';

function datum(mark: { datum?: unknown }): { role?: string; axisPart?: string } {
  return (mark.datum ?? {}) as { role?: string; axisPart?: string };
}

function pathMove(path: string): { x: number; y: number } {
  const match = /^M([^,]+),([^ ]+)/.exec(path);
  if (!match) throw new Error(`Unexpected path: ${path}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe('axis generator render contracts', () => {
  it('renders a secondary top x-axis sharing the primary x scale', () => {
    const spec: ChartSpec = {
      data: {
        values: [
          { category: 'A', value: 1 },
          { category: 'B', value: 2 },
          { category: 'C', value: 3 },
          { category: 'D', value: 4 },
        ],
      },
      mark: 'bar',
      encoding: {
        x: {
          field: 'category',
          type: 'nominal',
          secondaryAxis: {
            orient: 'top',
            title: 'Top Categories',
            tickLabelSkip: 2,
            tickMarkSkip: 3,
          },
        },
        y: { field: 'value', type: 'quantitative' },
      },
      width: 420,
      height: 260,
    };

    const result = compile(spec);
    const topDomain = result.axes.find(
      (mark) => mark.type === 'path' && datum(mark).role === 'x-axis-top' && datum(mark).axisPart === 'domain',
    ) as PathMark | undefined;
    const topLabels = result.axes.filter(
      (mark): mark is TextMark =>
        mark.type === 'text' &&
        datum(mark).role === 'x-axis-top' &&
        datum(mark).axisPart === 'label',
    );
    const topTicks = result.axes.filter(
      (mark) =>
        mark.type === 'path' &&
        datum(mark).role === 'x-axis-top' &&
        datum(mark).axisPart === 'tick',
    );

    expect(topDomain?.path).toContain(`,${result.layout.plotArea.y} L`);
    expect(topLabels.map((label) => label.text)).toEqual(['A', 'C']);
    expect(topTicks).toHaveLength(2);
  });

  it('renders explicit skips, display units, and distinct minor grid/tick streams', () => {
    const spec: ChartSpec = {
      data: {
        values: [
          { category: 'A', value: 0 },
          { category: 'B', value: 1_000 },
          { category: 'C', value: 2_000 },
        ],
      },
      mark: 'line',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: {
          field: 'value',
          type: 'quantitative',
          scale: { domain: [0, 2_000], nice: false },
          axis: {
            tickStep: 1_000,
            minorTickStep: 500,
            minorTicks: true,
            minorTickMark: 'cross',
            minorGrid: true,
            displayUnitFactor: 1_000,
            displayUnitLabel: 'Thousands',
          },
        },
      },
      width: 420,
      height: 260,
    };

    const result = compile(spec);
    const yLabels = result.axes.filter(
      (mark): mark is TextMark =>
        mark.type === 'text' && datum(mark).role === 'y-axis' && datum(mark).axisPart === 'label',
    );
    const minorGrid = result.axes.filter(
      (mark) =>
        mark.type === 'path' &&
        datum(mark).role === 'y-axis' &&
        datum(mark).axisPart === 'minorGrid',
    );
    const minorTicks = result.axes.filter(
      (mark) =>
        mark.type === 'path' &&
        datum(mark).role === 'y-axis' &&
        datum(mark).axisPart === 'minorTick',
    );
    const displayUnitLabel = result.axes.find(
      (mark): mark is TextMark =>
        mark.type === 'text' &&
        datum(mark).role === 'y-axis' &&
        datum(mark).axisPart === 'displayUnitLabel',
    );

    expect(yLabels.map((label) => label.text)).toEqual(['0', '1', '2']);
    expect(minorGrid).toHaveLength(2);
    expect(minorTicks).toHaveLength(2);
    expect(displayUnitLabel?.text).toBe('Thousands');
  });

  it('applies y label rotation and in/out/cross tick direction contracts', () => {
    const spec: ChartSpec = {
      data: {
        values: [
          { x: 0, value: 1 },
          { x: 10, value: 2 },
        ],
      },
      mark: 'line',
      encoding: {
        x: { field: 'x', type: 'quantitative', scale: { domain: [0, 10], nice: false } },
        y: {
          field: 'value',
          type: 'quantitative',
          axis: {
            orient: 'right',
            tickMark: 'in',
            labelAngle: 45,
            crossesAt: 'max',
          },
        },
      },
      width: 420,
      height: 260,
    };

    const result = compile(spec);
    const plotRight = result.layout.plotArea.x + result.layout.plotArea.width;
    const label = result.axes.find(
      (mark): mark is TextMark =>
        mark.type === 'text' &&
        datum(mark).role === 'y-axis-right' &&
        datum(mark).axisPart === 'label',
    );
    const tick = result.axes.find(
      (mark): mark is PathMark =>
        mark.type === 'path' &&
        datum(mark).role === 'y-axis-right' &&
        datum(mark).axisPart === 'tick',
    );

    expect(label?.rotation).toBeCloseTo(Math.PI / 4, 6);
    expect(tick?.path.startsWith(`M${plotRight},`)).toBe(true);
    expect(tick?.path).toContain(` L${plotRight - 6},`);
  });

  it('renders mid-category value-axis crossings on categorical scales', () => {
    const columnSpec: ChartSpec = {
      data: {
        values: [
          { category: 'A', value: 1 },
          { category: 'B', value: 2 },
        ],
      },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: {
          field: 'value',
          type: 'quantitative',
          axis: { categoryCrossing: 'midCat' },
        },
      },
      width: 420,
      height: 260,
    };
    const columnResult = compile(columnSpec);
    const yDomain = columnResult.axes.find(
      (mark): mark is PathMark =>
        mark.type === 'path' &&
        datum(mark).role === 'y-axis' &&
        datum(mark).axisPart === 'domain',
    );
    const firstCategoryCenter =
      (columnResult.scales.x?.('A') as number) + (columnResult.scales.x?.bandwidth?.() ?? 0) / 2;

    expect(pathMove(yDomain?.path ?? '').x).toBeCloseTo(firstCategoryCenter, 6);

    const barSpec: ChartSpec = {
      data: {
        values: [
          { category: 'A', value: 1 },
          { category: 'B', value: 2 },
        ],
      },
      mark: 'bar',
      encoding: {
        x: {
          field: 'value',
          type: 'quantitative',
          axis: { categoryCrossing: 'midCat' },
        },
        y: { field: 'category', type: 'nominal' },
      },
      width: 420,
      height: 260,
    };
    const barResult = compile(barSpec);
    const xDomain = barResult.axes.find(
      (mark): mark is PathMark =>
        mark.type === 'path' &&
        datum(mark).role === 'x-axis' &&
        datum(mark).axisPart === 'domain',
    );
    const lastCategoryCenter =
      (barResult.scales.y?.('B') as number) + (barResult.scales.y?.bandwidth?.() ?? 0) / 2;

    expect(pathMove(xDomain?.path ?? '').y).toBeCloseTo(lastCategoryCenter, 6);
  });
});
