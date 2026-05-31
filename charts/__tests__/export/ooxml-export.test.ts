/**
 * OOXML Export Tests
 *
 * Tests for the main toOOXML function and individual chart type generators.
 */

import {
  canExportToOOXML,
  generateCategoryAxisXML,
  generateLegendEntryXML,
  generateValueAxisXML,
  getOOXMLChartElement,
  ImageFallbackError,
  shouldUseImageFallback,
  toOOXML,
} from '../../src/export';
import { quoteSheetName } from '@mog/spreadsheet-utils';
import { chartDataToRows, configToSpec } from '../../src/core/config-to-spec';
import { sanitizeNumericValue } from '../../src/export/ooxml/shared-xml';
import type { ChartSpec, DataRow } from '../../src/grammar/spec';
import type { ChartData, StoredChartConfig } from '../../src/types';

// =============================================================================
// Test Data
// =============================================================================

const SAMPLE_CATEGORY_DATA: DataRow[] = [
  { category: 'A', value: 10 },
  { category: 'B', value: 20 },
  { category: 'C', value: 15 },
];

const SAMPLE_GROUPED_DATA: DataRow[] = [
  { category: 'Q1', product: 'Widget', sales: 100 },
  { category: 'Q1', product: 'Gadget', sales: 150 },
  { category: 'Q2', product: 'Widget', sales: 120 },
  { category: 'Q2', product: 'Gadget', sales: 180 },
];

const SAMPLE_XY_DATA: DataRow[] = [
  { x: 1, y: 2 },
  { x: 2, y: 4 },
  { x: 3, y: 3 },
  { x: 4, y: 5 },
];

const SAMPLE_PIE_DATA: DataRow[] = [
  { category: 'Apples', count: 30 },
  { category: 'Oranges', count: 25 },
  { category: 'Bananas', count: 20 },
  { category: 'Grapes', count: 15 },
];

// =============================================================================
// toOOXML Tests
// =============================================================================

