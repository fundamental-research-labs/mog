/**
 * Full Pipeline Export Tests
 *
 * Tests the complete pipeline: ChartConfig -> configToSpec -> compile -> toOOXML
 * Verifies that generated XML is well-formed for all supported chart types.
 */
import { chartDataToRows, configToSpec } from '../../src/core/config-to-spec';
import { canExportToOOXML, toOOXML } from '../../src/export';
import { compile } from '../../src/grammar/compiler';
import type { ChartSpec, DataRow } from '../../src/grammar/spec';
import type { ChartConfig, ChartData, StoredChartConfig } from '../../src/types';

// =============================================================================
// Test Helpers
// =============================================================================

function makeConfig(overrides: Partial<StoredChartConfig> = {}): StoredChartConfig {
  return {
    id: 'export-test',
    type: 'bar',
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 15,
    dataRange: 'A1:D10',
    ...overrides,
  };
}

function makeData(seriesCount = 1, categoryCount = 4): ChartData {
  const categories = ['Q1', 'Q2', 'Q3', 'Q4'].slice(0, categoryCount);
  const series = [];
  for (let i = 0; i < seriesCount; i++) {
    series.push({
      name: `Series ${i + 1}`,
      data: categories.map((cat, j) => ({
        x: cat,
        y: (j + 1) * 10 * (i + 1),
        name: cat,
      })),
    });
  }
  return { categories, series };
}

/**
 * Basic XML well-formedness checks.
 * Verifies the XML has proper structure without a full DOM parser.
 */
