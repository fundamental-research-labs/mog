/**
 * Shared Series XML Generation for OOXML Chart Export
 *
 * Extracts the common pattern for generating <c:ser> elements with
 * <c:cat> and <c:val> children used by bar, line, and area chart generators.
 *
 * Each chart type provides its own shape properties and extra child elements
 * via the options parameter.
 *
 * Pure functions - no side effects.
 */

import { quoteSheetName } from '@mog/spreadsheet-utils';
import type { SeriesData, TrendlineConfig } from '../ooxml-types';
import { columnLetter } from './column-util';
import { escapeXml } from './style-xml';

/**
 * Options for customizing the category/value series XML.
 */
export interface CategoryValueSeriesXMLOptions {
  /** Shape properties XML string (<c:spPr> or its children) */
  shapePropertiesXML: string;
  /** Extra XML elements to insert after <c:spPr> and before <c:cat> */
  beforeCatXML?: string;
  /** Extra XML elements to insert after <c:val> (e.g., <c:smooth>) */
  afterValXML?: string;
}

/**
 * Generate a single <c:ser> element with <c:cat>/<c:val> structure.
 *
 * This is the shared implementation used by bar, line, and area chart generators.
 * They all produce the same idx/order/tx/cat/val structure but differ in:
 * - Shape properties (fill vs line styling)
 * - Extra elements (markers, smooth, invertIfNegative)
 *
 * @param series - Series data (name, categories, values, color)
 * @param index - Series index (for idx/order and column letter)
 * @param sheetName - Worksheet name for cell references
 * @param options - Chart-type-specific XML fragments
 * @returns Complete <c:ser> XML string
 */
export function generateCategoryValueSeriesXML(
  series: SeriesData,
  index: number,
  sheetName: string,
  options: CategoryValueSeriesXMLOptions,
): string {
  const catCount = series.categories.length;
  const valCount = series.values.length;

  // Generate category reference (column A, starting from row 2)
  const catStartRow = 2;
  const catEndRow = catStartRow + catCount - 1;
  const quotedSheet = quoteSheetName(sheetName);
  const catRef = `${quotedSheet}!$A$${catStartRow}:$A$${catEndRow}`;

  // Generate value reference (column B, C, D, ... based on series index)
  const valCol = columnLetter(index + 1); // B, C, D, ... AA, AB, ...
  const valRef = `${quotedSheet}!$${valCol}$${catStartRow}:$${valCol}$${catEndRow}`;

  return `<c:ser>
    <c:idx val="${index}"/>
    <c:order val="${index}"/>
    <c:tx>
      <c:v>${escapeXml(series.name)}</c:v>
    </c:tx>
    ${options.shapePropertiesXML}${options.beforeCatXML ? '\n    ' + options.beforeCatXML : ''}
    <c:cat>
      <c:strRef>
        <c:f>${catRef}</c:f>
        <c:strCache>
          <c:ptCount val="${catCount}"/>
          ${series.categories.map((cat, i) => `<c:pt idx="${i}"><c:v>${escapeXml(String(cat))}</c:v></c:pt>`).join('\n          ')}
        </c:strCache>
      </c:strRef>
    </c:cat>
    <c:val>
      <c:numRef>
        <c:f>${valRef}</c:f>
        <c:numCache>
          <c:formatCode>General</c:formatCode>
          <c:ptCount val="${valCount}"/>
          ${series.values
            .map((val, i) =>
              val === null
                ? ''
                : `<c:pt idx="${i}"><c:v>${sanitizeNumericValue(val)}</c:v></c:pt>`,
            )
            .filter(Boolean)
            .join('\n          ')}
        </c:numCache>
      </c:numRef>
    </c:val>${options.afterValXML ? '\n    ' + options.afterValXML : ''}
  </c:ser>`;
}

/**
 * Sanitize a numeric value for OOXML <c:v> elements.
 *
 * NaN and Infinity values are invalid in OOXML and cause Excel to reject
 * the chart. This function replaces them with 0.
 *
 * @param value - The numeric value to sanitize
 * @returns A finite number (NaN/Infinity replaced with 0)
 */
export function sanitizeNumericValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value;
}

// =============================================================================
// Trendline XML Generation
// =============================================================================

/**
 * Generate OOXML <c:trendline> element for a series.
 *
 * @param config - Trendline configuration
 * @returns OOXML trendline XML string
 */
export function generateTrendlineXML(config: TrendlineConfig): string {
  const parts: string[] = ['<c:trendline>'];

  // Trendline type mapping
  parts.push(`  <c:trendlineType val="${config.type}"/>`);

  // Polynomial order (only for 'poly' type)
  if (config.type === 'poly' && config.order !== undefined) {
    parts.push(`  <c:order val="${config.order}"/>`);
  }

  // Moving average period (only for 'movingAvg' type)
  if (config.type === 'movingAvg' && config.period !== undefined) {
    parts.push(`  <c:period val="${config.period}"/>`);
  }

  // Forward/backward projection
  if (config.forward !== undefined) {
    parts.push(`  <c:forward val="${config.forward}"/>`);
  }
  if (config.backward !== undefined) {
    parts.push(`  <c:backward val="${config.backward}"/>`);
  }

  // Display R-squared value
  parts.push(`  <c:dispRSqr val="${config.dispRSqr ? '1' : '0'}"/>`);

  // Display equation
  parts.push(`  <c:dispEq val="${config.dispEq ? '1' : '0'}"/>`);

  parts.push('</c:trendline>');
  return parts.join('\n');
}

// =============================================================================
// Opacity XML Generation
// =============================================================================

/**
 * Convert opacity (0-1) to OOXML alpha value (inverse: 0-100000).
 * OOXML alpha of 0 means fully opaque, 100000 means fully transparent.
 *
 * @param opacity - Opacity value from 0 (transparent) to 1 (opaque)
 * @returns OOXML alpha value (0-100000)
 */
export function opacityToOOXMLAlpha(opacity: number): number {
  return Math.round((1 - opacity) * 100000);
}
