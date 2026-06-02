/**
 * Pie Chart XML Generator for OOXML Chart Export
 *
 * Generates <c:pieChart> and <c:doughnutChart> elements for Excel pie charts.
 * Based on Office Open XML (ECMA-376) Drawing ML specifications.
 *
 * Supports:
 * - Standard pie charts
 * - Doughnut charts (with hole)
 * - Exploded slices
 *
 * Pure functions - no side effects.
 */

import { groupBy } from '../../algebra/group-by';
import {
  CATEGORY_FIELD,
  DATA_LABEL_VISIBLE_FIELD,
  POINT_EXPLOSION_FIELD,
  POINT_FILL_FIELD,
  POINT_INDEX_FIELD,
} from '../../core/chart-ir/fields';
import type { ChartSpec, DataRow, EncodingSpec, LegendSpec, UnitSpec } from '../../grammar/spec';
import type { ExportOptions, LegendPosition, OOXMLExportResult } from '../ooxml-types';
import { extractChartTitle, wrapChartXMLNoAxes } from './chart-xml';
import { quoteSheetName } from '@mog/spreadsheet-utils';
import { columnLetter } from './column-util';
import { doughnutRingLayers, firstDoughnutRingMark } from './pie-layer-detection';
import { sanitizeNumericValue } from './shared-xml';
import { escapeXml, getDefaultColor } from './style-xml';

// =============================================================================
// Types
// =============================================================================

/**
 * Data point for pie/doughnut chart.
 */
interface PieDataPoint {
  label: string;
  value: number;
  color: string;
  exploded?: boolean;
  explosion?: number;
}

interface PieSeriesData {
  name: string;
  points: PieDataPoint[];
}

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Generate OOXML for a pie chart.
 *
 * @param spec - ChartSpec with mark: 'arc'
 * @param data - Data rows for the chart
 * @param options - Export options
 */
export function generatePieChartXML(
  spec: ChartSpec,
  data: DataRow[],
  options?: ExportOptions,
): OOXMLExportResult {
  const mark = pieMarkForSpec(spec);
  const encoding = pieEncodingForSpec(spec);
  const sheetName = options?.sheetName ?? 'Sheet1';

  // Check if this is a doughnut chart
  const isDoughnut = detectDoughnut(mark);

  if (isDoughnut) {
    return generateDoughnutChartXML(spec, data, options);
  }

  // Extract pie data
  const pieData = extractPieData(data, encoding, mark);
  const dataLabelsXML = generatePieDataLabelsXML(data);

  // Generate pie chart content
  const chartContent = generatePieChartContent(
    pieData,
    sheetName,
    firstSliceAngleDegrees(mark),
    dataLabelsXML,
  );

  // Get title
  const title = extractChartTitle(spec);

  // Wrap in chartSpace (no axes for pie charts)
  const chartXml = wrapChartXMLNoAxes(chartContent, {
    title,
    legend: legendPositionForSpec(spec),
    displayBlanksAs: spec.config?.displayBlanksAs,
    plotVisibleOnly: spec.config?.plotVisibleOnly,
  });

  return { chartXml };
}

/**
 * Generate OOXML for a doughnut chart.
 *
 * @param spec - ChartSpec with mark: 'arc' and innerRadius > 0
 * @param data - Data rows for the chart
 * @param options - Export options
 */
export function generateDoughnutChartXML(
  spec: ChartSpec,
  data: DataRow[],
  options?: ExportOptions,
): OOXMLExportResult {
  const mark = firstDoughnutRingMark(spec) ?? pieMarkForSpec(spec);
  const encoding = pieEncodingForSpec(spec);
  const sheetName = options?.sheetName ?? 'Sheet1';

  // Calculate hole size (as percentage)
  const holeSize = calculateHoleSize(mark);

  // Extract doughnut ring data
  const seriesData = extractDoughnutSeriesData(spec, data, encoding);
  const dataLabelsXML = generatePieDataLabelsXML(data);

  // Generate doughnut chart content
  const chartContent = generateDoughnutChartContent(
    seriesData,
    holeSize,
    firstSliceAngleDegrees(mark),
    sheetName,
    dataLabelsXML,
  );

  // Get title
  const title = extractChartTitle(spec);

  // Wrap in chartSpace (no axes for doughnut charts)
  const chartXml = wrapChartXMLNoAxes(chartContent, {
    title,
    legend: legendPositionForSpec(spec),
    displayBlanksAs: spec.config?.displayBlanksAs,
    plotVisibleOnly: spec.config?.plotVisibleOnly,
  });

  return { chartXml };
}

