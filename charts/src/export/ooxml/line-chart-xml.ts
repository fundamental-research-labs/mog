/**
 * Line Chart XML Generator for OOXML Chart Export
 *
 * Generates <c:lineChart> elements for Excel line charts.
 * Based on Office Open XML (ECMA-376) Drawing ML specifications.
 *
 * Supports:
 * - Standard line charts
 * - Smooth (curved) lines
 * - Stacked and percent stacked
 * - Line with markers
 *
 * Pure functions - no side effects.
 */

import type { ChartSpec, DataRow } from '../../grammar/spec';
import type { ExportOptions, LineGrouping, OOXMLExportResult, SeriesData } from '../ooxml-types';
import { AXIS_IDS, generateCategoryAxisXML, generateValueAxisXML } from './axis-xml';
import { extractChartTitle, wrapChartXML } from './chart-xml';
import { columnLetter } from './column-util';
import { extractSeriesData } from './data-util';
import { quoteSheetName } from '@mog/spreadsheet-utils';
import { generateCategoryValueSeriesXML, sanitizeNumericValue } from './shared-xml';
import { escapeXml, generateDataLabelsXML, generateMarkerXML, getDefaultColor } from './style-xml';

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Generate OOXML for a line chart.
 *
 * @param spec - ChartSpec with mark: 'line'
 * @param data - Data rows for the chart
 * @param options - Export options
 */
export function generateLineChartXML(
  spec: ChartSpec,
  data: DataRow[],
  options?: ExportOptions,
): OOXMLExportResult {
  const encoding = spec.encoding!;
  const sheetName = options?.sheetName ?? 'Sheet1';

  // Detect if smooth lines should be used
  const smooth = detectSmoothLine(spec);

  // Detect grouping (standard, stacked, percentStacked)
  const grouping = detectLineGrouping(spec);

  // Detect if markers should be shown
  const showMarkers = detectShowMarkers(spec, data);

  // Extract series data
  const seriesData = extractSeriesData(data, encoding, { chartType: 'Line chart' });

  // Generate line chart content
  const chartContent = generateLineChartContent(
    seriesData,
    grouping,
    smooth,
    showMarkers,
    sheetName,
  );

  // Generate axes
  const axes = [
    generateCategoryAxisXML(encoding.x, AXIS_IDS.CATEGORY, AXIS_IDS.VALUE, {
      position: 'b',
    }),
    generateValueAxisXML(encoding.y, AXIS_IDS.VALUE, AXIS_IDS.CATEGORY, {
      position: 'l',
    }),
  ];

  // Get title (preserves subtitle from TitleSpec)
  const title = extractChartTitle(spec);

  // Check if legend should be shown
  const showLegend = encoding.color?.field !== undefined || seriesData.length > 1;

  // Wrap in chartSpace
  const chartXml = wrapChartXML(chartContent, {
    title,
    axes,
    legend: showLegend ? { position: 'r' } : undefined,
  });

  return { chartXml };
}

// =============================================================================
// Chart Content Generation
// =============================================================================

/**
 * Generate the <c:lineChart> element content.
 */
function generateLineChartContent(
  seriesData: SeriesData[],
  grouping: LineGrouping,
  smooth: boolean,
  showMarkers: boolean,
  sheetName: string,
): string {
  return `<c:lineChart>
    <c:grouping val="${grouping}"/>
    <c:varyColors val="0"/>
    ${seriesData.map((series, idx) => generateLineSeriesXML(series, idx, smooth, showMarkers, sheetName)).join('\n    ')}
    ${generateDataLabelsXML()}
    <c:smooth val="${smooth ? '1' : '0'}"/>
    <c:axId val="${AXIS_IDS.CATEGORY}"/>
    <c:axId val="${AXIS_IDS.VALUE}"/>
  </c:lineChart>`;
}

/**
 * Generate a single line series XML element.
 * Delegates to shared generateCategoryValueSeriesXML with line-specific styling.
 */
function generateLineSeriesXML(
  series: SeriesData,
  index: number,
  smooth: boolean,
  showMarkers: boolean,
  sheetName: string,
): string {
  // Marker XML
  const markerXML = showMarkers
    ? generateMarkerXML({ symbol: 'circle', size: 5, color: series.color })
    : '<c:marker><c:symbol val="none"/></c:marker>';

  return generateCategoryValueSeriesXML(series, index, sheetName, {
    shapePropertiesXML: `<c:spPr>
      <a:ln w="28575" cap="rnd">
        <a:solidFill>
          <a:srgbClr val="${series.color}"/>
        </a:solidFill>
        <a:round/>
      </a:ln>
    </c:spPr>`,
    beforeCatXML: markerXML,
    afterValXML: `<c:smooth val="${smooth ? '1' : '0'}"/>`,
  });
}

// =============================================================================
// Detection Helpers
// =============================================================================

/**
 * Detect if smooth (curved) lines should be used.
 */
