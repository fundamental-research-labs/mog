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

import type {
  ChartSpec,
  DataRow,
  StockGlyphBodyVisualSpec,
  StockGlyphSourceRoleVisualSpec,
  StockGlyphStrokeVisualSpec,
  StockGlyphVisualSpec,
  StockGlyphVolumeVisualSpec,
} from '../../grammar/spec';
import type { ExportOptions, LineGrouping, OOXMLExportResult, SeriesData } from '../ooxml-types';
import { AXIS_IDS, generateCategoryAxisXML, generateValueAxisXML } from './axis-xml';
import { extractChartTitle, wrapChartXML } from './chart-xml';
import { columnLetter } from './column-util';
import { extractSeriesData } from './data-util';
import { quoteSheetName } from '@mog/spreadsheet-utils';
import { generateCategoryValueSeriesXML, sanitizeNumericValue } from './shared-xml';
import {
  stockLayerEncoding,
  stockLayerUsesOpenClose,
  stockLayerVisual,
} from './stock-layer-detection';
import {
  escapeXml,
  generateDataLabelsXML,
  generateMarkerXML,
  generateShapePropertiesXML,
  generateSimpleLineXML,
  generateSrgbColorXML,
  getDefaultColor,
  type MarkerSymbol,
} from './style-xml';

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
    displayBlanksAs: spec.config?.displayBlanksAs,
    plotVisibleOnly: spec.config?.plotVisibleOnly,
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
  const encoding = spec.encoding ?? stockLayerEncoding(spec);
  if (!encoding) {
    throw new Error('Stock chart export requires an x/category encoding');
  }
  const sheetName = options?.sheetName ?? 'Sheet1';
  const stockVisual = stockLayerVisual(spec);

  const dateField = encoding.x?.field ?? 'category';

  // Detect volume/HLC/OHLC shape from the modeled stock rows.
  const hasVolume =
    stockVisual?.volumeAxisPolicy === 'stockValueAxis'
      ? false
      : data.some((row) => row.volume !== undefined);
  const hasOpen = stockLayerUsesOpenClose(spec) ?? data.some((row) => row.open !== undefined);
  const seriesFields = hasOpen ? ['open', 'high', 'low', 'close'] : ['high', 'low', 'close'];
  const seriesNames = hasOpen ? ['Open', 'High', 'Low', 'Close'] : ['High', 'Low', 'Close'];

  // Extract categories (dates) and series values from data
  const categories = data.map((row) => row[dateField]);

  const quotedSheet = quoteSheetName(sheetName);
  const catCount = categories.length;
  const catStartRow = 2;
  const catEndRow = catStartRow + catCount - 1;
  const catRef = `${quotedSheet}!$A$${catStartRow}:$A$${catEndRow}`;

  const stockStartIndex = hasVolume ? 1 : 0;
  const stockStartColumn = hasVolume ? 2 : 1;
  const seriesXMLParts = seriesFields.map((field, idx) =>
    generateStockSeriesXML({
      data,
      categories,
      field,
      name: seriesNames[idx],
      index: stockStartIndex + idx,
      valueColumnIndex: stockStartColumn + idx,
      chartKind: 'stock',
      roleVisual: stockSourceRoleVisual(stockVisual, field),
      catRef,
      catStartRow,
      catEndRow,
      sheetName: quotedSheet,
    }),
  );

  const stockCategoryAxisId = hasVolume ? AXIS_IDS.SECONDARY_CATEGORY : AXIS_IDS.CATEGORY;
  const stockValueAxisId = hasVolume ? AXIS_IDS.SECONDARY_VALUE : AXIS_IDS.VALUE;
  const volumeChartContent = hasVolume
    ? `${generateVolumeBarChartXML({
        data,
        categories,
        catRef,
        catStartRow,
        catEndRow,
        sheetName: quotedSheet,
        stockVisual,
      })}
    `
    : '';

  const chartContent = `${volumeChartContent}<c:stockChart>
    ${seriesXMLParts.join('\n    ')}
    ${generateHighLowLinesXML(stockVisual)}
    ${generateUpDownBarsXML(stockVisual, hasOpen)}
    <c:axId val="${stockCategoryAxisId}"/>
    <c:axId val="${stockValueAxisId}"/>
  </c:stockChart>`;

  // Generate axes
  const axes = hasVolume
    ? [
        generateCategoryAxisXML(encoding.x, AXIS_IDS.CATEGORY, AXIS_IDS.VALUE),
        generateValueAxisXML(undefined, AXIS_IDS.VALUE, AXIS_IDS.CATEGORY, {
          position: 'r',
          showGrid: false,
        }),
        generateCategoryAxisXML(encoding.x, AXIS_IDS.SECONDARY_CATEGORY, AXIS_IDS.SECONDARY_VALUE),
        generateValueAxisXML(encoding.y, AXIS_IDS.SECONDARY_VALUE, AXIS_IDS.SECONDARY_CATEGORY),
      ]
    : [
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
    displayBlanksAs: spec.config?.displayBlanksAs,
    plotVisibleOnly: spec.config?.plotVisibleOnly,
  });

  return { chartXml };
}