// =============================================================================
// Chart Content Generation
// =============================================================================

/**
 * Generate the <c:pieChart> element content.
 */
function generatePieChartContent(
  pieData: PieDataPoint[],
  sheetName: string,
  firstSliceAngle: number,
  dataLabelsXML: string,
): string {
  return `<c:pieChart>
    <c:varyColors val="1"/>
    ${generatePieSeriesXML({ name: 'Series 1', points: pieData }, 0, sheetName)}
    ${dataLabelsXML}
    <c:firstSliceAng val="${firstSliceAngle}"/>
  </c:pieChart>`;
}

/**
 * Generate the <c:doughnutChart> element content.
 */
function generateDoughnutChartContent(
  seriesData: PieSeriesData[],
  holeSize: number,
  firstSliceAngle: number,
  sheetName: string,
  dataLabelsXML: string,
): string {
  return `<c:doughnutChart>
    <c:varyColors val="1"/>
    ${seriesData
      .map((series, index) => generatePieSeriesXML(series, index, sheetName))
      .join('\n    ')}
    ${dataLabelsXML}
    <c:firstSliceAng val="${firstSliceAngle}"/>
    <c:holeSize val="${holeSize}"/>
  </c:doughnutChart>`;
}

function generatePieSeriesXML(series: PieSeriesData, index: number, sheetName: string): string {
  const catCount = series.points.length;
  const quotedSheet = quoteSheetName(sheetName);
  const catRef = `${quotedSheet}!$A$2:$A$${catCount + 1}`;
  const valCol = columnLetter(index + 1);
  const valRef = `${quotedSheet}!$${valCol}$2:$${valCol}$${catCount + 1}`;

  return `<c:ser>
      <c:idx val="${index}"/>
      <c:order val="${index}"/>
      <c:tx>
        <c:v>${escapeXml(series.name)}</c:v>
      </c:tx>
      ${generateDataPointColors(series.points)}
      <c:cat>
        <c:strRef>
          <c:f>${catRef}</c:f>
          <c:strCache>
            <c:ptCount val="${catCount}"/>
            ${series.points
              .map((pt, i) => `<c:pt idx="${i}"><c:v>${escapeXml(pt.label)}</c:v></c:pt>`)
              .join('\n            ')}
          </c:strCache>
        </c:strRef>
      </c:cat>
      <c:val>
        <c:numRef>
          <c:f>${valRef}</c:f>
          <c:numCache>
            <c:formatCode>General</c:formatCode>
            <c:ptCount val="${catCount}"/>
            ${series.points
              .map(
                (pt, i) =>
                  `<c:pt idx="${i}"><c:v>${sanitizeNumericValue(pt.value)}</c:v></c:pt>`,
              )
              .join('\n            ')}
          </c:numCache>
        </c:numRef>
      </c:val>
    </c:ser>`;
}

/**
 * Generate data point color overrides.
 */
function generateDataPointColors(pieData: PieDataPoint[]): string {
  return pieData
    .map(
      (pt, i) => `<c:dPt>
      <c:idx val="${i}"/>
      <c:bubble3D val="0"/>
      ${generatePointExplosionXML(pt.explosion)}
      <c:spPr>
        <a:solidFill>
          <a:srgbClr val="${normalizeHexColor(pt.color)}"/>
        </a:solidFill>
        <a:ln>
          <a:noFill/>
        </a:ln>
      </c:spPr>
    </c:dPt>`,
    )
    .join('\n      ');
}

function generatePointExplosionXML(explosion: number | undefined): string {
  if (typeof explosion !== 'number' || !Number.isFinite(explosion) || explosion <= 0) return '';
  return `<c:explosion val="${Math.round(Math.min(400, Math.max(0, explosion)))}"/>`;
}

function generatePieDataLabelsXML(data: DataRow[]): string {
  if (!data.some((row) => row[DATA_LABEL_VISIBLE_FIELD] === true)) return '';
  return `<c:dLbls>
    <c:showLegendKey val="0"/>
    <c:showVal val="0"/>
    <c:showCatName val="0"/>
    <c:showSerName val="0"/>
    <c:showPercent val="1"/>
    <c:showBubbleSize val="0"/>
    <c:showLeaderLines val="1"/>
  </c:dLbls>`;
}

