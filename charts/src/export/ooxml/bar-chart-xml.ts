/**
 * Bar Chart XML Generator for OOXML Chart Export
 *
 * Generates <c:barChart> elements for Excel bar/column charts.
 * Based on Office Open XML (ECMA-376) Drawing ML specifications.
 *
 * Supports:
 * - Vertical bars (column chart)
 * - Horizontal bars (bar chart)
 * - Clustered, stacked, and percent stacked
 *
 * Pure functions - no side effects.
 */

import { groupBy } from '../../algebra/group-by';
import {
  effectiveBarGeometryFromSpec,
  effectiveGapWidth,
  effectiveOverlap,
} from '../../core/chart-ir/bar-geometry';
import type { ChartSpec, DataRow, EncodingSpec } from '../../grammar/spec';
import type {
  BarDirection,
  BarGrouping,
  ExportOptions,
  OOXMLExportResult,
  SeriesData,
} from '../ooxml-types';
import { AXIS_IDS, generateCategoryAxisXML, generateValueAxisXML } from './axis-xml';
import { extractChartTitle, wrapChartXML } from './chart-xml';
import { extractSeriesData } from './data-util';
import { generateCategoryValueSeriesXML, sanitizeNumericValue } from './shared-xml';
import { escapeXml, generateDataLabelsXML, getDefaultColor } from './style-xml';

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Generate OOXML for a bar/column chart.
 *
 * @param spec - ChartSpec with mark: 'bar'
 * @param data - Data rows for the chart
 * @param options - Export options
 */
export function generateBarChartXML(
  spec: ChartSpec,
  data: DataRow[],
  options?: ExportOptions,
): OOXMLExportResult {
  const encoding = spec.encoding!;
  const sheetName = options?.sheetName ?? 'Sheet1';

  // Determine direction (vertical column vs horizontal bar)
  const isHorizontal = detectHorizontalBar(spec, encoding);
  const barDir: BarDirection = isHorizontal ? 'bar' : 'col';

  // Determine grouping (clustered, stacked, percentStacked)
  const grouping = detectGrouping(spec);

  // Extract series data from spec and data
  const seriesData = extractSeriesData(data, encoding, {
    swapAxes: isHorizontal,
    chartType: 'Bar chart',
  });

  // Generate bar chart content
  const chartContent = generateBarChartContent(seriesData, barDir, grouping, sheetName, spec);

  // Generate axes (swap for horizontal)
  const axes = generateBarAxes(encoding, isHorizontal);

  // Get title (preserves subtitle from TitleSpec)
  const title = extractChartTitle(spec);

  // Check if legend should be shown
  const showLegend = encoding.color?.field !== undefined;

  // Wrap in chartSpace
  const chartXml = wrapChartXML(chartContent, {
    title,
    axes,
    legend: showLegend ? { position: 'r' } : undefined,
    displayBlanksAs: spec.config?.displayBlanksAs,
    plotVisibleOnly: spec.config?.plotVisibleOnly,
  });

  return { chartXml };
}

// =============================================================================
// Chart Content Generation
// =============================================================================

/**
 * Generate the <c:barChart> element content.
 */
function generateBarChartContent(
  seriesData: SeriesData[],
  barDir: BarDirection,
  grouping: BarGrouping,
  sheetName: string,
  spec: ChartSpec,
): string {
  const geometry = effectiveBarGeometryFromSpec(spec.config);
  const gapWidth = effectiveGapWidth(geometry.gapWidth);
  const overlap = effectiveOverlap(geometry.overlap, grouping);

  return `<c:barChart>
    <c:barDir val="${barDir}"/>
    <c:grouping val="${grouping}"/>
    <c:varyColors val="0"/>
    ${seriesData.map((series, idx) => generateBarSeriesXML(series, idx, sheetName)).join('\n    ')}
    ${generateDataLabelsXML()}
    <c:gapWidth val="${gapWidth}"/>
    <c:overlap val="${overlap}"/>
    <c:axId val="${AXIS_IDS.CATEGORY}"/>
    <c:axId val="${AXIS_IDS.VALUE}"/>
  </c:barChart>`;
}

/**
 * Generate a single bar series XML element.
 * Delegates to shared generateCategoryValueSeriesXML with bar-specific styling.
 */
function generateBarSeriesXML(series: SeriesData, index: number, sheetName: string): string {
  return generateCategoryValueSeriesXML(series, index, sheetName, {
    shapePropertiesXML: `<c:spPr>
      <a:solidFill>
        <a:srgbClr val="${series.color}"/>
      </a:solidFill>
      <a:ln>
        <a:noFill/>
      </a:ln>
    </c:spPr>`,
    beforeCatXML: '<c:invertIfNegative val="0"/>',
  });
}

// =============================================================================
// Detection Helpers
// =============================================================================

/**
 * Detect if the bar chart should be horizontal.
 *
 * A bar chart is horizontal if:
 * - The x encoding has type 'quantitative' and y encoding has type 'nominal'/'ordinal'
 * - Or explicit configuration suggests horizontal
 */
function detectHorizontalBar(spec: ChartSpec, encoding: EncodingSpec): boolean {
  // Check if x is quantitative and y is categorical
  const xType = encoding.x?.type;
  const yType = encoding.y?.type;

  if (xType === 'quantitative' && (yType === 'nominal' || yType === 'ordinal')) {
    return true;
  }

  return false;
}

/**
 * Detect the grouping mode from ChartSpec config.
 */
