/**
 * Style XML Generator for OOXML Chart Export
 *
 * Generates Drawing ML style elements for colors, fonts, and fills.
 * Based on Office Open XML (ECMA-376) Drawing ML specifications.
 *
 * Pure functions - no side effects.
 */

import { DEFAULT_CHART_COLORS, type ThemeColor } from '../ooxml-types';

// =============================================================================
// XML Escaping
// =============================================================================

/**
 * Escape special XML characters in text content.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// =============================================================================
// Color Generation
// =============================================================================

/**
 * Get a color from the default palette by index.
 */
export function getDefaultColor(index: number): string {
  return DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length];
}

/**
 * Convert hex color (with or without #) to OOXML sRGB color element.
 *
 * @param color - Hex color string (e.g., '#4472C4' or '4472C4')
 */
export function generateSrgbColorXML(color: string): string {
  const hex = color.startsWith('#') ? color.slice(1) : color;
  return `<a:srgbClr val="${hex.toUpperCase()}"/>`;
}

/**
 * Generate theme color reference XML.
 */
export function generateThemeColorXML(themeColor: ThemeColor): string {
  let xml = `<a:schemeClr val="${themeColor.val}">`;

  if (themeColor.lumMod !== undefined) {
    xml += `<a:lumMod val="${themeColor.lumMod}"/>`;
  }
  if (themeColor.lumOff !== undefined) {
    xml += `<a:lumOff val="${themeColor.lumOff}"/>`;
  }

  xml += '</a:schemeClr>';
  return xml;
}

/**
 * Generate solid fill XML element.
 *
 * @param color - Hex color string
 */
export function generateSolidFillXML(color: string): string {
  return `<a:solidFill>${generateSrgbColorXML(color)}</a:solidFill>`;
}

/**
 * Generate no fill XML element.
 */
export function generateNoFillXML(): string {
  return '<a:noFill/>';
}

// =============================================================================
// Line/Stroke Generation
// =============================================================================

/**
 * Generate line (stroke) XML element.
 *
 * @param options - Line options
 */
export function generateLineXML(options: {
  color?: string;
  width?: number;
  cap?: 'flat' | 'sq' | 'rnd';
  compound?: 'sng' | 'dbl' | 'thickThin' | 'thinThick' | 'tri';
}): string {
  const {
    color,
    width = 9525, // Default 0.75pt in EMUs
    cap = 'flat',
    compound = 'sng',
  } = options;

  let xml = `<a:ln w="${width}" cap="${cap}" cmpd="${compound}" algn="ctr">`;

  if (color) {
    xml += generateSolidFillXML(color);
  } else {
    xml += generateNoFillXML();
  }

  xml += '</a:ln>';
  return xml;
}

/**
 * Generate a simple line with color and width.
 */
export function generateSimpleLineXML(color: string, widthPt: number = 0.75): string {
  // Convert points to EMUs (1 pt = 12700 EMUs)
  const widthEmu = Math.round(widthPt * 12700);
  return generateLineXML({ color, width: widthEmu });
}

// =============================================================================
// Shape Properties Generation
// =============================================================================

/**
 * Generate shape properties (spPr) XML element.
 *
 * @param options - Shape property options
 */
export function generateShapePropertiesXML(options: {
  fill?: string;
  noFill?: boolean;
  stroke?: string;
  strokeWidth?: number;
}): string {
  const { fill, noFill, stroke, strokeWidth } = options;

  let xml = '<c:spPr>';

  // Fill
  if (noFill) {
    xml += generateNoFillXML();
  } else if (fill) {
    xml += generateSolidFillXML(fill);
  }

  // Stroke
  if (stroke) {
    xml += generateSimpleLineXML(stroke, strokeWidth ?? 0.75);
  }

  xml += '</c:spPr>';
  return xml;
}

/**
 * Generate marker shape properties for line/scatter charts.
 */
export function generateMarkerSpPrXML(color: string): string {
  return `<c:spPr>
    <a:solidFill>${generateSrgbColorXML(color)}</a:solidFill>
    <a:ln w="9525">
      <a:solidFill>${generateSrgbColorXML(color)}</a:solidFill>
    </a:ln>
  </c:spPr>`;
}

// =============================================================================
// Font/Text Generation
// =============================================================================

/**
 * Default font settings.
 */
export const DEFAULT_FONT = {
  typeface: 'Calibri',
  size: 1100, // 11pt in hundredths of a point
  color: '595959',
};

/**
 * Generate text properties (txPr) XML element.
 *
 * @param options - Text property options
 */
export function generateTextPropertiesXML(options?: {
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  rotation?: number;
}): string {
  const {
    fontSize = 1100,
    fontFamily = DEFAULT_FONT.typeface,
    color = DEFAULT_FONT.color,
    bold = false,
    italic = false,
    rotation,
  } = options ?? {};

  const rotAttr = rotation !== undefined ? ` rot="${rotation * 60000}"` : '';

  return `<c:txPr>
    <a:bodyPr${rotAttr}/>
    <a:lstStyle/>
    <a:p>
      <a:pPr>
        <a:defRPr sz="${fontSize}"${bold ? ' b="1"' : ''}${italic ? ' i="1"' : ''}>
          <a:solidFill>${generateSrgbColorXML(color)}</a:solidFill>
          <a:latin typeface="${fontFamily}"/>
        </a:defRPr>
      </a:pPr>
      <a:endParaRPr lang="en-US"/>
    </a:p>
  </c:txPr>`;
}

