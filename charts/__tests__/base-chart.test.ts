/**
 * BaseChartBuilder unit tests
 */
import {
  BaseChartBuilder,
  getNumericExtent,
  getUniqueValues,
  inferFieldType,
} from '../src/components/base-chart';
import type { MarkSpec, MarkType } from '../src/grammar/spec';

class TestChartBuilder extends BaseChartBuilder<TestChartBuilder> {
  protected self(): TestChartBuilder {
    return this;
  }
  protected getDefaultMark(): MarkType | MarkSpec {
    return 'bar';
  }
  public exposeSetX(field: string, options?: Record<string, unknown>) {
    return this.setX(field, options);
  }
  public exposeSetY(field: string, options?: Record<string, unknown>) {
    return this.setY(field, options);
  }
  public exposeSetColor(field: string, options?: Record<string, unknown>) {
    return this.setColor(field, options);
  }
  public exposeSetSize(field: string, options?: Record<string, unknown>) {
    return this.setSize(field, options);
  }
  public exposeSetTooltip(fields: string | string[]) {
    return this.setTooltip(fields);
  }
}

describe('BaseChartBuilder: data methods', () => {
  it('data() sets inline data', () => {
    const rows = [{ a: 1 }, { a: 2 }];
    expect(new TestChartBuilder().data(rows).toSpec().data).toEqual({ values: rows });
  });
  it('dataFromRange()', () => {
    expect(new TestChartBuilder().dataFromRange('A1:B10').toSpec().data).toEqual({
      range: 'A1:B10',
    });
  });
});

describe('BaseChartBuilder: dimensions and title', () => {
  it('width/height', () => {
    const s = new TestChartBuilder().width(800).height(600).toSpec();
    expect(s.width).toBe(800);
    expect(s.height).toBe(600);
  });
  it('title string', () => {
    expect(new TestChartBuilder().title('T').toSpec().title).toBe('T');
  });
  it('title object', () => {
    const t = { text: 'H', fontSize: 20 };
    expect(new TestChartBuilder().title(t).toSpec().title).toEqual(t);
  });
  it('description', () => {
    expect(new TestChartBuilder().description('D').toSpec().description).toBe('D');
  });
  it('autosize', () => {
    expect(new TestChartBuilder().autosize('fit').toSpec().autosize).toBe('fit');
  });
});

describe('BaseChartBuilder: theme and config', () => {
  it('theme', () => {
    expect(new TestChartBuilder().theme('dark').toSpec().theme).toBe('dark');
  });
  it('config merges', () => {
    const s = new TestChartBuilder()
      .config({ stack: 'normalize' })
      .config({ background: '#fff' })
      .toSpec();
    expect(s.config).toEqual({ stack: 'normalize', background: '#fff' });
  });
  it('background', () => {
    expect(new TestChartBuilder().background('#000').toSpec().config?.background).toBe('#000');
  });
  it('padding number', () => {
    expect(new TestChartBuilder().padding(10).toSpec().config?.padding).toBe(10);
  });
  it('padding object', () => {
    const p = { top: 5, right: 10, bottom: 15, left: 20 };
    expect(new TestChartBuilder().padding(p).toSpec().config?.padding).toEqual(p);
  });
  it('colorScheme', () => {
    expect(new TestChartBuilder().colorScheme('viridis').toSpec().config?.scheme).toBe('viridis');
  });
  it('colors', () => {
    expect(new TestChartBuilder().colors(['#f00']).toSpec().config?.range?.category).toEqual([
      '#f00',
    ]);
  });
});

describe('BaseChartBuilder: transforms', () => {
  it('transform()', () => {
    const s = new TestChartBuilder()
      .transform({ type: 'filter', filter: { field: 'x', gt: 5 } })
      .toSpec();
    expect(s.transform).toHaveLength(1);
  });
  it('filter()', () => {
    const s = new TestChartBuilder().filter('s', { gte: 10 }).toSpec();
    expect(s.transform![0]).toEqual({ type: 'filter', filter: { field: 's', gte: 10 } });
  });
  it('sortBy()', () => {
    expect(new TestChartBuilder().sortBy('n', 'descending').toSpec().transform![0]).toEqual({
      type: 'sort',
      sort: [{ field: 'n', order: 'descending' }],
    });
  });
  it('sortBy defaults ascending', () => {
    const t = new TestChartBuilder().sortBy('n').toSpec().transform![0] as any;
    expect(t.sort[0].order).toBe('ascending');
  });
  it('multiple transforms', () => {
    const s = new TestChartBuilder()
      .filter('a', { gt: 0 })
      .sortBy('b')
      .transform({ type: 'filter', filter: { field: 'c', equal: 'x' } })
      .toSpec();
    expect(s.transform).toHaveLength(3);
  });
});

describe('BaseChartBuilder: encoding helpers', () => {
  it('setX', () => {
    expect(
      new TestChartBuilder().exposeSetX('c', { type: 'nominal' }).toSpec().encoding?.x,
    ).toEqual({ field: 'c', type: 'nominal' });
  });
  it('setY', () => {
    expect(
      new TestChartBuilder().exposeSetY('v', { type: 'quantitative' }).toSpec().encoding?.y,
    ).toEqual({ field: 'v', type: 'quantitative' });
  });
  it('setColor', () => {
    expect(new TestChartBuilder().exposeSetColor('r').toSpec().encoding?.color).toEqual({
      field: 'r',
    });
  });
  it('setSize', () => {
    expect(new TestChartBuilder().exposeSetSize('p').toSpec().encoding?.size).toEqual({
      field: 'p',
    });
  });
  it('setTooltip string', () => {
    expect(new TestChartBuilder().exposeSetTooltip('n').toSpec().encoding?.tooltip).toEqual({
      field: 'n',
    });
  });
  it('setTooltip array', () => {
    expect(new TestChartBuilder().exposeSetTooltip(['a', 'b']).toSpec().encoding?.tooltip).toEqual([
      { field: 'a' },
      { field: 'b' },
    ]);
  });
});

