/**
 * Mark generator tests for text, rect, rule, and tick marks
 *
 * These mark generators have zero test coverage in the existing compiler tests.
 * We test them via the compile() function with appropriate mark types.
 */
import { compile } from '../src/grammar/compiler';
import type { ChartSpec, DataRow } from '../src/grammar/spec';

const categoricalData: DataRow[] = [
  { category: 'A', value: 10 },
  { category: 'B', value: 20 },
  { category: 'C', value: 30 },
];

const numericData: DataRow[] = [
  { x: 1, y: 10, label: 'First' },
  { x: 2, y: 20, label: 'Second' },
  { x: 3, y: 30, label: 'Third' },
];

// ---------------------------------------------------------------------------
// Text marks
// ---------------------------------------------------------------------------

describe('generateTextMarks', () => {
  it('produces text marks with mark type text', () => {
    const spec: ChartSpec = {
      mark: 'text',
      data: { values: numericData },
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
        text: { field: 'label' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    expect(result.marks.length).toBe(3);
    for (const mark of result.marks) {
      expect(mark.type).toBe('text');
    }
  });

  it('text marks contain the text content', () => {
    const spec: ChartSpec = {
      mark: 'text',
      data: { values: numericData },
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
        text: { field: 'label' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    const texts = result.marks.filter((m) => m.type === 'text').map((m) => (m as any).text);
    expect(texts).toContain('First');
    expect(texts).toContain('Second');
    expect(texts).toContain('Third');
  });

  it('text marks have default font properties', () => {
    const spec: ChartSpec = {
      mark: 'text',
      data: { values: [{ x: 1, y: 1, label: 'Test' }] },
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
        text: { field: 'label' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    const mark = result.marks[0] as any;
    expect(mark.fontSize).toBeDefined();
    expect(mark.fontFamily).toBeDefined();
    expect(mark.textAlign).toBe('center');
    expect(mark.textBaseline).toBe('middle');
  });

  it('text marks respect fontSize from mark spec', () => {
    const spec: ChartSpec = {
      mark: { type: 'text', fontSize: 24 },
      data: { values: [{ x: 1, y: 1, label: 'Big' }] },
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
        text: { field: 'label' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    expect((result.marks[0] as any).fontSize).toBe(24);
  });

  it('missing text field produces empty string', () => {
    const spec: ChartSpec = {
      mark: 'text',
      data: { values: [{ x: 1, y: 1 }] },
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
        text: { field: 'nonexistent' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    expect((result.marks[0] as any).text).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Rect marks
// ---------------------------------------------------------------------------

describe('generateRectMarks', () => {
  it('produces rect marks with mark type rect', () => {
    const spec: ChartSpec = {
      mark: 'rect',
      data: { values: categoricalData },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'ordinal' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    expect(result.marks.length).toBeGreaterThan(0);
    for (const mark of result.marks) {
      expect(mark.type).toBe('rect');
    }
  });

  it('rect marks have width and height', () => {
    const spec: ChartSpec = {
      mark: 'rect',
      data: { values: categoricalData },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'ordinal' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    for (const mark of result.marks) {
      expect((mark as any).width).toBeGreaterThan(0);
      expect((mark as any).height).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Rule marks
// ---------------------------------------------------------------------------

describe('generateRuleMarks', () => {
  it('vertical rule with x only', () => {
    const spec: ChartSpec = {
      mark: 'rule',
      data: { values: [{ x: 10 }, { x: 20 }] },
      encoding: {
        x: { field: 'x', type: 'quantitative' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    expect(result.marks.length).toBe(2);
    for (const mark of result.marks) {
      expect(mark.type).toBe('path');
      expect((mark as any).path).toContain('M');
      expect((mark as any).path).toContain('L');
    }
  });

  it('horizontal rule with y only', () => {
    const spec: ChartSpec = {
      mark: 'rule',
      data: { values: [{ y: 10 }, { y: 20 }] },
      encoding: {
        y: { field: 'y', type: 'quantitative' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    expect(result.marks.length).toBe(2);
    for (const mark of result.marks) {
      expect(mark.type).toBe('path');
    }
  });

  it('rule with both x and y produces no marks', () => {
    const spec: ChartSpec = {
      mark: 'rule',
      data: { values: [{ x: 1, y: 2 }] },
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    // Rule with both x and y skips the datum in generateRuleMarks (continue)
    expect(result.marks).toHaveLength(0);
  });

  it('rule marks have stroke style', () => {
    const spec: ChartSpec = {
      mark: { type: 'rule', stroke: '#ff0000', strokeWidth: 2 },
      data: { values: [{ x: 15 }] },
      encoding: {
        x: { field: 'x', type: 'quantitative' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    expect(result.marks.length).toBe(1);
    expect(result.marks[0].style.stroke).toBe('#ff0000');
    expect(result.marks[0].style.strokeWidth).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tick marks
// ---------------------------------------------------------------------------

describe('generateTickMarks', () => {
  it('tick with x only (vertical tick)', () => {
    const spec: ChartSpec = {
      mark: 'tick',
      data: { values: [{ x: 10 }, { x: 20 }, { x: 30 }] },
      encoding: {
        x: { field: 'x', type: 'quantitative' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    expect(result.marks.length).toBe(3);
    for (const mark of result.marks) {
      expect(mark.type).toBe('path');
    }
  });

  it('tick with y only (horizontal tick)', () => {
    const spec: ChartSpec = {
      mark: 'tick',
      data: { values: [{ y: 10 }, { y: 20 }] },
      encoding: {
        y: { field: 'y', type: 'quantitative' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    expect(result.marks.length).toBe(2);
  });

  it('tick with both x and y', () => {
    const spec: ChartSpec = {
      mark: 'tick',
      data: {
        values: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    expect(result.marks.length).toBe(2);
  });

  it('tick marks have stroke style', () => {
    const spec: ChartSpec = {
      mark: { type: 'tick', color: '#333', strokeWidth: 2 },
      data: { values: [{ x: 10 }] },
      encoding: {
        x: { field: 'x', type: 'quantitative' },
      },
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    expect(result.marks.length).toBe(1);
    expect(result.marks[0].style.stroke).toBe('#333');
    expect(result.marks[0].style.strokeWidth).toBe(2);
  });

  it('tick with no encodings produces no marks', () => {
    const spec: ChartSpec = {
      mark: 'tick',
      data: { values: [{ z: 1 }] },
      encoding: {},
    };
    const result = compile(spec, undefined, { skipAxes: true, skipLegend: true, skipTitle: true });
    expect(result.marks).toHaveLength(0);
  });
});