describe('toOOXML', () => {
  describe('bar chart', () => {
    it('generates valid XML for simple bar chart', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

      expect(result.chartXml).toBeDefined();
      expect(result.chartXml).toContain('<?xml version="1.0"');
      expect(result.chartXml).toContain('<c:chartSpace');
      expect(result.chartXml).toContain('<c:barChart>');
      expect(result.chartXml).toContain('<c:barDir val="col"/>');
      expect(result.chartXml).toContain('<c:grouping val="clustered"/>');
    });

    it('generates stacked bar chart', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'sales', type: 'quantitative' },
          color: { field: 'product', type: 'nominal' },
        },
        config: { stack: 'zero' },
      };

      const result = toOOXML(spec, SAMPLE_GROUPED_DATA);

      expect(result.chartXml).toContain('<c:grouping val="stacked"/>');
    });

    it('generates percent stacked bar chart', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'sales', type: 'quantitative' },
          color: { field: 'product', type: 'nominal' },
        },
        config: { stack: 'normalize' },
      };

      const result = toOOXML(spec, SAMPLE_GROUPED_DATA);

      expect(result.chartXml).toContain('<c:grouping val="percentStacked"/>');
    });

    it('generates horizontal bar chart when x is quantitative', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        encoding: {
          x: { field: 'value', type: 'quantitative' },
          y: { field: 'category', type: 'nominal' },
        },
      };

      const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

      expect(result.chartXml).toContain('<c:barDir val="bar"/>');
    });

    it('includes title when specified', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        title: 'Sales by Category',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

      expect(result.chartXml).toContain('<c:title>');
      expect(result.chartXml).toContain('Sales by Category');
    });
  });

  describe('line chart', () => {
    it('generates valid XML for line chart', () => {
      const spec: ChartSpec = {
        mark: 'line',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

      expect(result.chartXml).toContain('<c:lineChart>');
      expect(result.chartXml).toContain('<c:grouping val="standard"/>');
    });

    it('generates smooth line when interpolate is monotone', () => {
      const spec: ChartSpec = {
        mark: { type: 'line', interpolate: 'monotone' },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

      expect(result.chartXml).toContain('<c:smooth val="1"/>');
    });

    it('exports chart-level blank and hidden-cell settings from configToSpec', () => {
      const data: ChartData = {
        categories: ['A', 'B', 'C'],
        series: [
          {
            name: 'Series 1',
            data: [
              { x: 'A', y: 10 },
              { x: 'B', y: 0, valueState: 'blank' },
              { x: 'C', y: 30 },
            ],
          },
        ],
      };
      const config: StoredChartConfig = {
        id: 'blank-export-test',
        type: 'line',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 5,
        displayBlanksAs: 'span',
        plotVisibleOnly: false,
      };

      const spec = configToSpec(config, data);
      const rows = chartDataToRows(data, config);
      const result = toOOXML(spec, rows);

      expect(spec.config).toMatchObject({
        displayBlanksAs: 'span',
        plotVisibleOnly: false,
      });
      expect(result.chartXml).toContain('<c:plotVisOnly val="0"/>');
      expect(result.chartXml).toContain('<c:dispBlanksAs val="span"/>');
    });
  });

  describe('pie chart', () => {
    it('generates valid XML for pie chart', () => {
      const spec: ChartSpec = {
        mark: 'arc',
        encoding: {
          color: { field: 'category', type: 'nominal' },
          theta: { field: 'count', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_PIE_DATA);

      expect(result.chartXml).toContain('<c:pieChart>');
      expect(result.chartXml).toContain('<c:varyColors val="1"/>');
      // Pie charts don't have axes
      expect(result.chartXml).not.toContain('<c:catAx>');
    });

    it('generates doughnut chart when innerRadius is set', () => {
      const spec: ChartSpec = {
        mark: { type: 'arc', innerRadius: 0.5 },
        encoding: {
          color: { field: 'category', type: 'nominal' },
          theta: { field: 'count', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_PIE_DATA);

      expect(result.chartXml).toContain('<c:doughnutChart>');
      expect(result.chartXml).toContain('<c:holeSize val="50"/>');
    });
  });

  describe('scatter chart', () => {
    it('generates valid XML for scatter chart', () => {
      const spec: ChartSpec = {
        mark: 'point',
        encoding: {
          x: { field: 'x', type: 'quantitative' },
          y: { field: 'y', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_XY_DATA);

      expect(result.chartXml).toContain('<c:scatterChart>');
      expect(result.chartXml).toContain('<c:xVal>');
      expect(result.chartXml).toContain('<c:yVal>');
    });

    it('generates bubble chart when size encoding is present', () => {
      const bubbleData: DataRow[] = [
        { x: 1, y: 2, size: 10 },
        { x: 2, y: 4, size: 20 },
        { x: 3, y: 3, size: 15 },
      ];

      const spec: ChartSpec = {
        mark: 'point',
        encoding: {
          x: { field: 'x', type: 'quantitative' },
          y: { field: 'y', type: 'quantitative' },
          size: { field: 'size', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, bubbleData);

      expect(result.chartXml).toContain('<c:bubbleChart>');
      expect(result.chartXml).toContain('<c:bubbleSize>');
    });
  });

  describe('area chart', () => {
    it('generates valid XML for area chart', () => {
      const spec: ChartSpec = {
        mark: 'area',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

      expect(result.chartXml).toContain('<c:areaChart>');
      expect(result.chartXml).toContain('<c:grouping val="standard"/>');
    });
  });

  describe('box plot', () => {
    it('throws ImageFallbackError for box-whisker charts', () => {
      const boxData: DataRow[] = [
        { category: 'A', value: 10 },
        { category: 'A', value: 20 },
        { category: 'A', value: 15 },
        { category: 'A', value: 25 },
        { category: 'A', value: 18 },
      ];

      const spec: ChartSpec = {
        mark: 'boxplot',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      expect(() => toOOXML(spec, boxData)).toThrow(ImageFallbackError);
    });
  });

  describe('error handling', () => {
    it('throws for unsupported chart types', () => {
      const spec: ChartSpec = {
        mark: 'violin',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      expect(() => toOOXML(spec, SAMPLE_CATEGORY_DATA)).toThrow(ImageFallbackError);
    });

    it('throws when mark is missing', () => {
      const spec: ChartSpec = {
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      } as ChartSpec;

      expect(() => toOOXML(spec, SAMPLE_CATEGORY_DATA)).toThrow('must have a mark type');
    });
  });
});

function stockConfig(subType: StoredChartConfig['subType']): StoredChartConfig {
  return {
    id: 'stock-export-test',
    type: 'stock',
    subType,
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 5,
  };
}

// =============================================================================
// canExportToOOXML Tests
// =============================================================================

describe('canExportToOOXML', () => {
  it('returns true for supported chart types', () => {
    const specs: ChartSpec[] = [
      { mark: 'bar', encoding: { x: { field: 'x' }, y: { field: 'y' } } },
      { mark: 'line', encoding: { x: { field: 'x' }, y: { field: 'y' } } },
      { mark: 'arc', encoding: { color: { field: 'c' }, theta: { field: 't' } } },
      { mark: 'point', encoding: { x: { field: 'x' }, y: { field: 'y' } } },
      { mark: 'area', encoding: { x: { field: 'x' }, y: { field: 'y' } } },
    ];

    for (const spec of specs) {
      expect(canExportToOOXML(spec)).toBe(true);
    }
  });

  it('returns false for unsupported chart types', () => {
    const spec: ChartSpec = {
      mark: 'violin',
      encoding: { x: { field: 'x' }, y: { field: 'y' } },
    };

    expect(canExportToOOXML(spec)).toBe(false);
  });

  it('returns true for box-whisker charts (supported via bar chart format)', () => {
    const spec: ChartSpec = {
      mark: 'boxplot',
      encoding: { x: { field: 'x' }, y: { field: 'y' } },
    };

    expect(canExportToOOXML(spec)).toBe(true);
  });

  it('returns false for complex layered charts', () => {
    const spec: ChartSpec = {
      layer: [
        { mark: 'bar', encoding: { x: { field: 'x' }, y: { field: 'y' } } },
        { mark: 'line', encoding: { x: { field: 'x' }, y: { field: 'y' } } },
        { mark: 'point', encoding: { x: { field: 'x' }, y: { field: 'y' } } },
      ],
    };

    expect(canExportToOOXML(spec)).toBe(false);
  });
});

// =============================================================================
// getOOXMLChartElement Tests
// =============================================================================

describe('getOOXMLChartElement', () => {
  it('returns correct element names for supported types', () => {
    expect(getOOXMLChartElement({ mark: 'bar' })).toBe('barChart');
    expect(getOOXMLChartElement({ mark: 'line' })).toBe('lineChart');
    expect(getOOXMLChartElement({ mark: 'area' })).toBe('areaChart');
    expect(getOOXMLChartElement({ mark: 'arc' })).toBe('pieChart');
    expect(getOOXMLChartElement({ mark: 'point' })).toBe('scatterChart');
  });

  it('returns barChart for boxplot (uses extended bar chart format)', () => {
    expect(getOOXMLChartElement({ mark: 'boxplot' })).toBe('barChart');
  });

  it('returns doughnutChart for arc with innerRadius', () => {
    expect(getOOXMLChartElement({ mark: { type: 'arc', innerRadius: 0.5 } })).toBe('doughnutChart');
  });

  it('returns bubbleChart for point with size encoding', () => {
    expect(
      getOOXMLChartElement({
        mark: 'point',
        encoding: { size: { field: 'size' } },
      }),
    ).toBe('bubbleChart');
  });

  it('returns null for unsupported types', () => {
    expect(getOOXMLChartElement({ mark: 'violin' })).toBe(null);
  });
});

// =============================================================================
// shouldUseImageFallback Tests
// =============================================================================

describe('shouldUseImageFallback', () => {
  it('returns true for violin plots', () => {
    expect(shouldUseImageFallback({ mark: 'violin' })).toBe(true);
  });

  it('returns false for box-whisker charts (supported via bar chart format)', () => {
    expect(shouldUseImageFallback({ mark: 'boxplot' })).toBe(false);
  });

  it('returns true for complex layered charts', () => {
    expect(
      shouldUseImageFallback({
        layer: [{ mark: 'bar' }, { mark: 'line' }, { mark: 'point' }],
      }),
    ).toBe(true);
  });

  it('returns true for heatmaps (rect with color)', () => {
    expect(
      shouldUseImageFallback({
        mark: 'rect',
        encoding: { color: { field: 'value' } },
      }),
    ).toBe(true);
  });

  it('returns true for density transforms', () => {
    expect(
      shouldUseImageFallback({
        mark: 'area',
        transform: [{ type: 'density', density: 'value' }],
      }),
    ).toBe(true);
  });

  it('returns false for simple supported charts', () => {
    expect(shouldUseImageFallback({ mark: 'bar' })).toBe(false);
    expect(shouldUseImageFallback({ mark: 'line' })).toBe(false);
    expect(shouldUseImageFallback({ mark: 'arc' })).toBe(false);
  });
});

// =============================================================================
// XML Structure Tests
// =============================================================================

describe('XML Structure', () => {
  it('includes proper XML namespaces', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

    expect(result.chartXml).toContain('xmlns:c=');
    expect(result.chartXml).toContain('xmlns:a=');
    expect(result.chartXml).toContain('xmlns:r=');
  });

  it('includes proper chart container elements', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

    expect(result.chartXml).toContain('<c:chartSpace');
    expect(result.chartXml).toContain('<c:chart>');
    expect(result.chartXml).toContain('<c:plotArea>');
    expect(result.chartXml).toContain('</c:chartSpace>');
  });

  it('escapes special characters in data', () => {
    const dataWithSpecialChars: DataRow[] = [
      { category: 'A & B', value: 10 },
      { category: 'C < D', value: 20 },
    ];

    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = toOOXML(spec, dataWithSpecialChars);

    expect(result.chartXml).toContain('A &amp; B');
    expect(result.chartXml).toContain('C &lt; D');
    expect(result.chartXml).not.toContain('A & B');
    expect(result.chartXml).not.toContain('C < D');
  });
});

// =============================================================================
// Title XML Escaping Tests
// =============================================================================

describe('title XML escaping', () => {
  const BASE_ENCODING = {
    x: { field: 'category', type: 'nominal' as const },
    y: { field: 'value', type: 'quantitative' as const },
  };

  it('escapes ampersand in title', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      title: 'Sales & Revenue',
      encoding: BASE_ENCODING,
    };

    const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

    expect(result.chartXml).toContain('<c:title>');
    expect(result.chartXml).toContain('Sales &amp; Revenue');
    // The bare & must not appear in the title text (would be invalid XML)
    expect(result.chartXml).not.toMatch(/<a:t>[^<]*Sales & Revenue[^<]*<\/a:t>/);
  });

  it('escapes angle brackets in title', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      title: 'Values < 100 > 50',
      encoding: BASE_ENCODING,
    };

    const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

    expect(result.chartXml).toContain('<c:title>');
    expect(result.chartXml).toContain('Values &lt; 100 &gt; 50');
    expect(result.chartXml).not.toMatch(/<a:t>[^<]*Values < 100[^<]*<\/a:t>/);
  });

  it('escapes double quotes in title', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      title: 'The "Best" Chart',
      encoding: BASE_ENCODING,
    };

    const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

    expect(result.chartXml).toContain('<c:title>');
    expect(result.chartXml).toContain('The &quot;Best&quot; Chart');
    expect(result.chartXml).not.toMatch(/<a:t>[^<]*The "Best" Chart[^<]*<\/a:t>/);
  });

  it('escapes all special XML characters in title', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      title: 'A & B < C > D',
      encoding: BASE_ENCODING,
    };

    const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

    expect(result.chartXml).toContain('<c:title>');
    expect(result.chartXml).toContain('A &amp; B &lt; C &gt; D');
    expect(result.chartXml).not.toMatch(/<a:t>[^<]*A & B[^<]*<\/a:t>/);
  });

  it('escapes apostrophe in title', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      title: "Tom's Chart",
      encoding: BASE_ENCODING,
    };

    const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

    expect(result.chartXml).toContain('<c:title>');
    // Both &apos; and &#39; are valid XML escapes for apostrophe
    const xml = result.chartXml;
    const hasEscapedApostrophe =
      xml.includes('Tom&apos;s Chart') || xml.includes('Tom&#39;s Chart');
    expect(hasEscapedApostrophe).toBe(true);
    expect(result.chartXml).not.toMatch(/<a:t>[^<]*Tom's Chart[^<]*<\/a:t>/);
  });
});

