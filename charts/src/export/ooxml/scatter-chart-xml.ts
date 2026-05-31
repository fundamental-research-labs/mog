/**
 * Scatter Chart XML Generator for OOXML Chart Export
 *
 * Generates <c:scatterChart> and <c:bubbleChart> elements for Excel scatter/bubble charts.
 * Based on Office Open XML (ECMA-376) Drawing ML specifications.
 *
 * Supports:
 * - Standard scatter (XY) charts
 * - Scatter with lines
 * - Scatter with smooth lines
 * - Bubble charts (with size encoding)
 *
 * Pure functions - no side effects.
 */

import { groupBy } from '../../algebra/group-by';
import type { ChartSpec, DataRow, EncodingSpec } from '../../grammar/spec';
import type {
  ExportOptions,
  OOXMLExportResult,
  ScatterSeriesData,
  ScatterStyle,
  XYPoint,
} from '../ooxml-types';
import { AXIS_IDS, generateValueAxisXML } from './axis-xml';
import { extractChartTitle, wrapChartXML } from './chart-xml';
import { columnLetter } from './column-util';
import { quoteSheetName } from '@mog/spreadsheet-utils';
import { sanitizeNumericValue } from './shared-xml';
import { escapeXml, generateDataLabelsXML, generateMarkerXML, getDefaultColor } from './style-xml';

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Generate OOXML for a scatter chart.
 *
 * @param spec - ChartSpec with mark: 'point' or 'circle'
 * @param data - Data rows for the chart
 * @param options - Export options
 */