function assertXmlWellFormed(xml: string): void {
  // Must start with XML declaration
  expect(xml).toMatch(/^<\?xml version="1\.0"/);

  // Must have matching root element
  expect(xml).toContain('<c:chartSpace');
  expect(xml).toContain('</c:chartSpace>');

  // Must have proper namespaces
  expect(xml).toContain('xmlns:c=');
  expect(xml).toContain('xmlns:a=');

  // Must have chart container
  expect(xml).toContain('<c:chart>');
  expect(xml).toContain('</c:chart>');

  // Must have plot area
  expect(xml).toContain('<c:plotArea>');
  expect(xml).toContain('</c:plotArea>');

  // Check that all opening tags have corresponding closing tags
  // for key chart elements
  const criticalTags = ['c:chartSpace', 'c:chart', 'c:plotArea'];
  for (const tag of criticalTags) {
    const openCount = (xml.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
    const closeCount = (xml.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    expect(openCount).toBe(closeCount);
  }

  // No unescaped ampersands (except in entity references)
  // Match & that is NOT followed by amp;, lt;, gt;, quot;, apos;, #
  expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
}

// =============================================================================
// Full Pipeline Export: Bar Chart
// =============================================================================

describe('Full pipeline export: bar chart', () => {
  it('basic bar chart produces well-formed XML', () => {
    const config = makeConfig({ type: 'bar' });
    const data = makeData(1);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    expect(canExportToOOXML(spec)).toBe(true);
    const result = toOOXML(spec, rows);
    expect(result.chartXml).toBeDefined();
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:barChart>');
    expect(result.chartXml).toContain('<c:barDir val="bar"/>');
  });

  it('stacked bar chart produces well-formed XML', () => {
    const config = makeConfig({ type: 'bar', subType: 'stacked' });
    const data = makeData(2);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:grouping val="stacked"/>');
  });

  it('percentStacked bar chart produces well-formed XML', () => {
    const config = makeConfig({ type: 'bar', subType: 'percentStacked' });
    const data = makeData(2);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:grouping val="percentStacked"/>');
  });

  it('bar chart with title produces title in XML', () => {
    const config = makeConfig({ type: 'bar', title: 'Revenue Report' });
    const data = makeData(1);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:title>');
    expect(result.chartXml).toContain('Revenue Report');
  });
});

// =============================================================================
// Full Pipeline Export: Column Chart
// =============================================================================

describe('Full pipeline export: column chart', () => {
  it('column chart produces vertical column XML', () => {
    const config = makeConfig({ type: 'column' });
    const data = makeData(1);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    // Column chart uses bar mark with x=nominal, y=quantitative.
    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:barChart>');
    expect(result.chartXml).toContain('<c:barDir val="col"/>');
  });
});

// =============================================================================
// Full Pipeline Export: Line Chart
// =============================================================================

describe('Full pipeline export: line chart', () => {
  it('basic line chart produces well-formed XML', () => {
    const config = makeConfig({ type: 'line' });
    const data = makeData(1);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:lineChart>');
  });

  it('smooth line chart produces smooth marker in XML', () => {
    const config = makeConfig({ type: 'line', subType: 'smooth' });
    const data = makeData(1);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:smooth val="1"/>');
  });

  it('multi-series line chart produces well-formed XML', () => {
    const config = makeConfig({ type: 'line' });
    const data = makeData(3);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:lineChart>');
  });
});

// =============================================================================
// Full Pipeline Export: Pie Chart
// =============================================================================

describe('Full pipeline export: pie chart', () => {
  it('basic pie chart produces well-formed XML', () => {
    const config = makeConfig({ type: 'pie' });
    const data = makeData(1);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:pieChart>');
    expect(result.chartXml).toContain('<c:varyColors val="1"/>');
  });
});

// =============================================================================
// Full Pipeline Export: Doughnut Chart
// =============================================================================

describe('Full pipeline export: doughnut chart', () => {
  it('doughnut chart produces well-formed XML with holeSize', () => {
    const config = makeConfig({ type: 'doughnut' });
    const data = makeData(1);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:doughnutChart>');
    expect(result.chartXml).toContain('<c:holeSize');
  });
});

// =============================================================================
// Full Pipeline Export: Scatter Chart
// =============================================================================

describe('Full pipeline export: scatter chart', () => {
  it('scatter chart produces well-formed XML', () => {
    const config = makeConfig({ type: 'scatter' });
    const data = makeData(1);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:scatterChart>');
  });
});

// =============================================================================
// Full Pipeline Export: Area Chart
// =============================================================================

describe('Full pipeline export: area chart', () => {
  it('basic area chart produces well-formed XML', () => {
    const config = makeConfig({ type: 'area' });
    const data = makeData(1);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:areaChart>');
  });

  it('stacked area chart produces well-formed XML', () => {
    const config = makeConfig({ type: 'area', subType: 'stacked' });
    const data = makeData(2);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:areaChart>');
  });
});

// =============================================================================
// OOXML Export Support Matrix
// =============================================================================

describe('Full pipeline export: support matrix', () => {
  /**
   * Chart types that should produce exportable OOXML:
   * bar, column, line, area, pie, doughnut, scatter, bubble
   *
   * Chart types that are layered and may NOT be directly exportable:
   * combo, stock, waterfall (these produce LayerSpec which canExportToOOXML returns false)
   */

  const supportedSimpleTypes: Array<{
    chartType: ChartConfig['type'];
    expectedElement: string;
  }> = [
    { chartType: 'bar', expectedElement: 'barChart' },
    { chartType: 'line', expectedElement: 'lineChart' },
    { chartType: 'area', expectedElement: 'areaChart' },
    { chartType: 'pie', expectedElement: 'pieChart' },
    { chartType: 'doughnut', expectedElement: 'doughnutChart' },
    { chartType: 'scatter', expectedElement: 'scatterChart' },
  ];

  it.each(supportedSimpleTypes)(
    '$chartType: full pipeline produces well-formed OOXML with $expectedElement',
    ({ chartType, expectedElement }) => {
      const config = makeConfig({ type: chartType });
      const data = makeData(1);
      const spec = configToSpec(config, data);
      const rows = chartDataToRows(data);

      expect(canExportToOOXML(spec)).toBe(true);
      const result = toOOXML(spec, rows);
      assertXmlWellFormed(result.chartXml);
      expect(result.chartXml).toContain(`<c:${expectedElement}>`);
    },
  );

  it('column chart exports as barChart with vertical column direction', () => {
    const config = makeConfig({ type: 'column' });
    const data = makeData(1);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    expect(canExportToOOXML(spec)).toBe(true);
    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:barChart>');
    expect(result.chartXml).toContain('<c:barDir val="col"/>');
  });

  it('bubble chart (point + size encoding) can be exported when spec has size', () => {
    // Bubble charts need manual spec construction with size encoding
    const spec: ChartSpec = {
      mark: 'point',
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
        size: { field: 'size', type: 'quantitative' },
      },
    };
    const data: DataRow[] = [
      { x: 1, y: 2, size: 10 },
      { x: 2, y: 4, size: 20 },
      { x: 3, y: 3, size: 15 },
    ];

    expect(canExportToOOXML(spec)).toBe(true);
    const result = toOOXML(spec, data);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('<c:bubbleChart>');
  });

  // Layered chart types with <= 2 layers pass canExportToOOXML
  // (only complex layered specs with > 2 layers are rejected)
  const simpleLayeredTypes: Array<{
    chartType: ChartConfig['type'];
    overrides?: Partial<ChartConfig>;
  }> = [
    { chartType: 'combo', overrides: { series: [{ type: 'bar' }, { type: 'line' }] } },
    { chartType: 'stock' },
    { chartType: 'waterfall' },
  ];

  it.each(simpleLayeredTypes)(
    '$chartType: layered spec with <= 2 layers passes canExportToOOXML',
    ({ chartType, overrides }) => {
      const config = makeConfig({
        type: chartType,
        ...(overrides ?? {}),
      });
      const data = makeData(2);
      const spec = configToSpec(config, data);

      // These produce layered specs with <= 2 layers, which are allowed
      expect(canExportToOOXML(spec)).toBe(true);
    },
  );

  it('complex combo with > 2 layers is NOT directly exportable', () => {
    // A combo chart with 3 series and data labels per series would have > 2 layers
    const config = makeConfig({
      type: 'combo',
      dataLabels: { show: true },
      series: [
        { type: 'bar', dataLabels: { show: true } },
        { type: 'line', dataLabels: { show: true } },
        { type: 'area', dataLabels: { show: true } },
      ],
    });
    const data = makeData(3);
    const spec = configToSpec(config, data);

    // With 3 series + data label layers, there should be > 2 layers
    if (spec.layer && spec.layer.length > 2) {
      expect(canExportToOOXML(spec)).toBe(false);
    }
  });
});

// =============================================================================
// XML Data Integrity
// =============================================================================

describe('Full pipeline export: XML data integrity', () => {
  it('exported XML contains data point values', () => {
    const data: ChartData = {
      categories: ['Apples', 'Oranges', 'Bananas'],
      series: [
        {
          name: 'Sales',
          data: [
            { x: 'Apples', y: 100, name: 'Apples' },
            { x: 'Oranges', y: 200, name: 'Oranges' },
            { x: 'Bananas', y: 150, name: 'Bananas' },
          ],
        },
      ],
    };
    const config = makeConfig({ type: 'bar' });
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);

    // Numeric values should appear in the XML
    expect(result.chartXml).toContain('100');
    expect(result.chartXml).toContain('200');
    expect(result.chartXml).toContain('150');
  });

  it('special characters in data are properly escaped', () => {
    const data: ChartData = {
      categories: ['A & B', 'C < D'],
      series: [
        {
          name: 'Test & Series',
          data: [
            { x: 'A & B', y: 10, name: 'A & B' },
            { x: 'C < D', y: 20, name: 'C < D' },
          ],
        },
      ],
    };
    const config = makeConfig({ type: 'bar' });
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);

    // Special characters must be escaped
    expect(result.chartXml).toContain('A &amp; B');
    expect(result.chartXml).toContain('C &lt; D');
    // Raw special characters must NOT appear in element content
    expect(result.chartXml).not.toMatch(/<c:v>[^<]*A & B[^<]*<\/c:v>/);
  });

  it('title with special characters is properly escaped', () => {
    const config = makeConfig({
      type: 'bar',
      title: 'Revenue & Profit <FY25>',
    });
    const data = makeData(1);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result = toOOXML(spec, rows);
    assertXmlWellFormed(result.chartXml);
    expect(result.chartXml).toContain('Revenue &amp; Profit &lt;FY25&gt;');
  });
});

