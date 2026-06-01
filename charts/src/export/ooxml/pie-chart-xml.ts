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
import type { ChartSpec, DataRow, EncodingSpec } from '../../grammar/spec';
import type { ExportOptions, OOXMLExportResult } from '../ooxml-types';
import { extractChartTitle, wrapChartXMLNoAxes } from './chart-xml';
import { quoteSheetName } from '@mog/spreadsheet-utils';
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
  const mark = spec.mark;
  const encoding = spec.encoding!;
  const sheetName = options?.sheetName ?? 'Sheet1';

  // Check if this is a doughnut chart
  const isDoughnut = detectDoughnut(mark);

  if (isDoughnut) {
    return generateDoughnutChartXML(spec, data, options);
  }

  // Extract pie data
  const pieData = extractPieData(data, encoding);

  // Generate pie chart content
  const chartContent = generatePieChartContent(pieData, sheetName);

  // Get title
  const title = extractChartTitle(spec);

  // Wrap in chartSpace (no axes for pie charts)
  const chartXml = wrapChartXMLNoAxes(chartContent, {
    title,
    legend: { position: 'r' },
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
  const mark = spec.mark;
  const encoding = spec.encoding!;
  const sheetName = options?.sheetName ?? 'Sheet1';

  // Calculate hole size (as percentage)
  const holeSize = calculateHoleSize(mark);

  // Extract pie data
  const pieData = extractPieData(data, encoding);

  // Generate doughnut chart content
  const chartContent = generateDoughnutChartContent(pieData, holeSize, sheetName);

  // Get title
  const title = extractChartTitle(spec);

  // Wrap in chartSpace (no axes for doughnut charts)
  const chartXml = wrapChartXMLNoAxes(chartContent, {
    title,
    legend: { position: 'r' },
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
function generatePieChartContent(pieData: PieDataPoint[], sheetName: string): string {
  const catCount = pieData.length;
  const quotedSheet = quoteSheetName(sheetName);

  // Generate category reference
  const catRef = `${quotedSheet}!$A$2:$A$${catCount + 1}`;
  const valRef = `${quotedSheet}!$B$2:$B$${catCount + 1}`;

  return `<c:pieChart>
    <c:varyColors val="1"/>
    <c:ser>
      <c:idx val="0"/>
      <c:order val="0"/>
      <c:tx>
        <c:v>Series 1</c:v>
      </c:tx>
      ${generateDataPointColors(pieData)}
      <c:cat>
        <c:strRef>
          <c:f>${catRef}</c:f>
          <c:strCache>
            <c:ptCount val="${catCount}"/>
            ${pieData.map((pt, i) => `<c:pt idx="${i}"><c:v>${escapeXml(pt.label)}</c:v></c:pt>`).join('\n            ')}
          </c:strCache>
        </c:strRef>
      </c:cat>
      <c:val>
        <c:numRef>
          <c:f>${valRef}</c:f>
          <c:numCache>
            <c:formatCode>General</c:formatCode>
            <c:ptCount val="${catCount}"/>
            ${pieData.map((pt, i) => `<c:pt idx="${i}"><c:v>${sanitizeNumericValue(pt.value)}</c:v></c:pt>`).join('\n            ')}
          </c:numCache>
        </c:numRef>
      </c:val>
    </c:ser>
    ${generatePieDataLabelsXML()}
    <c:firstSliceAng val="0"/>
  </c:pieChart>`;
}

/**
 * Generate the <c:doughnutChart> element content.
 */
function generateDoughnutChartContent(
  pieData: PieDataPoint[],
  holeSize: number,
  sheetName: string,
): string {
  const catCount = pieData.length;
  const quotedSheet = quoteSheetName(sheetName);

  // Generate category reference
  const catRef = `${quotedSheet}!$A$2:$A$${catCount + 1}`;
  const valRef = `${quotedSheet}!$B$2:$B$${catCount + 1}`;

  return `<c:doughnutChart>
    <c:varyColors val="1"/>
    <c:ser>
      <c:idx val="0"/>
      <c:order val="0"/>
      <c:tx>
        <c:v>Series 1</c:v>
      </c:tx>
      ${generateDataPointColors(pieData)}
      <c:cat>
        <c:strRef>
          <c:f>${catRef}</c:f>
          <c:strCache>
            <c:ptCount val="${catCount}"/>
            ${pieData.map((pt, i) => `<c:pt idx="${i}"><c:v>${escapeXml(pt.label)}</c:v></c:pt>`).join('\n            ')}
          </c:strCache>
        </c:strRef>
      </c:cat>
      <c:val>
        <c:numRef>
          <c:f>${valRef}</c:f>
          <c:numCache>
            <c:formatCode>General</c:formatCode>
            <c:ptCount val="${catCount}"/>
            ${pieData.map((pt, i) => `<c:pt idx="${i}"><c:v>${sanitizeNumericValue(pt.value)}</c:v></c:pt>`).join('\n            ')}
          </c:numCache>
        </c:numRef>
      </c:val>
    </c:ser>
    ${generatePieDataLabelsXML()}
    <c:firstSliceAng val="0"/>
    <c:holeSize val="${holeSize}"/>
  </c:doughnutChart>`;
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
      <c:spPr>
        <a:solidFill>
          <a:srgbClr val="${pt.color}"/>
        </a:solidFill>
        <a:ln>
          <a:noFill/>
        </a:ln>
      </c:spPr>
    </c:dPt>`,
    )
    .join('\n      ');
}

/**
 * Generate pie chart data labels (shows percentage by default).
 */
function generatePieDataLabelsXML(): string {
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

// =============================================================================
// Data Extraction
// =============================================================================

/**
 * Extract pie data from data rows and encoding.
 */
function extractPieData(data: DataRow[], encoding: EncodingSpec): PieDataPoint[] {
  // For pie charts, we use theta for the value and color for the category
  // Or we can use x for category and y for value
  const categoryField = encoding.color?.field ?? encoding.x?.field;
  const valueField = encoding.theta?.field ?? encoding.y?.field;

  if (!categoryField || !valueField) {
    throw new Error('Pie chart requires category and value fields');
  }

  // Group data by category using shared algebra module and sum values
  const groups = groupBy(data, categoryField);

  const pieData: PieDataPoint[] = [];
  let colorIndex = 0;

  for (const [label, rows] of groups) {
    const value = rows.reduce((sum, row) => sum + (Number(row[valueField]) || 0), 0);
    pieData.push({
      label,
      value,
      color: getDefaultColor(colorIndex),
    });
    colorIndex++;
  }

  return pieData;
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
  const encoding = spec.encoding!;
  const sheetName = options?.sheetName ?? 'Sheet1';

  // Extract pie data
  const pieData = extractPieData(data, encoding);

  // Generate exploded pie chart content
  const chartContent = generateExplodedPieChartContent(pieData, explodePercentage, sheetName);

  // Get title
  const title = extractChartTitle(spec);

  // Wrap in chartSpace (no axes for pie charts)
  const chartXml = wrapChartXMLNoAxes(chartContent, {
    title,
    legend: { position: 'r' },
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
  sheetName: string,
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
      <c:explosion val="${explosion}"/>
      <c:spPr>
        <a:solidFill>
          <a:srgbClr val="${pt.color}"/>
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
            ${pieData.map((pt, i) => `<c:pt idx="${i}"><c:v>${escapeXml(pt.label)}</c:v></c:pt>`).join('\n            ')}
          </c:strCache>
        </c:strRef>
      </c:cat>
      <c:val>
        <c:numRef>
          <c:f>${valRef}</c:f>
          <c:numCache>
            <c:formatCode>General</c:formatCode>
            <c:ptCount val="${catCount}"/>
            ${pieData.map((pt, i) => `<c:pt idx="${i}"><c:v>${sanitizeNumericValue(pt.value)}</c:v></c:pt>`).join('\n            ')}
          </c:numCache>
        </c:numRef>
      </c:val>
    </c:ser>
    ${generatePieDataLabelsXML()}
    <c:firstSliceAng val="0"/>
  </c:pieChart>`;
}