// =============================================================================
// Axis Title XML Escaping Tests
// =============================================================================

describe('axis title XML escaping', () => {
  it('escapes ampersand in category axis title', () => {
    const xml = generateCategoryAxisXML({ field: 'x', type: 'nominal', title: 'A & B' }, 1, 2);

    expect(xml).toContain('<c:title>');
    expect(xml).toContain('A &amp; B');
    expect(xml).not.toMatch(/<a:t>[^<]*A & B[^<]*<\/a:t>/);
  });

  it('escapes angle brackets in category axis title', () => {
    const xml = generateCategoryAxisXML(
      { field: 'x', type: 'nominal', title: 'Values < 100 > 50' },
      1,
      2,
    );

    expect(xml).toContain('Values &lt; 100 &gt; 50');
    expect(xml).not.toMatch(/<a:t>[^<]*Values < 100[^<]*<\/a:t>/);
  });

  it('escapes special characters in value axis title', () => {
    const xml = generateValueAxisXML(
      { field: 'y', type: 'quantitative', title: 'Revenue & "Profit"' },
      2,
      1,
    );

    expect(xml).toContain('<c:title>');
    expect(xml).toContain('Revenue &amp; &quot;Profit&quot;');
    expect(xml).not.toMatch(/<a:t>[^<]*Revenue & "Profit"[^<]*<\/a:t>/);
  });

  it('escapes all special XML characters in axis title', () => {
    const xml = generateCategoryAxisXML(
      { field: 'x', type: 'nominal', title: '<A> & "B" & \'C\'' },
      1,
      2,
    );

    expect(xml).toContain('&lt;A&gt; &amp; &quot;B&quot; &amp; &apos;C&apos;');
  });
});