function detectGrouping(spec: ChartSpec): BarGrouping {
  const stack = spec.config?.stack;

  if (stack === 'zero') {
    return 'stacked';
  }

  if (stack === 'normalize') {
    return 'percentStacked';
  }

  if (stack === false) {
    return 'clustered';
  }

  // Default to clustered for charts with color encoding, standard for single series
  if (spec.encoding?.color?.field) {
    return 'clustered';
  }

  return 'clustered';
}

// =============================================================================
// Axis Generation
// =============================================================================

/**
 * Generate axes for bar chart.
 */
function generateBarAxes(encoding: EncodingSpec, isHorizontal: boolean): string[] {
  if (isHorizontal) {
    // Horizontal bar: category axis on left (y), value axis on bottom (x)
    return [
      generateCategoryAxisXML(encoding.y, AXIS_IDS.CATEGORY, AXIS_IDS.VALUE, {
        position: 'l',
      }),
      generateValueAxisXML(encoding.x, AXIS_IDS.VALUE, AXIS_IDS.CATEGORY, {
        position: 'b',
      }),
    ];
  }

  // Vertical bar (column): category axis on bottom (x), value axis on left (y)
  return [
    generateCategoryAxisXML(encoding.x, AXIS_IDS.CATEGORY, AXIS_IDS.VALUE, {
      position: 'b',
    }),
    generateValueAxisXML(encoding.y, AXIS_IDS.VALUE, AXIS_IDS.CATEGORY, {
      position: 'l',
    }),
  ];
}

// =============================================================================
// Box and Whisker Chart (Excel 2016+)
// =============================================================================

/**
 * Generate OOXML for a box and whisker chart.
 *
 * Note: Box and whisker charts require Excel 2016 or later.
 *
 * @param spec - ChartSpec with mark: 'boxplot'
 * @param data - Data rows for the chart
 * @param options - Export options
 */
export function generateBoxWhiskerChartXML(
  spec: ChartSpec,
  data: DataRow[],
  options?: ExportOptions,
): OOXMLExportResult {
  // Box and whisker uses a different namespace and structure
  // This is a simplified implementation
  const encoding = spec.encoding!;
  const categoryField = encoding.x?.field;
  const valueField = encoding.y?.field;

  if (!categoryField || !valueField) {
    throw new Error('Box plot requires both category (x) and value (y) fields');
  }

  // Group data by category using shared algebra module
  const groups = groupBy(data, categoryField);

  // Calculate quartiles for each group
  const boxData: Array<{
    category: string;
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
  }> = [];

  for (const [category, rows] of groups) {
    const values = rows.map((row) => Number(row[valueField])).sort((a, b) => a - b);
    const n = values.length;

    boxData.push({
      category,
      min: values[0],
      q1: values[Math.floor(n * 0.25)],
      median: values[Math.floor(n * 0.5)],
      q3: values[Math.floor(n * 0.75)],
      max: values[n - 1],
    });
  }

  // Generate box and whisker chart XML (Excel 2016+ format)
  const chartContent = `<c:boxWhiskerChart>
    <c:varyColors val="0"/>
    ${boxData
      .map(
        (box, idx) => `<c:ser>
      <c:idx val="${idx}"/>
      <c:order val="${idx}"/>
      <c:tx><c:v>${escapeXml(box.category)}</c:v></c:tx>
      <c:spPr>
        <a:solidFill><a:srgbClr val="${getDefaultColor(idx)}"/></a:solidFill>
        <a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
      </c:spPr>
      <c:cat>
        <c:strRef>
          <c:strCache>
            <c:ptCount val="1"/>
            <c:pt idx="0"><c:v>${escapeXml(box.category)}</c:v></c:pt>
          </c:strCache>
        </c:strRef>
      </c:cat>
      <c:val>
        <c:numRef>
          <c:numCache>
            <c:formatCode>General</c:formatCode>
            <c:ptCount val="5"/>
            <c:pt idx="0"><c:v>${sanitizeNumericValue(box.min)}</c:v></c:pt>
            <c:pt idx="1"><c:v>${sanitizeNumericValue(box.q1)}</c:v></c:pt>
            <c:pt idx="2"><c:v>${sanitizeNumericValue(box.median)}</c:v></c:pt>
            <c:pt idx="3"><c:v>${sanitizeNumericValue(box.q3)}</c:v></c:pt>
            <c:pt idx="4"><c:v>${sanitizeNumericValue(box.max)}</c:v></c:pt>
          </c:numCache>
        </c:numRef>
      </c:val>
    </c:ser>`,
      )
      .join('\n    ')}
    <c:axId val="${AXIS_IDS.CATEGORY}"/>
    <c:axId val="${AXIS_IDS.VALUE}"/>
  </c:boxWhiskerChart>`;

  // Generate axes
  const axes = [
    generateCategoryAxisXML(encoding.x, AXIS_IDS.CATEGORY, AXIS_IDS.VALUE),
    generateValueAxisXML(encoding.y, AXIS_IDS.VALUE, AXIS_IDS.CATEGORY),
  ];

  // Get title (preserves subtitle from TitleSpec)
  const title = extractChartTitle(spec);

  // Wrap in chartSpace
  const chartXml = wrapChartXML(chartContent, {
    title,
    axes,
    displayBlanksAs: spec.config?.displayBlanksAs,
    plotVisibleOnly: spec.config?.plotVisibleOnly,
  });

  return { chartXml };
}