function normalizeHexColor(color: string): string {
  return (color.startsWith('#') ? color.slice(1) : color).toUpperCase();
}

// =============================================================================
// Data Extraction
// =============================================================================

/**
 * Extract pie data from data rows and encoding.
 */
function extractPieData(
  data: DataRow[],
  encoding: EncodingSpec,
  mark?: ChartSpec['mark'],
): PieDataPoint[] {
  // For pie charts, we use theta for the value and color for the category
  // Or we can use x for category and y for value
  const categoryField = encoding.color?.field ?? encoding.x?.field;
  const valueField = encoding.theta?.field ?? encoding.y?.field;

  if (!categoryField || !valueField) {
    throw new Error('Pie chart requires category and value fields');
  }

  const pointRows = data
    .filter((row) => typeof row[POINT_INDEX_FIELD] === 'number')
    .sort((a, b) => Number(a[POINT_INDEX_FIELD]) - Number(b[POINT_INDEX_FIELD]));
  if (pointRows.length > 0) {
    const colors = colorRangeForEncoding(encoding);
    return pointRows.map((row, fallbackIndex) => {
      const pointIndex = Number(row[POINT_INDEX_FIELD]);
      const labelValue = row[CATEGORY_FIELD] ?? row[categoryField];
      const value = Number(row[valueField]);
      const explosion = pointExplosionForRows(mark, pointIndex, [row]);
      return {
        label:
          labelValue !== undefined && labelValue !== null && String(labelValue).length > 0
            ? String(labelValue)
            : `Point ${pointIndex + 1}`,
        value: Number.isFinite(value) ? value : 0,
        color: pointColorForRow(row, pointIndex, fallbackIndex, colors),
        ...(explosion !== undefined ? { explosion } : {}),
      };
    });
  }

  // Group data by category using shared algebra module and sum values
  const groups = groupBy(data, categoryField);
  const colors = colorRangeForEncoding(encoding);

  const pieData: PieDataPoint[] = [];
  let colorIndex = 0;

  for (const [label, rows] of groups) {
    const value = rows.reduce((sum, row) => sum + (Number(row[valueField]) || 0), 0);
    const pointIndex = pieData.length;
    const explosion = pointExplosionForRows(mark, pointIndex, rows);
    pieData.push({
      label,
      value,
      color: colors[colorIndex] ?? getDefaultColor(colorIndex),
      ...(explosion !== undefined ? { explosion } : {}),
    });
    colorIndex++;
  }

  return pieData;
}

function pointColorForRow(
  row: DataRow,
  pointIndex: number,
  fallbackIndex: number,
  colors: readonly string[],
): string {
  const explicitFill = row[POINT_FILL_FIELD];
  if (typeof explicitFill === 'string' && explicitFill.length > 0) return explicitFill;
  if (colors.length > 0) {
    return colors[pointIndex % colors.length] ?? colors[fallbackIndex % colors.length];
  }
  return getDefaultColor(pointIndex);
}

function pointExplosionForRows(
  mark: ChartSpec['mark'] | undefined,
  pointIndex: number,
  rows: DataRow[],
): number | undefined {
  const rowExplosion =
    rows
      .map((row) => row[POINT_EXPLOSION_FIELD])
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const markExplosion = markExplosionForPoint(mark, pointIndex);
  const explosion = rowExplosion ?? markExplosion;
  return explosion > 0 ? explosion : undefined;
}

function markExplosionForPoint(mark: ChartSpec['mark'] | undefined, pointIndex: number): number {
  if (!mark || typeof mark !== 'object') return 0;
  const offset = mark._explosionOffset;
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset <= 0) return 0;
  if (mark._explodeAll) return offset;
  if (mark._explodedIndex === pointIndex) return offset;
  if (mark._explodedIndices?.includes(pointIndex)) return offset;
  return 0;
}