// =============================================================================
// Legend Entry Text XML Escaping Tests
// =============================================================================

describe('legend entry text XML escaping', () => {
  it('escapes ampersand in legend entry text', () => {
    const xml = generateLegendEntryXML(0, { text: 'Sales & Revenue' });

    expect(xml).toContain('Sales &amp; Revenue');
    expect(xml).not.toMatch(/<a:t>[^<]*Sales & Revenue[^<]*<\/a:t>/);
  });

  it('escapes angle brackets in legend entry text', () => {
    const xml = generateLegendEntryXML(0, { text: 'Values < 100 > 50' });

    expect(xml).toContain('Values &lt; 100 &gt; 50');
    expect(xml).not.toMatch(/<a:t>[^<]*Values < 100[^<]*<\/a:t>/);
  });

  it('escapes all special XML characters in legend entry text', () => {
    const xml = generateLegendEntryXML(1, { text: '<A> & "B" & \'C\'' });

    expect(xml).toContain('&lt;A&gt; &amp; &quot;B&quot; &amp; &apos;C&apos;');
  });
});

// =============================================================================
// Sheet Name Quoting Tests
// =============================================================================

describe('quoteSheetName', () => {
  it('does not quote simple alphanumeric names', () => {
    expect(quoteSheetName('Sheet1')).toBe('Sheet1');
    expect(quoteSheetName('Data')).toBe('Data');
    expect(quoteSheetName('Sales_2024')).toBe('Sales_2024');
  });

  it('quotes names with spaces', () => {
    expect(quoteSheetName('Sheet 1')).toBe("'Sheet 1'");
    expect(quoteSheetName('My Data Sheet')).toBe("'My Data Sheet'");
  });

  it('quotes names starting with a digit', () => {
    expect(quoteSheetName('2024 Data')).toBe("'2024 Data'");
    expect(quoteSheetName('1st Quarter')).toBe("'1st Quarter'");
  });

  it('quotes names with special characters', () => {
    expect(quoteSheetName('Sales & Revenue')).toBe("'Sales & Revenue'");
    expect(quoteSheetName('Q1-2024')).toBe("'Q1-2024'");
    expect(quoteSheetName('Sheet (1)')).toBe("'Sheet (1)'");
  });

  it('escapes single quotes within sheet names', () => {
    expect(quoteSheetName("Tom's Data")).toBe("'Tom''s Data'");
    expect(quoteSheetName("It's a 'test'")).toBe("'It''s a ''test'''");
  });

  it('produces correctly quoted references in bar chart XML', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const data: DataRow[] = [
      { category: 'A', value: 10 },
      { category: 'B', value: 20 },
    ];

    const result = toOOXML(spec, data, { sheetName: 'Sheet 1' });

    expect(result.chartXml).toContain("'Sheet 1'!");
    expect(result.chartXml).not.toMatch(/[^']Sheet 1!/);
  });
});

// =============================================================================
// NaN/Infinity Guard Tests
// =============================================================================

describe('sanitizeNumericValue', () => {
  it('returns finite numbers unchanged', () => {
    expect(sanitizeNumericValue(0)).toBe(0);
    expect(sanitizeNumericValue(42)).toBe(42);
    expect(sanitizeNumericValue(-17.5)).toBe(-17.5);
    expect(sanitizeNumericValue(0.001)).toBe(0.001);
  });

  it('replaces NaN with 0', () => {
    expect(sanitizeNumericValue(NaN)).toBe(0);
  });

  it('replaces Infinity with 0', () => {
    expect(sanitizeNumericValue(Infinity)).toBe(0);
    expect(sanitizeNumericValue(-Infinity)).toBe(0);
  });
});

describe('NaN/Infinity in chart XML', () => {
  it('bar chart does not emit NaN or Infinity in XML', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const data: DataRow[] = [
      { category: 'A', value: NaN },
      { category: 'B', value: Infinity },
      { category: 'C', value: -Infinity },
      { category: 'D', value: 42 },
    ];

    const result = toOOXML(spec, data);

    expect(result.chartXml).not.toContain('<c:v>NaN</c:v>');
    expect(result.chartXml).not.toContain('<c:v>Infinity</c:v>');
    expect(result.chartXml).not.toContain('<c:v>-Infinity</c:v>');
    expect(result.chartXml).toContain('<c:v>42</c:v>');
  });

  it('line chart does not emit NaN or Infinity in XML', () => {
    const spec: ChartSpec = {
      mark: 'line',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const data: DataRow[] = [
      { category: 'A', value: NaN },
      { category: 'B', value: Infinity },
      { category: 'C', value: 10 },
    ];

    const result = toOOXML(spec, data);

    expect(result.chartXml).not.toContain('<c:v>NaN</c:v>');
    expect(result.chartXml).not.toContain('<c:v>Infinity</c:v>');
  });

  it('scatter chart does not emit NaN or Infinity in XML', () => {
    const spec: ChartSpec = {
      mark: 'point',
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
      },
    };

    const data: DataRow[] = [
      { x: NaN, y: 5 },
      { x: 3, y: Infinity },
      { x: 1, y: 2 },
    ];

    const result = toOOXML(spec, data);

    expect(result.chartXml).not.toContain('<c:v>NaN</c:v>');
    expect(result.chartXml).not.toContain('<c:v>Infinity</c:v>');
  });

  it('pie chart does not emit NaN or Infinity in XML', () => {
    const spec: ChartSpec = {
      mark: 'arc',
      encoding: {
        color: { field: 'category', type: 'nominal' },
        theta: { field: 'count', type: 'quantitative' },
      },
    };

    const data: DataRow[] = [
      { category: 'A', count: NaN },
      { category: 'B', count: Infinity },
      { category: 'C', count: 30 },
    ];

    const result = toOOXML(spec, data);

    expect(result.chartXml).not.toContain('<c:v>NaN</c:v>');
    expect(result.chartXml).not.toContain('<c:v>Infinity</c:v>');
  });
});

