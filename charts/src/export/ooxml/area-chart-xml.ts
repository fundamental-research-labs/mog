/**
 * Area Chart XML Generator for OOXML Chart Export
 *
 * Generates <c:areaChart> elements for Excel area charts.
 * Based on Office Open XML (ECMA-376) Drawing ML specifications.
 *
 * Supports:
 * - Standard area charts
 * - Stacked area charts
 * - Percent stacked area charts
 *
 * Pure functions - no side effects.
 */

import type { ChartSpec, DataRow } from '../../grammar/spec';
import type { ExportOptions, OOXMLExportResult, SeriesData } from '../ooxml-types';
import { AXIS_IDS, generateCategoryAxisXML, generateValueAxisXML } from './axis-xml';
import { extractChartTitle, wrapChartXML } from './chart-xml';
import { extractSeriesData } from './data-util';
import { generateCategoryValueSeriesXML } from './shared-xml';
import { generateDataLabelsXML } from './style-xml';

// =============================================================================
// Types
// =============================================================================

/**
 * Area chart grouping mode.
 */
type AreaGrouping = 'standard' | 'stacked' | 'percentStacked';

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Generate OOXML for an area chart.
 *
 * @param spec - ChartSpec with mark: 'area'
 * @param data - Data rows for the chart
 * @param options - Export options
 */