function extractDoughnutSeriesData(
  spec: ChartSpec,
  data: DataRow[],
  fallbackEncoding: EncodingSpec,
): PieSeriesData[] {
  const ringLayers = doughnutRingLayers(spec);
  if (ringLayers.length <= 1) {
    return [
      {
        name: seriesNameForRows(data, 0),
        points: extractPieData(data, fallbackEncoding, pieMarkForSpec(spec)),
      },
    ];
  }

  return ringLayers.map((layer, index) => {
    const rows = rowsForLayer(layer, data);
    return {
      name: seriesNameForRows(rows, index),
      points: extractPieData(rows, layer.encoding ?? fallbackEncoding, layer.mark),
    };
  });
}

function rowsForLayer(layer: UnitSpec, data: DataRow[]): DataRow[] {
  const baseRows = layer.data && 'values' in layer.data ? layer.data.values : data;
  return (layer.transform ?? []).reduce((rows, transform) => {
    if (transform.type !== 'filter' || typeof transform.filter !== 'object') return rows;
    const filter = transform.filter;
    if (!filter.field) return rows;
    if ('equal' in filter) {
      return rows.filter((row) => row[filter.field] === filter.equal);
    }
    if (Array.isArray(filter.oneOf)) {
      return rows.filter((row) => filter.oneOf?.includes(row[filter.field]));
    }
    return rows;
  }, baseRows);
}

function seriesNameForRows(rows: DataRow[], index: number): string {
  const series = rows.find((row) => typeof row.series === 'string')?.series;
  return typeof series === 'string' && series.length > 0 ? series : `Series ${index + 1}`;
}

function colorRangeForEncoding(encoding: EncodingSpec): string[] {
  const range = encoding.color?.scale?.range;
  return Array.isArray(range)
    ? range.filter((value): value is string => typeof value === 'string')
    : [];
}

// =============================================================================
// Detection Helpers
// =============================================================================

/**
 * Detect if the chart should be a doughnut (has inner radius).
 */
function detectDoughnut(mark: ChartSpec['mark']): boolean {
  if (typeof mark === 'object' && mark.type === 'arc') {
    // Check for innerRadius > 0
    return mark.innerRadius !== undefined && mark.innerRadius > 0;
  }
  return false;
}

/**
 * Calculate hole size for doughnut chart (as percentage 0-90).
 */
function calculateHoleSize(mark: ChartSpec['mark']): number {
  if (typeof mark === 'object' && mark.type === 'arc') {
    const innerRadius = mark.innerRadius;
    if (innerRadius !== undefined) {
      // If innerRadius is a ratio (0-1), convert to percentage
      if (innerRadius > 0 && innerRadius <= 1) {
        return Math.round(innerRadius * 100);
      }
      // If innerRadius is a percentage already
      if (innerRadius > 1 && innerRadius <= 100) {
        return Math.round(innerRadius);
      }
    }
  }

  // Default doughnut hole size (50%)
  return 50;
}

function pieMarkForSpec(spec: ChartSpec): ChartSpec['mark'] {
  return spec.mark ?? firstDoughnutRingMark(spec);
}

function pieEncodingForSpec(spec: ChartSpec): EncodingSpec {
  const encoding =
    spec.encoding ??
    doughnutRingLayers(spec).find((layer) => layer.encoding?.theta && layer.encoding?.color)
      ?.encoding;
  if (!encoding) {
    throw new Error('Pie chart requires an encoding');
  }
  return encoding;
}

function firstSliceAngleDegrees(mark: ChartSpec['mark']): number {
  const startAngle =
    typeof mark === 'object' &&
    typeof mark.startAngle === 'number' &&
    Number.isFinite(mark.startAngle)
      ? mark.startAngle
      : 0;
  const degrees = (startAngle * 180) / Math.PI;
  return Math.round(((degrees % 360) + 360) % 360);
}

function legendPositionForSpec(spec: ChartSpec): LegendPosition | undefined {
  const color = legendColorEncodingForSpec(spec);
  if (!color?.field) return undefined;
  if (color.legend === null) return undefined;
  if (color.legend === undefined) return { position: 'r' };
  if (color.legend.orient === 'none') return undefined;
  return {
    position: legendPositionForOrient(color.legend),
    ...(color.legend.overlay !== undefined ? { overlay: color.legend.overlay } : {}),
  };
}

function legendColorEncodingForSpec(spec: ChartSpec): EncodingSpec['color'] | undefined {
  if (spec.encoding?.color) return spec.encoding.color;
  return doughnutRingLayers(spec).find((layer) => layer.encoding?.color)?.encoding?.color;
}