/**
 * Generate rich text run XML.
 */
export function generateRichTextXML(
  text: string,
  options?: {
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    bold?: boolean;
  },
): string {
  const {
    fontSize = 1100,
    fontFamily = DEFAULT_FONT.typeface,
    color = DEFAULT_FONT.color,
    bold = false,
  } = options ?? {};

  return `<a:r>
    <a:rPr lang="en-US" sz="${fontSize}"${bold ? ' b="1"' : ''}>
      <a:solidFill>${generateSrgbColorXML(color)}</a:solidFill>
      <a:latin typeface="${fontFamily}"/>
    </a:rPr>
    <a:t>${escapeXml(text)}</a:t>
  </a:r>`;
}

// =============================================================================
// Title Generation
// =============================================================================

/**
 * Generate title XML element.
 *
 * @param title - Title text or configuration
 */
export function generateTitleXML(
  title: string | { text: string; fontSize?: number; bold?: boolean },
): string {
  const text = typeof title === 'string' ? title : title.text;
  const fontSize = typeof title === 'object' ? (title.fontSize ?? 14) * 100 : 1400;
  const bold = typeof title === 'object' ? (title.bold ?? true) : true;

  return `<c:title>
    <c:tx>
      <c:rich>
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr/>
          </a:pPr>
          ${generateRichTextXML(text, { fontSize, bold })}
        </a:p>
      </c:rich>
    </c:tx>
    <c:layout/>
    <c:overlay val="0"/>
  </c:title>`;
}

// =============================================================================
// Marker Generation
// =============================================================================

/**
 * Marker symbol types for OOXML.
 */
export type MarkerSymbol =
  | 'circle'
  | 'square'
  | 'diamond'
  | 'triangle'
  | 'x'
  | 'star'
  | 'dot'
  | 'plus'
  | 'dash'
  | 'none';

/**
 * Generate marker XML element for line/scatter charts.
 *
 * @param options - Marker options
 */
export function generateMarkerXML(options: {
  symbol?: MarkerSymbol;
  size?: number;
  color?: string;
}): string {
  const { symbol = 'circle', size = 5, color } = options;

  if (symbol === 'none') {
    return '<c:marker><c:symbol val="none"/></c:marker>';
  }

  let xml = `<c:marker>
    <c:symbol val="${symbol}"/>
    <c:size val="${size}"/>`;

  if (color) {
    xml += `<c:spPr>
      <a:solidFill>${generateSrgbColorXML(color)}</a:solidFill>
      <a:ln w="9525">
        <a:solidFill>${generateSrgbColorXML(color)}</a:solidFill>
      </a:ln>
    </c:spPr>`;
  }

  xml += '</c:marker>';
  return xml;
}

// =============================================================================
// Data Labels Generation
// =============================================================================

/**
 * Generate data labels (dLbls) XML element.
 *
 * @param options - Data label options
 */
export function generateDataLabelsXML(options?: {
  showLegendKey?: boolean;
  showVal?: boolean;
  showCatName?: boolean;
  showSerName?: boolean;
  showPercent?: boolean;
  showBubbleSize?: boolean;
}): string {
  const {
    showLegendKey = false,
    showVal = false,
    showCatName = false,
    showSerName = false,
    showPercent = false,
    showBubbleSize = false,
  } = options ?? {};

  return `<c:dLbls>
    <c:showLegendKey val="${showLegendKey ? '1' : '0'}"/>
    <c:showVal val="${showVal ? '1' : '0'}"/>
    <c:showCatName val="${showCatName ? '1' : '0'}"/>
    <c:showSerName val="${showSerName ? '1' : '0'}"/>
    <c:showPercent val="${showPercent ? '1' : '0'}"/>
    <c:showBubbleSize val="${showBubbleSize ? '1' : '0'}"/>
  </c:dLbls>`;
}

// =============================================================================
// Chart Space Style
// =============================================================================

/**
 * Generate default chart space background styling.
 */
export function generateChartSpaceStyleXML(): string {
  return `<c:spPr>
    <a:solidFill><a:schemeClr val="bg1"/></a:solidFill>
    <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr">
      <a:solidFill>
        <a:schemeClr val="tx1">
          <a:lumMod val="15000"/>
          <a:lumOff val="85000"/>
        </a:schemeClr>
      </a:solidFill>
    </a:ln>
  </c:spPr>`;
}

/**
 * Generate plot area background styling.
 */
export function generatePlotAreaStyleXML(backgroundColor?: string): string {
  if (backgroundColor) {
    return `<c:spPr>
      <a:solidFill>${generateSrgbColorXML(backgroundColor)}</a:solidFill>
      <a:ln><a:noFill/></a:ln>
    </c:spPr>`;
  }

  return `<c:spPr>
    <a:noFill/>
    <a:ln><a:noFill/></a:ln>
  </c:spPr>`;
}
