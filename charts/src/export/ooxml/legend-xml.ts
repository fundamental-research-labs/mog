/**
 * Legend XML Generator for OOXML Chart Export
 *
 * Generates legend elements for Excel charts.
 * Based on Office Open XML (ECMA-376) Drawing ML specifications.
 *
 * Pure functions - no side effects.
 */

import type { LegendOrient, LegendSpec } from '../../grammar/spec';
import type { LegendPosition } from '../ooxml-types';
import { escapeXml } from './style-xml';

// =============================================================================
// Legend Position Mapping
// =============================================================================

/**
 * Map ChartSpec legend orient to OOXML legend position.
 */
function mapLegendOrient(orient: LegendOrient | undefined): LegendPosition['position'] {
  switch (orient) {
    case 'top':
      return 't';
    case 'bottom':
      return 'b';
    case 'left':
      return 'l';
    case 'right':
      return 'r';
    case 'top-right':
      return 'tr';
    case 'top-left':
    case 'bottom-left':
    case 'bottom-right':
      // These don't have direct OOXML equivalents, use closest
      return 'r';
    case 'none':
      // Return right but caller should not generate legend
      return 'r';
    default:
      return 'r'; // Default to right
  }
}

// =============================================================================
// Legend Generation
// =============================================================================

/**
 * Generate legend XML element.
 *
 * @param legendSpec - Legend specification from ChartSpec
 */
export function generateLegendXML(legendSpec?: LegendSpec | null): string {
  // If explicitly null, no legend
  if (legendSpec === null) {
    return '';
  }

  // If orient is 'none', no legend
  if (legendSpec?.orient === 'none') {
    return '';
  }

  const position = mapLegendOrient(legendSpec?.orient);
  const overlay = false; // Legend does not overlay chart by default

  return `<c:legend>
    <c:legendPos val="${position}"/>
    <c:layout/>
    <c:overlay val="${overlay ? '1' : '0'}"/>
    ${generateLegendSpPrXML()}
    ${generateLegendTxPrXML(legendSpec)}
  </c:legend>`;
}

/**
 * Generate legend from simple position config.
 */
export function generateLegendFromPositionXML(position: LegendPosition): string {
  const overlay = position.overlay ?? false;

  return `<c:legend>
    <c:legendPos val="${position.position}"/>
    <c:layout/>
    <c:overlay val="${overlay ? '1' : '0'}"/>
    ${generateLegendSpPrXML()}
    ${generateLegendTxPrXML()}
  </c:legend>`;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate legend shape properties (background, border).
 */
function generateLegendSpPrXML(): string {
  return `<c:spPr>
    <a:noFill/>
    <a:ln>
      <a:noFill/>
    </a:ln>
  </c:spPr>`;
}

/**
 * Generate legend text properties (label styling).
 */
function generateLegendTxPrXML(legendSpec?: LegendSpec): string {
  const fontSize = legendSpec?.labelFontSize ?? 9;
  const fontSizeCenti = fontSize * 100; // Convert to centi-points

  return `<c:txPr>
    <a:bodyPr/>
    <a:lstStyle/>
    <a:p>
      <a:pPr>
        <a:defRPr sz="${fontSizeCenti}" b="0">
          <a:solidFill>
            <a:schemeClr val="tx1">
              <a:lumMod val="65000"/>
              <a:lumOff val="35000"/>
            </a:schemeClr>
          </a:solidFill>
          <a:latin typeface="+mn-lt"/>
        </a:defRPr>
      </a:pPr>
      <a:endParaRPr lang="en-US"/>
    </a:p>
  </c:txPr>`;
}

// =============================================================================
// Legend Entry Customization
// =============================================================================

/**
 * Generate legend entry override for a specific series.
 *
 * Used to hide a specific series from the legend or customize its text.
 *
 * @param seriesIndex - Zero-based index of the series
 * @param options - Legend entry options
 */
export function generateLegendEntryXML(
  seriesIndex: number,
  options: {
    delete?: boolean;
    text?: string;
  },
): string {
  let xml = `<c:legendEntry>
    <c:idx val="${seriesIndex}"/>`;

  if (options.delete) {
    xml += '<c:delete val="1"/>';
  }

  if (options.text) {
    xml += `<c:txPr>
      <a:bodyPr/>
      <a:lstStyle/>
      <a:p>
        <a:pPr>
          <a:defRPr/>
        </a:pPr>
        <a:r>
          <a:rPr lang="en-US"/>
          <a:t>${escapeXml(options.text)}</a:t>
        </a:r>
      </a:p>
    </c:txPr>`;
  }

  xml += '</c:legendEntry>';
  return xml;
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Check if legend should be shown based on encoding.
 *
 * Legend is typically shown when there's a color encoding with a field.
 */
export function shouldShowLegend(colorEncoding?: { field?: string } | null): boolean {
  return colorEncoding?.field !== undefined;
}

/**
 * Get default legend position based on chart type.
 */
export function getDefaultLegendPosition(markType: string): LegendPosition['position'] {
  // Pie/doughnut charts typically have legend on the right
  if (markType === 'arc') {
    return 'r';
  }

  // Most other charts use right legend
  return 'r';
}