export function generateAreaChartXML(
  spec: ChartSpec,
  data: DataRow[],
  options?: ExportOptions,
): OOXMLExportResult {
  const encoding = spec.encoding!;
  const sheetName = options?.sheetName ?? 'Sheet1';

  // Detect grouping (standard, stacked, percentStacked)
  const grouping = detectAreaGrouping(spec);

  // Extract series data
  const seriesData = extractSeriesData(data, encoding, { chartType: 'Area chart' });

  // Generate area chart content
  const chartContent = generateAreaChartContent(seriesData, grouping, sheetName);

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
 * Generate the <c:areaChart> element content.
 */
function generateAreaChartContent(
  seriesData: SeriesData[],
  grouping: AreaGrouping,
  sheetName: string,
): string {
  return `<c:areaChart>
    <c:grouping val="${grouping}"/>
    <c:varyColors val="0"/>
    ${seriesData.map((series, idx) => generateAreaSeriesXML(series, idx, sheetName)).join('\n    ')}
    ${generateDataLabelsXML()}
    <c:axId val="${AXIS_IDS.CATEGORY}"/>
    <c:axId val="${AXIS_IDS.VALUE}"/>
  </c:areaChart>`;
}

/**
 * Generate a single area series XML element.
 * Delegates to shared generateCategoryValueSeriesXML with area-specific styling.
 */
function generateAreaSeriesXML(series: SeriesData, index: number, sheetName: string): string {
  return generateCategoryValueSeriesXML(series, index, sheetName, {
    shapePropertiesXML: `<c:spPr>
      <a:solidFill>
        <a:srgbClr val="${series.color}">
          <a:alpha val="70000"/>
        </a:srgbClr>
      </a:solidFill>
      <a:ln w="25400">
        <a:solidFill>
          <a:srgbClr val="${series.color}"/>
        </a:solidFill>
      </a:ln>
    </c:spPr>`,
  });
}

// =============================================================================
// Detection Helpers
// =============================================================================

/**
 * Detect the area grouping mode from ChartSpec config.
 */
function detectAreaGrouping(spec: ChartSpec): AreaGrouping {
  const stack = spec.config?.stack;

  if (stack === 'zero') {
    return 'stacked';
  }

  if (stack === 'normalize') {
    return 'percentStacked';
  }

  return 'standard';
}

// =============================================================================
// Radar Chart (Similar to Area but circular)
// =============================================================================

/**
 * Determine the OOXML radarStyle based on ChartSpec mark properties.
 *
 * - "filled": area mark or fillOpacity > 0 -> filled radar
 * - "marker": line mark with point/markers -> marker radar
 * - "standard": plain line radar (no fill, no explicit markers)
 */
function detectRadarStyle(spec: ChartSpec): 'standard' | 'marker' | 'filled' {
  const mark = spec.mark;
  if (typeof mark === 'object') {
    // Filled area radar
    if (mark.type === 'area') return 'filled';
    if (mark.fillOpacity !== undefined && mark.fillOpacity > 0) return 'filled';
    // Marker radar
    if (mark.point) return 'marker';
  }
  return 'standard';
}

/**
 * Generate OOXML for a radar chart.
 *
 * Uses radarStyle based on mark properties:
 * - filled area -> "filled"
 * - markers -> "marker"
 * - else -> "standard"
 *
 * @param spec - ChartSpec for radar-like visualization
 * @param data - Data rows for the chart
 * @param options - Export options
 */
export function generateRadarChartXML(
  spec: ChartSpec,
  data: DataRow[],
  options?: ExportOptions,
): OOXMLExportResult {
  const encoding = spec.encoding!;
  const sheetName = options?.sheetName ?? 'Sheet1';

  // Detect radar style from mark properties
  const radarStyle = detectRadarStyle(spec);

  // Extract series data
  const seriesData = extractSeriesData(data, encoding, { chartType: 'Radar chart' });

  // Generate radar chart content
  const chartContent = generateRadarChartContent(seriesData, radarStyle, sheetName);

  // Radar charts only have a radial axis (no category/value axes in traditional sense)
  const axes = [generateRadarCategoryAxisXML(), generateRadarValueAxisXML()];

  // Get title (preserves subtitle from TitleSpec)
  const title = extractChartTitle(spec);

  // Check if legend should be shown
  const showLegend = seriesData.length > 1;

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

/**
 * Generate the <c:radarChart> element content.
 */
function generateRadarChartContent(
  seriesData: SeriesData[],
  radarStyle: 'standard' | 'marker' | 'filled',
  sheetName: string,
): string {
  return `<c:radarChart>
    <c:radarStyle val="${radarStyle}"/>
    <c:varyColors val="0"/>
    ${seriesData.map((series, idx) => generateRadarSeriesXML(series, idx, sheetName)).join('\n    ')}
    ${generateDataLabelsXML()}
    <c:axId val="${AXIS_IDS.CATEGORY}"/>
    <c:axId val="${AXIS_IDS.VALUE}"/>
  </c:radarChart>`;
}

/**
 * Generate a single radar series XML element.
 * Delegates to shared generateCategoryValueSeriesXML with radar-specific styling.
 */
function generateRadarSeriesXML(series: SeriesData, index: number, sheetName: string): string {
  const markerXML = `<c:marker>
      <c:symbol val="circle"/>
      <c:size val="5"/>
      <c:spPr>
        <a:solidFill>
          <a:srgbClr val="${series.color}"/>
        </a:solidFill>
      </c:spPr>
    </c:marker>`;

  return generateCategoryValueSeriesXML(series, index, sheetName, {
    shapePropertiesXML: `<c:spPr>
      <a:solidFill>
        <a:srgbClr val="${series.color}">
          <a:alpha val="50000"/>
        </a:srgbClr>
      </a:solidFill>
      <a:ln w="25400">
        <a:solidFill>
          <a:srgbClr val="${series.color}"/>
        </a:solidFill>
      </a:ln>
    </c:spPr>`,
    beforeCatXML: markerXML,
  });
}

/**
 * Generate radar category axis XML.
 */
function generateRadarCategoryAxisXML(): string {
  return `<c:catAx>
    <c:axId val="${AXIS_IDS.CATEGORY}"/>
    <c:scaling>
      <c:orientation val="minMax"/>
    </c:scaling>
    <c:delete val="0"/>
    <c:axPos val="b"/>
    <c:majorGridlines/>
    <c:numFmt formatCode="General" sourceLinked="1"/>
    <c:majorTickMark val="out"/>
    <c:minorTickMark val="none"/>
    <c:tickLblPos val="nextTo"/>
    <c:crossAx val="${AXIS_IDS.VALUE}"/>
    <c:crosses val="autoZero"/>
    <c:auto val="1"/>
    <c:lblAlgn val="ctr"/>
    <c:lblOffset val="100"/>
  </c:catAx>`;
}

/**
 * Generate radar value axis XML.
 */
function generateRadarValueAxisXML(): string {
  return `<c:valAx>
    <c:axId val="${AXIS_IDS.VALUE}"/>
    <c:scaling>
      <c:orientation val="minMax"/>
    </c:scaling>
    <c:delete val="0"/>
    <c:axPos val="l"/>
    <c:majorGridlines>
      <c:spPr>
        <a:ln w="9525">
          <a:solidFill>
            <a:schemeClr val="tx1">
              <a:lumMod val="15000"/>
              <a:lumOff val="85000"/>
            </a:schemeClr>
          </a:solidFill>
        </a:ln>
      </c:spPr>
    </c:majorGridlines>
    <c:numFmt formatCode="General" sourceLinked="1"/>
    <c:majorTickMark val="out"/>
    <c:minorTickMark val="none"/>
    <c:tickLblPos val="nextTo"/>
    <c:crossAx val="${AXIS_IDS.CATEGORY}"/>
    <c:crosses val="autoZero"/>
    <c:crossBetween val="between"/>
  </c:valAx>`;
}