function generateVolumeBarChartXML(params: {
  data: DataRow[];
  categories: unknown[];
  catRef: string;
  catStartRow: number;
  catEndRow: number;
  sheetName: string;
  stockVisual?: StockGlyphVisualSpec;
}): string {
  const volumeSeries = generateStockSeriesXML({
    ...params,
    field: 'volume',
    name: 'Volume',
    index: 0,
    valueColumnIndex: 1,
    chartKind: 'bar',
    volumeVisual: params.stockVisual?.volume,
  });
  const gapWidth = params.stockVisual?.volume?.gapWidth ?? 150;

  return `<c:barChart>
    <c:barDir val="col"/>
    <c:grouping val="clustered"/>
    <c:varyColors val="0"/>
    ${volumeSeries}
    ${generateDataLabelsXML()}
    <c:gapWidth val="${gapWidth}"/>
    <c:overlap val="0"/>
    <c:axId val="${AXIS_IDS.CATEGORY}"/>
    <c:axId val="${AXIS_IDS.VALUE}"/>
  </c:barChart>`;
}

function generateStockSeriesXML(params: {
  data: DataRow[];
  categories: unknown[];
  field: string;
  name: string;
  index: number;
  valueColumnIndex: number;
  chartKind: 'bar' | 'stock';
  volumeVisual?: StockGlyphVolumeVisualSpec;
  roleVisual?: StockGlyphSourceRoleVisualSpec;
  catRef: string;
  catStartRow: number;
  catEndRow: number;
  sheetName: string;
}): string {
  const {
    data,
    categories,
    field,
    name,
    index,
    valueColumnIndex,
    chartKind,
    volumeVisual,
    roleVisual,
    catRef,
    catStartRow,
    catEndRow,
    sheetName,
  } = params;
  const values = data.map((row) => Number(row[field]) || 0);
  const valCol = columnLetter(valueColumnIndex);
  const valRef = `${sheetName}!$${valCol}$${catStartRow}:$${valCol}$${catEndRow}`;
  const shapePropertiesXML =
    chartKind === 'bar'
      ? generateVolumeSeriesSpPrXML(volumeVisual, index)
      : generateStockRoleSeriesStyleXML(roleVisual);

  return `<c:ser>
      <c:idx val="${index}"/>
      <c:order val="${index}"/>
      <c:tx><c:v>${escapeXml(name)}</c:v></c:tx>
      ${shapePropertiesXML}
      <c:cat>
        <c:strRef>
          <c:f>${catRef}</c:f>
          <c:strCache>
            <c:ptCount val="${categories.length}"/>
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
}

function stockSourceRoleVisual(
  stockVisual: StockGlyphVisualSpec | undefined,
  field: string,
): StockGlyphSourceRoleVisualSpec | undefined {
  if (field !== 'open' && field !== 'high' && field !== 'low' && field !== 'close') {
    return undefined;
  }
  return stockVisual?.sourceRoleVisuals?.find((visual) => visual.role === field);
}

function generateStockRoleSeriesStyleXML(
  visual: StockGlyphSourceRoleVisualSpec | undefined,
): string {
  return `${generateStockRoleLineSpPrXML(visual)}
      ${generateStockRoleMarkerXML(visual)}`;
}

function generateStockRoleLineSpPrXML(visual: StockGlyphSourceRoleVisualSpec | undefined): string {
  if (!visual?.lineVisible || visual.line.strokeWidth <= 0) {
    return `<c:spPr>
        <a:ln w="28575">
          <a:noFill/>
        </a:ln>
      </c:spPr>`;
  }
  return `<c:spPr>${generateSimpleLineXML(visual.line.stroke, visual.line.strokeWidth)}</c:spPr>`;
}

function generateStockRoleMarkerXML(visual: StockGlyphSourceRoleVisualSpec | undefined): string {
  if (!visual?.markerVisible) return '<c:marker><c:symbol val="none"/></c:marker>';

  const marker = visual.marker;
  const strokeWidth = Math.max(0, Math.round(marker.strokeWidth * 12700));
  const strokeFill =
    strokeWidth > 0
      ? `<a:solidFill>${generateSrgbColorXML(marker.stroke)}</a:solidFill>`
      : '<a:noFill/>';
  return `<c:marker>
        <c:symbol val="${stockMarkerSymbol(marker.shape)}"/>
        <c:size val="${stockMarkerSize(marker.size)}"/>
        <c:spPr>
          <a:solidFill>${generateSrgbColorXML(marker.fill)}</a:solidFill>
          <a:ln w="${strokeWidth}">
            ${strokeFill}
          </a:ln>
        </c:spPr>
      </c:marker>`;
}

function stockMarkerSymbol(shape: string): MarkerSymbol {
  switch (shape) {
    case 'square':
    case 'diamond':
    case 'star':
    case 'dash':
    case 'x':
      return shape;
    case 'triangle':
    case 'triangle-up':
      return 'triangle';
    case 'cross':
    case 'plus':
      return 'plus';
    case 'dot':
    case 'circle':
      return 'circle';
    default:
      return 'circle';
  }
}

function stockMarkerSize(area: number): number {
  return Math.max(2, Math.min(72, Math.round(Math.sqrt(area))));
}

function generateHighLowLinesXML(stockVisual: StockGlyphVisualSpec | undefined): string {
  if (!stockVisual) return '<c:hiLowLines/>';
  if (stockVisual.highLowLine.strokeWidth <= 0) return '<c:hiLowLines/>';
  return `<c:hiLowLines>${generateLineSpPrXML(stockVisual.highLowLine)}</c:hiLowLines>`;
}

function generateUpDownBarsXML(
  stockVisual: StockGlyphVisualSpec | undefined,
  hasOpen: boolean,
): string {
  if (!hasOpen || stockVisual?.priceGlyphMode !== 'upDownBody') return '';
  return `<c:upDownBars>
      <c:gapWidth val="${stockVisual.gapWidth}"/>
      <c:upBars>${generateBodySpPrXML(stockVisual.upBody)}</c:upBars>
      <c:downBars>${generateBodySpPrXML(stockVisual.downBody)}</c:downBars>
    </c:upDownBars>`;
}

function generateLineSpPrXML(visual: StockGlyphStrokeVisualSpec): string {
  return `<c:spPr>${generateSimpleLineXML(visual.stroke, visual.strokeWidth)}</c:spPr>`;
}

function generateBodySpPrXML(visual: StockGlyphBodyVisualSpec): string {
  return generateShapePropertiesXML({
    fill: visual.fill,
    stroke: visual.borderWidth > 0 ? visual.border : undefined,
    strokeWidth: visual.borderWidth > 0 ? visual.borderWidth : undefined,
  });
}

function generateVolumeSeriesSpPrXML(
  visual: StockGlyphVolumeVisualSpec | undefined,
  index: number,
): string {
  if (!visual) {
    return `<c:spPr>
        <a:solidFill><a:srgbClr val="${getDefaultColor(index)}"/></a:solidFill>
        <a:ln><a:noFill/></a:ln>
      </c:spPr>`;
  }
  return generateShapePropertiesXML({
    fill: visual.fill,
    stroke: visual.borderWidth > 0 ? visual.border : undefined,
    strokeWidth: visual.borderWidth > 0 ? visual.borderWidth : undefined,
  });
}
