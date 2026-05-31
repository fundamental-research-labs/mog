/**
 * Chart XML Wrapper for OOXML Chart Export
 *
 * Generates the main chartSpace element that wraps all chart content.
 * Based on Office Open XML (ECMA-376) Drawing ML specifications.
 *
 * Pure functions - no side effects.
 */

import type { ChartSpec, TitleSpec } from '../../grammar/spec';
import type { ChartXMLOptions, LegendPosition } from '../ooxml-types';
import { AXIS_IDS, generateValueAxisXML } from './axis-xml';
import { generateLegendFromPositionXML } from './legend-xml';
import { escapeXml, generateChartSpaceStyleXML } from './style-xml';

// =============================================================================
// XML Namespaces
// =============================================================================

/**
 * OOXML namespace declarations for chart XML.
 */
export const CHART_NAMESPACES = {
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  c14: 'http://schemas.microsoft.com/office/drawing/2007/8/2/chart',
  c16r2: 'http://schemas.microsoft.com/office/drawing/2015/06/chart',
} as const;

// =============================================================================
// Chart Space Wrapper
// =============================================================================

/**
 * Wrap chart content in a complete chartSpace XML document.
 *
 * @param content - The chart type-specific XML content (barChart, lineChart, etc.)
 * @param options - Chart wrapper options
 */
export function wrapChartXML(content: string, options: ChartXMLOptions): string {
  const { title, axes, legend } = options;
  const displayBlanksAs = normalizeDisplayBlanksAs(options.displayBlanksAs);
  const plotVisibleOnly = options.plotVisibleOnly === false ? '0' : '1';

  // Generate title XML
  const titleXML = title ? generateChartTitleXML(title) : '';
  const autoTitleDeleted = title ? '0' : '1';

  // Generate legend XML
  const legendXML = legend ? generateLegendFromPositionXML(legend) : '';

  // Generate axes XML
  const axesXML = axes ? axes.join('\n      ') : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${CHART_NAMESPACES.c}"
              xmlns:a="${CHART_NAMESPACES.a}"
              xmlns:r="${CHART_NAMESPACES.r}">
  <c:date1904 val="0"/>
  <c:lang val="en-US"/>
  <c:roundedCorners val="0"/>
  <c:chart>
    ${titleXML}
    <c:autoTitleDeleted val="${autoTitleDeleted}"/>
    <c:plotArea>
      <c:layout/>
      ${content}
      ${axesXML}
    </c:plotArea>
    ${legendXML}
    <c:plotVisOnly val="${plotVisibleOnly}"/>
    <c:dispBlanksAs val="${displayBlanksAs}"/>
    <c:showDLblsOverMax val="0"/>
  </c:chart>
  ${generateChartSpaceStyleXML()}
</c:chartSpace>`;
}

function normalizeDisplayBlanksAs(
  value: ChartXMLOptions['displayBlanksAs'],
): 'gap' | 'zero' | 'span' {
  return value === 'zero' || value === 'span' ? value : 'gap';
}

/**
 * Wrap chart content with a ChartSpec for configuration.
 *
 * If spec.resolve.scale.y is 'independent', automatically adds a secondary
 * value axis (SECONDARY_VALUE) to the axes array.
 *
 * @param content - The chart type-specific XML content
 * @param spec - The ChartSpec for title and legend configuration
 * @param axes - Array of axis XML strings
 */
export function wrapChartXMLFromSpec(content: string, spec: ChartSpec, axes?: string[]): string {
  const title = extractTitle(spec.title);
  const legend = extractLegendPosition(spec);

  // Add secondary value axis if resolve.y is 'independent' (dual-axis)
  let finalAxes = axes;
  if (spec.resolve?.scale?.y === 'independent' || spec.resolve?.axis?.y === 'independent') {
    const secondaryAxis = generateValueAxisXML(
      undefined,
      AXIS_IDS.SECONDARY_VALUE,
      AXIS_IDS.SECONDARY_CATEGORY,
      { position: 'r' },
    );
    finalAxes = [...(axes ?? []), secondaryAxis];
  }

  return wrapChartXML(content, {
    title,
    axes: finalAxes,
    legend,
    displayBlanksAs: spec.config?.displayBlanksAs,
    plotVisibleOnly: spec.config?.plotVisibleOnly,
  });
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate chart title XML from string or TitleSpec.
 * If a subtitle is present (from TitleSpec), appends it as a second paragraph
 * with smaller font size.
 */
function generateChartTitleXML(
  title: string | { text: string; fontSize?: number; bold?: boolean; subtitle?: string },
): string {
  const text = typeof title === 'string' ? title : title.text;
  const fontSize = typeof title === 'object' ? (title.fontSize ?? 14) * 100 : 1400;
  const bold = typeof title === 'object' ? (title.bold ?? true) : true;
  const subtitle = typeof title === 'object' ? title.subtitle : undefined;

  // Build subtitle paragraph if present
  const subtitleParagraph = subtitle
    ? `
        <a:p>
          <a:pPr>
            <a:defRPr sz="${Math.round(fontSize * 0.75)}" b="0" i="0" u="none" strike="noStrike" kern="1200" spc="0" baseline="0">
              <a:solidFill>
                <a:schemeClr val="tx1">
                  <a:lumMod val="50000"/>
                  <a:lumOff val="50000"/>
                </a:schemeClr>
              </a:solidFill>
              <a:latin typeface="+mn-lt"/>
              <a:ea typeface="+mn-ea"/>
              <a:cs typeface="+mn-cs"/>
            </a:defRPr>
          </a:pPr>
          <a:r>
            <a:rPr lang="en-US"/>
            <a:t>${escapeXml(subtitle)}</a:t>
          </a:r>
        </a:p>`
    : '';

  return `<c:title>
    <c:tx>
      <c:rich>
        <a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr sz="${fontSize}" b="${bold ? '1' : '0'}" i="0" u="none" strike="noStrike" kern="1200" spc="0" baseline="0">
              <a:solidFill>
                <a:schemeClr val="tx1">
                  <a:lumMod val="65000"/>
                  <a:lumOff val="35000"/>
                </a:schemeClr>
              </a:solidFill>
              <a:latin typeface="+mn-lt"/>
              <a:ea typeface="+mn-ea"/>
              <a:cs typeface="+mn-cs"/>
            </a:defRPr>
          </a:pPr>
          <a:r>
            <a:rPr lang="en-US"/>
            <a:t>${escapeXml(text)}</a:t>
          </a:r>
        </a:p>${subtitleParagraph}
      </c:rich>
    </c:tx>
    <c:layout/>
    <c:overlay val="0"/>
  </c:title>`;
}

/**
 * Extract title from a ChartSpec for use with wrapChartXML.
 * Preserves subtitle information from TitleSpec.
 * Exported for use by individual chart generators.
 */
export function extractChartTitle(
  spec: ChartSpec,
): string | { text: string; fontSize?: number; bold?: boolean; subtitle?: string } | undefined {
  return extractTitle(spec.title);
}

/**
 * Extract title string from ChartSpec title, including subtitle if present.
 */
function extractTitle(
  title: string | TitleSpec | undefined,
): string | { text: string; fontSize?: number; bold?: boolean; subtitle?: string } | undefined {
  if (!title) {
    return undefined;
  }

  if (typeof title === 'string') {
    return title;
  }

  return {
    text: title.text,
    fontSize: title.fontSize,
    bold:
      title.fontWeight === 'bold' ||
      (typeof title.fontWeight === 'number' && title.fontWeight >= 600),
    subtitle: title.subtitle,
  };
}

/**
 * Extract legend position from ChartSpec.
 */
function extractLegendPosition(spec: ChartSpec): LegendPosition | undefined {
  // Check if color encoding exists (indicates need for legend)
  const hasColorEncoding = spec.encoding?.color?.field !== undefined;

  if (!hasColorEncoding) {
    return undefined;
  }

  // Get legend spec from encoding
  const legendSpec = spec.encoding?.color?.legend;

  // If explicitly null, no legend
  if (legendSpec === null) {
    return undefined;
  }

  // Map orient to position
  const orient = legendSpec?.orient;
  let position: LegendPosition['position'] = 'r'; // Default right

  switch (orient) {
    case 'top':
      position = 't';
      break;
    case 'bottom':
      position = 'b';
      break;
    case 'left':
      position = 'l';
      break;
    case 'right':
      position = 'r';
      break;
    case 'top-right':
      position = 'tr';
      break;
    case 'none':
      return undefined;
  }

  return { position };
}

// =============================================================================
// Minimal Chart XML (No Axes)
// =============================================================================

/**
 * Wrap chart content for charts without axes (pie, doughnut).
 */
export function wrapChartXMLNoAxes(
  content: string,
  options: Omit<ChartXMLOptions, 'axes'>,
): string {
  return wrapChartXML(content, { ...options, axes: undefined });
}

// =============================================================================
// Drawing Relationship
// =============================================================================

/**
 * Generate drawing relationship XML for chart embedding.
 *
 * @param chartIndex - Chart index (1-based)
 * @param relationshipId - Relationship ID (e.g., 'rId1')
 */
export function generateDrawingRelationshipXML(
  chartIndex: number,
  relationshipId: string = 'rId1',
): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartIndex}.xml"/>
</Relationships>`;
}