// =============================================================================
// XML Well-Formedness Validation Tests
// =============================================================================

// =============================================================================
// toOOXML Dropped Properties Tests
// =============================================================================

describe('toOOXML dropped properties', () => {
  describe('smooth line flag from interpolate', () => {
    it('sets smooth=1 for monotone interpolation on line chart', () => {
      const spec: ChartSpec = {
        mark: { type: 'line', interpolate: 'monotone' },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

      expect(result.chartXml).toContain('<c:smooth val="1"/>');
    });

    it('sets smooth=0 for step interpolation on line chart', () => {
      const spec: ChartSpec = {
        mark: { type: 'line', interpolate: 'step' },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

      expect(result.chartXml).toContain('<c:smooth val="0"/>');
    });
  });

  describe('subtitle in title', () => {
    it('includes subtitle as second paragraph in title rich text', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        title: { text: 'Main Title', subtitle: 'Sub Title' },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

      expect(result.chartXml).toContain('Main Title');
      expect(result.chartXml).toContain('Sub Title');
      // The subtitle should be in a separate <a:p> element
      const titleMatch = result.chartXml.match(/<c:title>[\s\S]*?<\/c:title>/);
      expect(titleMatch).not.toBeNull();
      // Count number of <a:p> elements in the title (should be 2: title + subtitle)
      const paragraphCount = (titleMatch![0].match(/<a:p>/g) || []).length;
      expect(paragraphCount).toBe(2);
    });
  });
});

// =============================================================================
// Radar and Stock Chart Export Tests
// =============================================================================

describe('Radar and stock chart export', () => {
  describe('radar chart export', () => {
    it('generates radarChart XML for linear-closed line mark', () => {
      const spec: ChartSpec = {
        mark: { type: 'line', interpolate: 'linear-closed', point: true },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

      expect(result.chartXml).toContain('<c:radarChart>');
      expect(result.chartXml).toContain('<c:radarStyle val="marker"/>');
    });

    it('generates filled radar for area mark with linear-closed', () => {
      const spec: ChartSpec = {
        mark: { type: 'area', interpolate: 'linear-closed' },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

      expect(result.chartXml).toContain('<c:radarChart>');
      expect(result.chartXml).toContain('<c:radarStyle val="filled"/>');
    });

    it('radar chart XML is well-formed', () => {
      const spec: ChartSpec = {
        mark: { type: 'line', interpolate: 'linear-closed' },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);

      expect(result.chartXml).toContain('<?xml version="1.0"');
      expect(result.chartXml).toContain('<c:chartSpace');
      expect(result.chartXml).toContain('</c:chartSpace>');
    });
  });

  describe('stock chart export', () => {
    const stockHLCData: DataRow[] = [
      { category: 'Jan', high: 110, low: 90, close: 105 },
      { category: 'Feb', high: 120, low: 95, close: 115 },
    ];

    const stockOHLCData: DataRow[] = [
      { category: 'Jan', open: 95, high: 110, low: 90, close: 105 },
      { category: 'Feb', open: 105, high: 120, low: 95, close: 115 },
    ];

    const stockVolumeHLCData: DataRow[] = [
      { category: 'Jan', volume: 1000, high: 110, low: 90, close: 105 },
      { category: 'Feb', volume: 1500, high: 120, low: 95, close: 115 },
    ];

    const stockVolumeOHLCData: DataRow[] = [
      { category: 'Jan', volume: 1000, open: 95, high: 110, low: 90, close: 105 },
      { category: 'Feb', volume: 1500, open: 105, high: 120, low: 95, close: 115 },
    ];

    const productionVolumeStockData: ChartData = {
      categories: ['Jan', 'Feb'],
      series: [
        {
          name: 'Stock',
          data: [
            { x: 'Jan', y: 105, volume: 1000, open: 95, high: 110, low: 90, close: 105 },
            { x: 'Feb', y: 115, volume: 1500, open: 105, high: 120, low: 95, close: 115 },
          ],
        },
      ],
    };

    it('generates HLC stock chart (3 series) when no open field', () => {
      const spec: ChartSpec = {
        mark: 'rule',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, stockHLCData);

      expect(result.chartXml).toContain('<c:stockChart>');
      expect(result.chartXml).toContain('<c:v>High</c:v>');
      expect(result.chartXml).toContain('<c:v>Low</c:v>');
      expect(result.chartXml).toContain('<c:v>Close</c:v>');
      // Should NOT have Open series
      expect(result.chartXml).not.toContain('<c:v>Open</c:v>');
    });

    it('generates OHLC stock chart (4 series) when open field present', () => {
      const spec: ChartSpec = {
        mark: 'rule',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, stockOHLCData);

      expect(result.chartXml).toContain('<c:stockChart>');
      expect(result.chartXml).toContain('<c:v>Open</c:v>');
      expect(result.chartXml).toContain('<c:v>High</c:v>');
      expect(result.chartXml).toContain('<c:v>Low</c:v>');
      expect(result.chartXml).toContain('<c:v>Close</c:v>');
    });

    it('stock chart XML is well-formed', () => {
      const spec: ChartSpec = {
        mark: 'rule',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, stockOHLCData);

      expect(result.chartXml).toContain('<?xml version="1.0"');
      expect(result.chartXml).toContain('<c:chartSpace');
      expect(result.chartXml).toContain('</c:chartSpace>');
    });

    it('generates volume-HLC stock combo with a volume bar chart group', () => {
      const spec: ChartSpec = {
        mark: 'rule',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, stockVolumeHLCData);
      const barChartIndex = result.chartXml.indexOf('<c:barChart>');
      const stockChartIndex = result.chartXml.indexOf('<c:stockChart>');

      expect(barChartIndex).toBeGreaterThanOrEqual(0);
      expect(stockChartIndex).toBeGreaterThan(barChartIndex);
      expect(result.chartXml.match(/<c:barChart>/g)).toHaveLength(1);
      expect(result.chartXml.match(/<c:stockChart>/g)).toHaveLength(1);
      expect(result.chartXml).toContain('<c:v>Volume</c:v>');
      expect(result.chartXml).not.toContain('<c:v>Open</c:v>');
      expect(result.chartXml).toContain('<c:v>High</c:v>');
      expect(result.chartXml).toContain('<c:v>Low</c:v>');
      expect(result.chartXml).toContain('<c:v>Close</c:v>');
      expect(result.chartXml).toContain('<c:f>Sheet1!$B$2:$B$3</c:f>');
      expect(result.chartXml).toContain('<c:f>Sheet1!$E$2:$E$3</c:f>');
      expect(result.chartXml.match(/<c:catAx>/g)).toHaveLength(2);
      expect(result.chartXml.match(/<c:valAx>/g)).toHaveLength(2);
    });

    it('generates volume-OHLC stock combo without treating volume as a stock series', () => {
      const spec: ChartSpec = {
        mark: 'rule',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };

      const result = toOOXML(spec, stockVolumeOHLCData);
      const barXml = result.chartXml.slice(
        result.chartXml.indexOf('<c:barChart>'),
        result.chartXml.indexOf('</c:barChart>'),
      );
      const stockXml = result.chartXml.slice(
        result.chartXml.indexOf('<c:stockChart>'),
        result.chartXml.indexOf('</c:stockChart>'),
      );

      expect(barXml.match(/<c:ser>/g)).toHaveLength(1);
      expect(barXml).toContain('<c:v>Volume</c:v>');
      expect(barXml).toContain('<c:f>Sheet1!$B$2:$B$3</c:f>');
      expect(stockXml.match(/<c:ser>/g)).toHaveLength(4);
      expect(stockXml).not.toContain('<c:v>Volume</c:v>');
      expect(stockXml).toContain('<c:v>Open</c:v>');
      expect(stockXml).toContain('<c:v>High</c:v>');
      expect(stockXml).toContain('<c:v>Low</c:v>');
      expect(stockXml).toContain('<c:v>Close</c:v>');
      expect(stockXml).toContain('<c:f>Sheet1!$C$2:$C$3</c:f>');
      expect(stockXml).toContain('<c:f>Sheet1!$F$2:$F$3</c:f>');
    });

    it('exports production volume-HLC layer specs natively instead of image fallback', () => {
      const config = stockConfig('volume-hlc' as any);
      const spec = configToSpec(config, productionVolumeStockData);
      const rows = chartDataToRows(productionVolumeStockData, config);

      expect(shouldUseImageFallback(spec)).toBe(false);
      expect(canExportToOOXML(spec)).toBe(true);
      expect(getOOXMLChartElement(spec)).toBe('stockChart');

      const result = toOOXML(spec, rows);

      expect(result.chartXml).toContain('<c:barChart>');
      expect(result.chartXml).toContain('<c:stockChart>');
      expect(result.chartXml).toContain('<c:v>Volume</c:v>');
      expect(result.chartXml).not.toContain('<c:v>Open</c:v>');
      expect(result.chartXml).toContain('<c:v>High</c:v>');
      expect(result.chartXml).toContain('<c:v>Low</c:v>');
      expect(result.chartXml).toContain('<c:v>Close</c:v>');
    });

    it('exports production volume-OHLC layer specs natively instead of image fallback', () => {
      const config = stockConfig('volume-ohlc' as any);
      const spec = configToSpec(config, productionVolumeStockData);
      const rows = chartDataToRows(productionVolumeStockData, config);

      expect(shouldUseImageFallback(spec)).toBe(false);
      expect(canExportToOOXML(spec)).toBe(true);
      expect(getOOXMLChartElement(spec)).toBe('stockChart');

      const result = toOOXML(spec, rows);

      expect(result.chartXml).toContain('<c:barChart>');
      expect(result.chartXml).toContain('<c:stockChart>');
      expect(result.chartXml).toContain('<c:v>Volume</c:v>');
      expect(result.chartXml).toContain('<c:v>Open</c:v>');
      expect(result.chartXml).toContain('<c:v>High</c:v>');
      expect(result.chartXml).toContain('<c:v>Low</c:v>');
      expect(result.chartXml).toContain('<c:v>Close</c:v>');
    });
  });
});

// =============================================================================
// Trendline OOXML Export Tests
// =============================================================================

describe('Trendline OOXML export', () => {
  it('generates linear trendline XML', () => {
    const { generateTrendlineXML } = require('../../src/export/ooxml/shared-xml');

    const xml = generateTrendlineXML({
      type: 'linear',
      dispEq: false,
      dispRSqr: false,
    });

    expect(xml).toContain('<c:trendline>');
    expect(xml).toContain('<c:trendlineType val="linear"/>');
    expect(xml).toContain('<c:dispRSqr val="0"/>');
    expect(xml).toContain('<c:dispEq val="0"/>');
    expect(xml).toContain('</c:trendline>');
  });

  it('generates polynomial trendline with order', () => {
    const { generateTrendlineXML } = require('../../src/export/ooxml/shared-xml');

    const xml = generateTrendlineXML({
      type: 'poly',
      order: 3,
      dispEq: true,
      dispRSqr: true,
    });

    expect(xml).toContain('<c:trendlineType val="poly"/>');
    expect(xml).toContain('<c:order val="3"/>');
    expect(xml).toContain('<c:dispRSqr val="1"/>');
    expect(xml).toContain('<c:dispEq val="1"/>');
  });

  it('generates moving average trendline with period', () => {
    const { generateTrendlineXML } = require('../../src/export/ooxml/shared-xml');

    const xml = generateTrendlineXML({
      type: 'movingAvg',
      period: 5,
      dispEq: false,
      dispRSqr: false,
    });

    expect(xml).toContain('<c:trendlineType val="movingAvg"/>');
    expect(xml).toContain('<c:period val="5"/>');
    // No order for moving average
    expect(xml).not.toContain('<c:order');
  });

  it('includes forward/backward projection', () => {
    const { generateTrendlineXML } = require('../../src/export/ooxml/shared-xml');

    const xml = generateTrendlineXML({
      type: 'exp',
      forward: 3,
      backward: 1,
      dispEq: false,
      dispRSqr: false,
    });

    expect(xml).toContain('<c:trendlineType val="exp"/>');
    expect(xml).toContain('<c:forward val="3"/>');
    expect(xml).toContain('<c:backward val="1"/>');
  });
});

// =============================================================================
// getOOXMLChartElement for new types
// =============================================================================

describe('getOOXMLChartElement with radar and stock', () => {
  it('returns radarChart for line with linear-closed interpolation', () => {
    expect(
      getOOXMLChartElement({
        mark: { type: 'line', interpolate: 'linear-closed' },
        encoding: { x: { field: 'x' }, y: { field: 'y' } },
      }),
    ).toBe('radarChart');
  });

  it('returns radarChart for area with linear-closed interpolation', () => {
    expect(
      getOOXMLChartElement({
        mark: { type: 'area', interpolate: 'linear-closed' },
        encoding: { x: { field: 'x' }, y: { field: 'y' } },
      }),
    ).toBe('radarChart');
  });

  it('returns stockChart for rule mark', () => {
    expect(
      getOOXMLChartElement({
        mark: 'rule',
        encoding: { x: { field: 'x' }, y: { field: 'y' } },
      }),
    ).toBe('stockChart');
  });
});

// =============================================================================
// Opacity to OOXML Alpha Tests
// =============================================================================

describe('opacityToOOXMLAlpha', () => {
  it('converts fully opaque (1.0) to alpha 0', () => {
    const { opacityToOOXMLAlpha } = require('../../src/export/ooxml/shared-xml');
    expect(opacityToOOXMLAlpha(1.0)).toBe(0);
  });

  it('converts fully transparent (0.0) to alpha 100000', () => {
    const { opacityToOOXMLAlpha } = require('../../src/export/ooxml/shared-xml');
    expect(opacityToOOXMLAlpha(0.0)).toBe(100000);
  });

  it('converts 0.5 opacity to alpha 50000', () => {
    const { opacityToOOXMLAlpha } = require('../../src/export/ooxml/shared-xml');
    expect(opacityToOOXMLAlpha(0.5)).toBe(50000);
  });

  it('converts 0.7 opacity to alpha 30000', () => {
    const { opacityToOOXMLAlpha } = require('../../src/export/ooxml/shared-xml');
    expect(opacityToOOXMLAlpha(0.7)).toBe(30000);
  });
});

describe('XML well-formedness', () => {
  /**
   * Basic XML well-formedness check: verifies that the output has
   * matching open/close tags and no bare & or < in text content.
   */
  function assertWellFormedXML(xml: string): void {
    // Must start with XML declaration
    expect(xml.startsWith('<?xml')).toBe(true);

    // Check for bare & (not part of entity reference)
    // Valid: &amp; &lt; &gt; &quot; &apos; &#nn; &#xnn;
    const bareAmpersands = xml.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/g);
    expect(bareAmpersands).toBeNull();

    // Must have matching chartSpace open/close
    expect(xml).toContain('<c:chartSpace');
    expect(xml).toContain('</c:chartSpace>');

    // Every <c:chart> must close
    expect(xml).toContain('<c:chart>');
    expect(xml).toContain('</c:chart>');

    // plotArea open/close
    expect(xml).toContain('<c:plotArea>');
    expect(xml).toContain('</c:plotArea>');
  }

  it('bar chart XML is well-formed', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);
    assertWellFormedXML(result.chartXml);
  });

  it('line chart XML is well-formed', () => {
    const spec: ChartSpec = {
      mark: 'line',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);
    assertWellFormedXML(result.chartXml);
  });

  it('pie chart XML is well-formed', () => {
    const spec: ChartSpec = {
      mark: 'arc',
      encoding: {
        color: { field: 'category', type: 'nominal' },
        theta: { field: 'count', type: 'quantitative' },
      },
    };

    const result = toOOXML(spec, SAMPLE_PIE_DATA);
    assertWellFormedXML(result.chartXml);
  });

  it('scatter chart XML is well-formed', () => {
    const spec: ChartSpec = {
      mark: 'point',
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
      },
    };

    const result = toOOXML(spec, SAMPLE_XY_DATA);
    assertWellFormedXML(result.chartXml);
  });

  it('area chart XML is well-formed', () => {
    const spec: ChartSpec = {
      mark: 'area',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = toOOXML(spec, SAMPLE_CATEGORY_DATA);
    assertWellFormedXML(result.chartXml);
  });

  it('grouped bar chart with special characters is well-formed', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      title: 'Sales & Revenue <2024>',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'sales', type: 'quantitative' },
        color: { field: 'product', type: 'nominal' },
      },
    };

    const data: DataRow[] = [
      { category: 'Q1 & Q2', product: 'Widget "A"', sales: 100 },
      { category: 'Q1 & Q2', product: "Gadget's", sales: 150 },
      { category: 'Q3 <Q4>', product: 'Widget "A"', sales: 120 },
      { category: 'Q3 <Q4>', product: "Gadget's", sales: 180 },
    ];

    const result = toOOXML(spec, data, { sheetName: "Bob's Sheet" });
    assertWellFormedXML(result.chartXml);
  });
});