function legendPositionForOrient(legend: LegendSpec): LegendPosition['position'] {
  switch (legend.orient) {
    case 'top':
      return 't';
    case 'bottom':
      return 'b';
    case 'left':
      return 'l';
    case 'top-right':
      return 'tr';
    case 'right':
    default:
      return 'r';
  }
}

// =============================================================================
// Exploded Pie Chart
// =============================================================================

/**
 * Generate OOXML for an exploded pie chart.
 *
 * @param spec - ChartSpec with mark: 'arc'
 * @param data - Data rows for the chart
 * @param explodePercentage - How much to explode slices (0-100)
 * @param options - Export options
 */
export function generateExplodedPieChartXML(
  spec: ChartSpec,
  data: DataRow[],
  explodePercentage: number = 10,
  options?: ExportOptions,
): OOXMLExportResult {
  const mark = pieMarkForSpec(spec);
  const encoding = pieEncodingForSpec(spec);
  const sheetName = options?.sheetName ?? 'Sheet1';

  // Extract pie data
  const pieData = extractPieData(data, encoding, mark);
  const dataLabelsXML = generatePieDataLabelsXML(data);

  // Generate exploded pie chart content
  const chartContent = generateExplodedPieChartContent(
    pieData,
    explodePercentage,
    firstSliceAngleDegrees(mark),
    sheetName,
    dataLabelsXML,
  );

  // Get title
  const title = extractChartTitle(spec);

  // Wrap in chartSpace (no axes for pie charts)
  const chartXml = wrapChartXMLNoAxes(chartContent, {
    title,
    legend: legendPositionForSpec(spec),
    displayBlanksAs: spec.config?.displayBlanksAs,
    plotVisibleOnly: spec.config?.plotVisibleOnly,
  });

  return { chartXml };
}

/**
 * Generate the <c:pieChart> element content with explosion.
 */
function generateExplodedPieChartContent(
  pieData: PieDataPoint[],
  explosion: number,
  firstSliceAngle: number,
  sheetName: string,
  dataLabelsXML: string,
): string {
  const catCount = pieData.length;
  const quotedSheet = quoteSheetName(sheetName);

  // Generate category reference
  const catRef = `${quotedSheet}!$A$2:$A$${catCount + 1}`;
  const valRef = `${quotedSheet}!$B$2:$B$${catCount + 1}`;

  // Generate data points with explosion
  const dPts = pieData
    .map(
      (pt, i) => `<c:dPt>
      <c:idx val="${i}"/>
      <c:bubble3D val="0"/>
      ${generatePointExplosionXML(explosion)}
      <c:spPr>
        <a:solidFill>
          <a:srgbClr val="${normalizeHexColor(pt.color)}"/>
        </a:solidFill>
        <a:ln>
          <a:noFill/>
        </a:ln>
      </c:spPr>
    </c:dPt>`,
    )
    .join('\n      ');

  return `<c:pieChart>
    <c:varyColors val="1"/>
    <c:ser>
      <c:idx val="0"/>
      <c:order val="0"/>
      <c:tx>
        <c:v>Series 1</c:v>
      </c:tx>
      ${dPts}
      <c:cat>
        <c:strRef>
          <c:f>${catRef}</c:f>
          <c:strCache>
            <c:ptCount val="${catCount}"/>
            ${pieData
              .map((pt, i) => `<c:pt idx="${i}"><c:v>${escapeXml(pt.label)}</c:v></c:pt>`)
              .join('\n            ')}
          </c:strCache>
        </c:strRef>
      </c:cat>
      <c:val>
        <c:numRef>
          <c:f>${valRef}</c:f>
          <c:numCache>
            <c:formatCode>General</c:formatCode>
            <c:ptCount val="${catCount}"/>
            ${pieData
              .map(
                (pt, i) =>
                  `<c:pt idx="${i}"><c:v>${sanitizeNumericValue(pt.value)}</c:v></c:pt>`,
              )
              .join('\n            ')}
          </c:numCache>
        </c:numRef>
      </c:val>
    </c:ser>
    ${dataLabelsXML}
    <c:firstSliceAng val="${firstSliceAngle}"/>
  </c:pieChart>`;
}