describe('BaseChartBuilder: axis, legend, scale', () => {
  it('xAxis', () => {
    expect(
      new TestChartBuilder().exposeSetX('c').xAxis({ title: 'C' }).toSpec().encoding?.x?.axis,
    ).toEqual({ title: 'C' });
  });
  it('xAxis null', () => {
    expect(
      new TestChartBuilder().exposeSetX('c').xAxis(null).toSpec().encoding?.x?.axis,
    ).toBeNull();
  });
  it('yAxis', () => {
    expect(
      new TestChartBuilder().exposeSetY('v').yAxis({ grid: true }).toSpec().encoding?.y?.axis,
    ).toEqual({ grid: true });
  });
  it('grid both', () => {
    const s = new TestChartBuilder().exposeSetX('a').exposeSetY('b').grid(true).toSpec();
    expect(s.encoding?.x?.axis).toEqual(expect.objectContaining({ grid: true }));
    expect(s.encoding?.y?.axis).toEqual(expect.objectContaining({ grid: true }));
  });
  it('legend', () => {
    expect(
      new TestChartBuilder().exposeSetColor('s').legend({ orient: 'right' }).toSpec().encoding
        ?.color?.legend,
    ).toEqual({ orient: 'right' });
  });
  it('hideLegend', () => {
    expect(
      new TestChartBuilder().exposeSetColor('s').hideLegend().toSpec().encoding?.color?.legend,
    ).toBeNull();
  });
  it('xScale', () => {
    expect(
      new TestChartBuilder().exposeSetX('x').xScale({ type: 'log' }).toSpec().encoding?.x?.scale,
    ).toEqual({ type: 'log' });
  });
  it('yScale', () => {
    expect(
      new TestChartBuilder().exposeSetY('y').yScale({ nice: true }).toSpec().encoding?.y?.scale,
    ).toEqual({ nice: true });
  });
  it('colorScale', () => {
    expect(
      new TestChartBuilder().exposeSetColor('c').colorScale({ scheme: 'blues' }).toSpec().encoding
        ?.color?.scale,
    ).toEqual({ scheme: 'blues' });
  });
});

describe('BaseChartBuilder: toSpec()', () => {
  it('default mark', () => {
    expect(new TestChartBuilder().toSpec().mark).toBe('bar');
  });
  it('no transform when empty', () => {
    expect(new TestChartBuilder().toSpec().transform).toBeUndefined();
  });
  it('no config when empty', () => {
    expect(new TestChartBuilder().toSpec().config).toBeUndefined();
  });
  it('fluent chaining', () => {
    const b = new TestChartBuilder();
    expect(b.data([]).width(1)).toBe(b);
  });
});

describe('inferFieldType', () => {
  it('empty -> nominal', () => {
    expect(inferFieldType([])).toBe('nominal');
  });
  it('null -> nominal', () => {
    expect(inferFieldType([null, undefined])).toBe('nominal');
  });
  it('numbers -> quantitative', () => {
    expect(inferFieldType([1, 2])).toBe('quantitative');
  });
  it('Date -> temporal', () => {
    expect(inferFieldType([new Date()])).toBe('temporal');
  });
  it('date strings -> temporal', () => {
    expect(inferFieldType(['2024-01-01'])).toBe('temporal');
  });
  it('plain strings -> nominal', () => {
    expect(inferFieldType(['cat'])).toBe('nominal');
  });
  it('numeric strings -> nominal', () => {
    expect(inferFieldType(['123'])).toBe('nominal');
  });
  it('skips nulls', () => {
    expect(inferFieldType([null, 42])).toBe('quantitative');
  });
});

describe('getUniqueValues', () => {
  it('unique', () => {
    const d = [{ c: 'r' }, { c: 'b' }, { c: 'r' }];
    expect(new Set(getUniqueValues(d, 'c'))).toEqual(new Set(['r', 'b']));
  });
  it('ignores missing', () => {
    expect(getUniqueValues([{ a: 1 }, { b: 2 }, { a: 3 }], 'a')).toEqual([1, 3]);
  });
  it('empty', () => {
    expect(getUniqueValues([], 'x')).toEqual([]);
  });
});

describe('getNumericExtent', () => {
  it('[min,max]', () => {
    expect(getNumericExtent([{ v: 3 }, { v: 1 }, { v: 5 }], 'v')).toEqual([1, 5]);
  });
  it('non-numeric ignored', () => {
    expect(getNumericExtent([{ v: 1 }, { v: 'x' }, { v: 3 }], 'v')).toEqual([1, 3]);
  });
  it('Infinity ignored', () => {
    expect(getNumericExtent([{ v: 1 }, { v: Infinity }, { v: 5 }], 'v')).toEqual([1, 5]);
  });
  it('null when no numeric', () => {
    expect(getNumericExtent([{ v: 'a' }], 'v')).toBeNull();
  });
  it('null empty', () => {
    expect(getNumericExtent([], 'v')).toBeNull();
  });
});