// =============================================================================
// Chart Anchor (Drawing)
// =============================================================================

/**
 * Generate two-cell anchor XML for chart positioning.
 *
 * @param options - Anchor options
 */
export function generateTwoCellAnchorXML(options: {
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
  chartRelId: string;
  chartName?: string;
}): string {
  const { fromCol, fromRow, toCol, toRow, chartRelId, chartName = 'Chart 1' } = options;

  return `<xdr:twoCellAnchor>
  <xdr:from>
    <xdr:col>${fromCol}</xdr:col>
    <xdr:colOff>0</xdr:colOff>
    <xdr:row>${fromRow}</xdr:row>
    <xdr:rowOff>0</xdr:rowOff>
  </xdr:from>
  <xdr:to>
    <xdr:col>${toCol}</xdr:col>
    <xdr:colOff>0</xdr:colOff>
    <xdr:row>${toRow}</xdr:row>
    <xdr:rowOff>0</xdr:rowOff>
  </xdr:to>
  <xdr:graphicFrame macro="">
    <xdr:nvGraphicFramePr>
      <xdr:cNvPr id="2" name="${chartName}"/>
      <xdr:cNvGraphicFramePr/>
    </xdr:nvGraphicFramePr>
    <xdr:xfrm>
      <a:off x="0" y="0"/>
      <a:ext cx="0" cy="0"/>
    </xdr:xfrm>
    <a:graphic>
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${chartRelId}"/>
      </a:graphicData>
    </a:graphic>
  </xdr:graphicFrame>
  <xdr:clientData/>
</xdr:twoCellAnchor>`;
}