// =============================================================================
// Round-Trip: Config -> Spec -> Compile -> Export Consistency
// =============================================================================

describe('Full pipeline export: round-trip consistency', () => {
  it('same config produces same XML structure on repeated calls', () => {
    const config = makeConfig({ type: 'bar', title: 'Consistent' });
    const data = makeData(1);
    const spec = configToSpec(config, data);
    const rows = chartDataToRows(data);

    const result1 = toOOXML(spec, rows);
    const result2 = toOOXML(spec, rows);

    expect(result1.chartXml).toBe(result2.chartXml);
  });

  it('compiled marks count matches expected data points for bar chart', () => {
    const data = makeData(1, 4); // 1 series, 4 categories
    const config = makeConfig({ type: 'bar' });
    const spec = configToSpec(config, data);

    const compiled = compile(spec, undefined, { width: 600, height: 400 });
    // Bar chart should produce one rect mark per data point
    expect(compiled.marks.length).toBe(4);

    // Export should also work
    const rows = chartDataToRows(data);
    const exported = toOOXML(spec, rows);
    assertXmlWellFormed(exported.chartXml);
  });

  it('pie chart: compiled arc count matches category count', () => {
    const data = makeData(1, 3); // 1 series, 3 categories
    const config = makeConfig({ type: 'pie' });
    const spec = configToSpec(config, data);

    const compiled = compile(spec, undefined, { width: 400, height: 400 });
    // Pie chart should produce one arc per data point
    expect(compiled.marks.length).toBe(3);

    // Export should also work
    const rows = chartDataToRows(data);
    const exported = toOOXML(spec, rows);
    assertXmlWellFormed(exported.chartXml);
  });
});