function detectSmoothLine(spec: ChartSpec): boolean {
  const mark = spec.mark;

  if (typeof mark === 'object' && mark.type === 'line') {
    const interpolate = mark.interpolate;
    // Monotone and basis produce smooth curves
    return interpolate === 'monotone' || interpolate === 'basis' || interpolate === 'cardinal';
  }

  return false;
}

/**
 * Detect the line grouping mode from ChartSpec config.
 */
function detectLineGrouping(spec: ChartSpec): LineGrouping {
  const stack = spec.config?.stack;

  if (stack === 'zero') {
    return 'stacked';
  }

  if (stack === 'normalize') {
    return 'percentStacked';
  }

  return 'standard';
}

/**
 * Detect if markers should be shown on the line.
 * Returns true for explicit point config, or for small datasets (<= 50 points).
 * Large datasets hide markers to avoid visual clutter.
 */
function detectShowMarkers(spec: ChartSpec, data?: DataRow[]): boolean {
  const mark = spec.mark;

  if (typeof mark === 'object' && mark.type === 'line') {
    // Check for explicit point configuration
    if (mark.point !== undefined) {
      return !!mark.point;
    }
  }

  // Default: show markers for small datasets, hide for larger ones
  const dataSize = data?.length ?? 0;
  return dataSize <= 50;
}

// =============================================================================
// Stock Chart (OHLC/Candlestick)
// =============================================================================

/**
 * Generate OOXML for a stock chart (HLC or OHLC).
 *
 * Stock charts require specific series ordering per OOXML spec:
 * - HLC (High-Low-Close): 3 series in order: High, Low, Close
 * - OHLC (Open-High-Low-Close): 4 series in order: Open, High, Low, Close
 *
 * Detects whether data contains 'open' field to choose between HLC and OHLC.
 *
 * @param spec - ChartSpec with stock chart data
 * @param data - Data rows for the chart
 * @param options - Export options
 */
export function generateStockChartXML(
  spec: ChartSpec,
  data: DataRow[],
  options?: ExportOptions,
): OOXMLExportResult {
  const encoding = spec.encoding!;
  const sheetName = options?.sheetName ?? 'Sheet1';

  const dateField = encoding.x?.field ?? 'category';

  // Detect OHLC vs HLC: check if any data row has an 'open' field
  const hasOpen = data.some((row) => row.open !== undefined);
  const seriesFields = hasOpen ? ['open', 'high', 'low', 'close'] : ['high', 'low', 'close'];
  const seriesNames = hasOpen ? ['Open', 'High', 'Low', 'Close'] : ['High', 'Low', 'Close'];

  // Extract categories (dates) and series values from data
  const categories = data.map((row) => row[dateField]);

  const quotedSheet = quoteSheetName(sheetName);
  const catCount = categories.length;
  const catStartRow = 2;
  const catEndRow = catStartRow + catCount - 1;
  const catRef = `${quotedSheet}!$A$${catStartRow}:$A$${catEndRow}`;

  const seriesXMLParts = seriesFields.map((field, idx) => {
    const values = data.map((row) => Number(row[field]) || 0);
    const valCol = columnLetter(idx + 1);
    const valRef = `${quotedSheet}!$${valCol}$${catStartRow}:$${valCol}$${catEndRow}`;

    return `<c:ser>
      <c:idx val="${idx}"/>
      <c:order val="${idx}"/>
      <c:tx><c:v>${seriesNames[idx]}</c:v></c:tx>
      <c:spPr>
        <a:ln w="28575">
          <a:solidFill><a:srgbClr val="${getDefaultColor(idx)}"/></a:solidFill>
        </a:ln>
      </c:spPr>
      <c:marker><c:symbol val="none"/></c:marker>
      <c:cat>
        <c:strRef>
          <c:f>${catRef}</c:f>
          <c:strCache>
            <c:ptCount val="${catCount}"/>
            ${categories.map((cat, i) => `<c:pt idx="${i}"><c:v>${escapeXml(String(cat))}</c:v></c:pt>`).join('\n            ')}
          </c:strCache>
        </c:strRef>
      </c:cat>
      <c:val>
        <c:numRef>
          <c:f>${valRef}</c:f>
          <c:numCache>
            <c:formatCode>General</c:formatCode>
            <c:ptCount val="${values.length}"/>
            ${values.map((val, i) => `<c:pt idx="${i}"><c:v>${sanitizeNumericValue(val)}</c:v></c:pt>`).join('\n            ')}
          </c:numCache>
        </c:numRef>
      </c:val>
    </c:ser>`;
  });

  const chartContent = `<c:stockChart>
    ${seriesXMLParts.join('\n    ')}
    <c:axId val="${AXIS_IDS.CATEGORY}"/>
    <c:axId val="${AXIS_IDS.VALUE}"/>
  </c:stockChart>`;

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
    legend: { position: 'r' },
  });

  return { chartXml };
}