export function generateScatterChartXML(
  spec: ChartSpec,
  data: DataRow[],
  options?: ExportOptions,
): OOXMLExportResult {
  const encoding = spec.encoding!;
  const sheetName = options?.sheetName ?? 'Sheet1';

  // Check if this should be a bubble chart (has size encoding)
  const hasSizeEncoding = encoding.size?.field !== undefined;

  if (hasSizeEncoding) {
    return generateBubbleChartXML(spec, data, options);
  }

  // Detect scatter style
  const scatterStyle = detectScatterStyle(spec);

  // Extract series data
  const seriesData = extractScatterSeriesData(data, encoding);

  // Generate scatter chart content
  const chartContent = generateScatterChartContent(seriesData, scatterStyle, sheetName);

  // Generate axes (both value axes for scatter)
  const axes = [
    generateValueAxisXML(encoding.x, AXIS_IDS.CATEGORY, AXIS_IDS.VALUE, {
      position: 'b',
    }),
    generateValueAxisXML(encoding.y, AXIS_IDS.VALUE, AXIS_IDS.CATEGORY, {
      position: 'l',
    }),
  ];

  // Get title
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

/**
 * Generate OOXML for a bubble chart.
 *
 * @param spec - ChartSpec with mark: 'point' or 'circle' and size encoding
 * @param data - Data rows for the chart
 * @param options - Export options
 */
export function generateBubbleChartXML(
  spec: ChartSpec,
  data: DataRow[],
  options?: ExportOptions,
): OOXMLExportResult {
  const encoding = spec.encoding!;
  const sheetName = options?.sheetName ?? 'Sheet1';
  const bubbleOptions = resolveBubbleChartOptions(spec);

  // Extract bubble series data
  const seriesData = extractBubbleSeriesData(data, encoding);

  // Generate bubble chart content
  const chartContent = generateBubbleChartContent(seriesData, sheetName, bubbleOptions);

  // Generate axes (both value axes for bubble)
  const axes = [
    generateValueAxisXML(encoding.x, AXIS_IDS.CATEGORY, AXIS_IDS.VALUE, {
      position: 'b',
    }),
    generateValueAxisXML(encoding.y, AXIS_IDS.VALUE, AXIS_IDS.CATEGORY, {
      position: 'l',
    }),
  ];

  // Get title
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
 * Generate the <c:scatterChart> element content.
 */
function generateScatterChartContent(
  seriesData: ScatterSeriesData[],
  style: ScatterStyle,
  sheetName: string,
): string {
  return `<c:scatterChart>
    <c:scatterStyle val="${style}"/>
    <c:varyColors val="0"/>
    ${seriesData.map((series, idx) => generateScatterSeriesXML(series, idx, style, sheetName)).join('\n    ')}
    ${generateDataLabelsXML()}
    <c:axId val="${AXIS_IDS.CATEGORY}"/>
    <c:axId val="${AXIS_IDS.VALUE}"/>
  </c:scatterChart>`;
}

/**
 * Generate a single scatter series XML element.
 */
function generateScatterSeriesXML(
  series: ScatterSeriesData,
  index: number,
  style: ScatterStyle,
  sheetName: string,
): string {
  const ptCount = series.points.length;
  const showLine =
    style === 'line' || style === 'lineMarker' || style === 'smooth' || style === 'smoothMarker';
  const showMarker = style === 'marker' || style === 'lineMarker' || style === 'smoothMarker';

  // Generate data references with properly quoted sheet names
  const quotedSheet = quoteSheetName(sheetName);
  const xStartRow = 2;
  const xEndRow = xStartRow + ptCount - 1;
  const xCol = columnLetter(index * 2); // A, C, E, ...
  const yCol = columnLetter(index * 2 + 1); // B, D, F, ...
  const xRef = `${quotedSheet}!$${xCol}$${xStartRow}:$${xCol}$${xEndRow}`;
  const yRef = `${quotedSheet}!$${yCol}$${xStartRow}:$${yCol}$${xEndRow}`;

  // Line properties
  const lineXML = showLine
    ? `<a:ln w="28575" cap="rnd">
        <a:solidFill><a:srgbClr val="${series.color}"/></a:solidFill>
        <a:round/>
      </a:ln>`
    : '<a:ln><a:noFill/></a:ln>';

  // Marker properties
  const markerXML = showMarker
    ? generateMarkerXML({ symbol: 'circle', size: 5, color: series.color })
    : '<c:marker><c:symbol val="none"/></c:marker>';

  return `<c:ser>
    <c:idx val="${index}"/>
    <c:order val="${index}"/>
    <c:tx>
      <c:v>${escapeXml(series.name)}</c:v>
    </c:tx>
    <c:spPr>
      ${lineXML}
    </c:spPr>
    ${markerXML}
    <c:xVal>
      <c:numRef>
        <c:f>${xRef}</c:f>
        <c:numCache>
          <c:formatCode>General</c:formatCode>
          <c:ptCount val="${ptCount}"/>
          ${series.points.map((pt, i) => `<c:pt idx="${i}"><c:v>${sanitizeNumericValue(pt.x)}</c:v></c:pt>`).join('\n          ')}
        </c:numCache>
      </c:numRef>
    </c:xVal>
    <c:yVal>
      <c:numRef>
        <c:f>${yRef}</c:f>
        <c:numCache>
          <c:formatCode>General</c:formatCode>
          <c:ptCount val="${ptCount}"/>
          ${series.points.map((pt, i) => `<c:pt idx="${i}"><c:v>${sanitizeNumericValue(pt.y)}</c:v></c:pt>`).join('\n          ')}
        </c:numCache>
      </c:numRef>
    </c:yVal>
    <c:smooth val="${style === 'smooth' || style === 'smoothMarker' ? '1' : '0'}"/>
  </c:ser>`;
}

/**
 * Generate the <c:bubbleChart> element content.
 */
interface BubbleChartOptions {
  bubbleScale: number;
  showNegBubbles: boolean;
  sizeRepresents?: 'area' | 'w';
  bubble3D: boolean;
}

function generateBubbleChartContent(
  seriesData: ScatterSeriesData[],
  sheetName: string,
  options: BubbleChartOptions,
): string {
  const sizeRepresentsXml = options.sizeRepresents
    ? `\n    <c:sizeRepresents val="${options.sizeRepresents}"/>`
    : '';
  return `<c:bubbleChart>
    <c:varyColors val="0"/>
    ${seriesData.map((series, idx) => generateBubbleSeriesXML(series, idx, sheetName, options)).join('\n    ')}
    ${generateDataLabelsXML()}
    <c:bubbleScale val="${options.bubbleScale}"/>
    <c:showNegBubbles val="${options.showNegBubbles ? '1' : '0'}"/>${sizeRepresentsXml}
    <c:axId val="${AXIS_IDS.CATEGORY}"/>
    <c:axId val="${AXIS_IDS.VALUE}"/>
  </c:bubbleChart>`;
}

/**
 * Generate a single bubble series XML element.
 */
function generateBubbleSeriesXML(
  series: ScatterSeriesData,
  index: number,
  sheetName: string,
  options: BubbleChartOptions,
): string {
  const ptCount = series.points.length;

  // Generate data references with properly quoted sheet names
  const quotedSheet = quoteSheetName(sheetName);
  const xStartRow = 2;
  const xEndRow = xStartRow + ptCount - 1;
  const xCol = columnLetter(index * 3); // A, D, G, ...
  const yCol = columnLetter(index * 3 + 1); // B, E, H, ...
  const sizeCol = columnLetter(index * 3 + 2); // C, F, I, ...
  const xRef = `${quotedSheet}!$${xCol}$${xStartRow}:$${xCol}$${xEndRow}`;
  const yRef = `${quotedSheet}!$${yCol}$${xStartRow}:$${yCol}$${xEndRow}`;
  const sizeRef = `${quotedSheet}!$${sizeCol}$${xStartRow}:$${sizeCol}$${xEndRow}`;

  return `<c:ser>
    <c:idx val="${index}"/>
    <c:order val="${index}"/>
    <c:tx>
      <c:v>${escapeXml(series.name)}</c:v>
    </c:tx>
    <c:spPr>
      <a:solidFill>
        <a:srgbClr val="${series.color}"/>
      </a:solidFill>
      <a:ln>
        <a:noFill/>
      </a:ln>
    </c:spPr>
    <c:invertIfNegative val="0"/>
    <c:xVal>
      <c:numRef>
        <c:f>${xRef}</c:f>
        <c:numCache>
          <c:formatCode>General</c:formatCode>
          <c:ptCount val="${ptCount}"/>
          ${series.points.map((pt, i) => `<c:pt idx="${i}"><c:v>${sanitizeNumericValue(pt.x)}</c:v></c:pt>`).join('\n          ')}
        </c:numCache>
      </c:numRef>
    </c:xVal>
    <c:yVal>
      <c:numRef>
        <c:f>${yRef}</c:f>
        <c:numCache>
          <c:formatCode>General</c:formatCode>
          <c:ptCount val="${ptCount}"/>
          ${series.points.map((pt, i) => `<c:pt idx="${i}"><c:v>${sanitizeNumericValue(pt.y)}</c:v></c:pt>`).join('\n          ')}
        </c:numCache>
      </c:numRef>
    </c:yVal>
    <c:bubbleSize>
      <c:numRef>
        <c:f>${sizeRef}</c:f>
        <c:numCache>
          <c:formatCode>General</c:formatCode>
          <c:ptCount val="${ptCount}"/>
          ${series.points.map((pt, i) => `<c:pt idx="${i}"><c:v>${sanitizeNumericValue(pt.size ?? 10)}</c:v></c:pt>`).join('\n          ')}
        </c:numCache>
      </c:numRef>
    </c:bubbleSize>
    <c:bubble3D val="${options.bubble3D ? '1' : '0'}"/>
  </c:ser>`;
}

function resolveBubbleChartOptions(spec: ChartSpec): BubbleChartOptions {
  return {
    bubbleScale: bubbleScaleValue(spec.config?.bubbleScale),
    showNegBubbles: spec.config?.showNegBubbles === true,
    sizeRepresents:
      spec.config?.sizeRepresents === 'area' || spec.config?.sizeRepresents === 'w'
        ? spec.config.sizeRepresents
        : undefined,
    bubble3D: spec.config?.bubble3DEffect === true,
  };
}

function bubbleScaleValue(value: unknown): number {
  const scale = typeof value === 'number' && Number.isFinite(value) ? value : 100;
  return Math.round(Math.max(0, Math.min(300, scale)));
}

// =============================================================================
// Data Extraction
// =============================================================================

/**
 * Extract scatter series data from data rows and encoding.
 */
function extractScatterSeriesData(data: DataRow[], encoding: EncodingSpec): ScatterSeriesData[] {
  const xField = encoding.x?.field;
  const yField = encoding.y?.field;
  const colorField = encoding.color?.field;

  if (!xField || !yField) {
    throw new Error('Scatter chart requires both x and y fields');
  }

  // If no color encoding, single series
  if (!colorField) {
    const points: XYPoint[] = data.map((row) => ({
      x: Number(row[xField]) || 0,
      y: Number(row[yField]) || 0,
    }));

    return [
      {
        name: 'Series 1',
        points,
        color: getDefaultColor(0),
      },
    ];
  }

  // Group by color field using shared algebra module
  const groups = groupBy(data, colorField);

  // Convert to series array
  const series: ScatterSeriesData[] = [];
  let colorIndex = 0;

  for (const [name, rows] of groups) {
    series.push({
      name,
      points: rows.map((row) => ({
        x: Number(row[xField]) || 0,
        y: Number(row[yField]) || 0,
      })),
      color: getDefaultColor(colorIndex),
    });
    colorIndex++;
  }

  return series;
}

/**
 * Extract bubble series data from data rows and encoding.
 */
function extractBubbleSeriesData(data: DataRow[], encoding: EncodingSpec): ScatterSeriesData[] {
  const xField = encoding.x?.field;
  const yField = encoding.y?.field;
  const sizeField = encoding.size?.field;
  const colorField = encoding.color?.field;

  if (!xField || !yField) {
    throw new Error('Bubble chart requires both x and y fields');
  }

  // If no color encoding, single series
  if (!colorField) {
    const points: XYPoint[] = data.map((row) => ({
      x: Number(row[xField]) || 0,
      y: Number(row[yField]) || 0,
      size: sizeField ? Number(row[sizeField]) || 10 : 10,
    }));

    return [
      {
        name: 'Series 1',
        points,
        color: getDefaultColor(0),
      },
    ];
  }

  // Group by color field using shared algebra module
  const groups = groupBy(data, colorField);

  // Convert to series array
  const series: ScatterSeriesData[] = [];
  let colorIndex = 0;

  for (const [name, rows] of groups) {
    series.push({
      name,
      points: rows.map((row) => ({
        x: Number(row[xField]) || 0,
        y: Number(row[yField]) || 0,
        size: sizeField ? Number(row[sizeField]) || 10 : 10,
      })),
      color: getDefaultColor(colorIndex),
    });
    colorIndex++;
  }

  return series;
}

// =============================================================================
// Detection Helpers
// =============================================================================

/**
 * Detect the scatter chart style from ChartSpec.
 */
function detectScatterStyle(spec: ChartSpec): ScatterStyle {
  const mark = spec.mark;

  // Check if mark is 'point' without line
  if (mark === 'point' || mark === 'circle') {
    return 'marker';
  }

  if (typeof mark === 'object') {
    // Check for line connection
    if (mark.type === 'point' || mark.type === 'circle') {
      // Check interpolate property
      if (mark.interpolate === 'monotone' || mark.interpolate === 'basis') {
        return 'smoothMarker';
      }
      return 'marker';
    }
  }

  // Default to marker only
  return 'marker';
}
