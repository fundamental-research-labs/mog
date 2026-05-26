/**
 * Axis XML Generator for OOXML Chart Export
 *
 * Generates category, value, and date axis elements for Excel charts.
 * Based on Office Open XML (ECMA-376) Drawing ML specifications.
 *
 * Pure functions - no side effects.
 */

import type { ChannelSpec } from '../../grammar/spec';
import type { CategoryAxisConfig, DateAxisConfig, ValueAxisConfig } from '../ooxml-types';
import { escapeXml } from './style-xml';

// =============================================================================
// Axis ID Management
// =============================================================================

/**
 * Standard axis IDs used in Excel charts.
 * These are arbitrary but must be consistent within a chart.
 */
export const AXIS_IDS = {
  CATEGORY: 1,
  VALUE: 2,
  SECONDARY_CATEGORY: 3,
  SECONDARY_VALUE: 4,
} as const;

// =============================================================================
// Category Axis (catAx)
// =============================================================================

/**
 * Generate category axis XML element.
 *
 * Used for: bar charts (x-axis), line charts (x-axis), pie charts (not used)
 *
 * @param channel - Channel spec for the axis (optional)
 * @param axisId - Unique axis ID
 * @param crossAxisId - ID of the crossing axis
 * @param config - Additional axis configuration
 */
export function generateCategoryAxisXML(
  channel: ChannelSpec | undefined,
  axisId: number,
  crossAxisId: number,
  config?: CategoryAxisConfig,
): string {
  const title = channel?.title ?? config?.title;
  const position = config?.position ?? 'b';
  const showLabels = config?.showLabels !== false;
  const showGrid = config?.showGrid !== false;

  // Convert position to axPos value
  const axPos = positionToAxPos(position);

  return `<c:catAx>
    <c:axId val="${axisId}"/>
    <c:scaling>
      <c:orientation val="minMax"/>
    </c:scaling>
    <c:delete val="0"/>
    <c:axPos val="${axPos}"/>
    ${showGrid ? generateMajorGridlinesXML() : ''}
    ${title ? generateAxisTitleXML(title) : ''}
    <c:numFmt formatCode="General" sourceLinked="1"/>
    <c:majorTickMark val="out"/>
    <c:minorTickMark val="none"/>
    <c:tickLblPos val="${showLabels ? 'nextTo' : 'none'}"/>
    ${generateAxisSpPrXML()}
    ${generateAxisTxPrXML(config?.labelAngle)}
    <c:crossAx val="${crossAxisId}"/>
    <c:crosses val="autoZero"/>
    <c:auto val="1"/>
    <c:lblAlgn val="ctr"/>
    <c:lblOffset val="100"/>
    <c:noMultiLvlLbl val="0"/>
  </c:catAx>`;
}

// =============================================================================
// Value Axis (valAx)
// =============================================================================

/**
 * Generate value axis XML element.
 *
 * Used for: bar charts (y-axis), line charts (y-axis), scatter charts (both axes)
 *
 * @param channel - Channel spec for the axis (optional)
 * @param axisId - Unique axis ID
 * @param crossAxisId - ID of the crossing axis
 * @param config - Additional axis configuration
 */
export function generateValueAxisXML(
  channel: ChannelSpec | undefined,
  axisId: number,
  crossAxisId: number,
  config?: ValueAxisConfig,
): string {
  const title = channel?.title ?? config?.title;
  const position = config?.position ?? 'l';
  const format = channel?.format ?? config?.format ?? 'General';
  const showGrid = config?.showGrid !== false;

  // Convert position to axPos value
  const axPos = positionToAxPos(position);

  // Scaling element with optional min/max
  let scalingXML = '<c:scaling><c:orientation val="minMax"/>';
  if (config?.min !== undefined && config.min !== null) {
    scalingXML += `<c:min val="${config.min}"/>`;
  }
  if (config?.max !== undefined && config.max !== null) {
    scalingXML += `<c:max val="${config.max}"/>`;
  }
  scalingXML += '</c:scaling>';

  return `<c:valAx>
    <c:axId val="${axisId}"/>
    ${scalingXML}
    <c:delete val="0"/>
    <c:axPos val="${axPos}"/>
    ${showGrid ? generateMajorGridlinesXML() : ''}
    ${title ? generateAxisTitleXML(title) : ''}
    <c:numFmt formatCode="${format}" sourceLinked="0"/>
    <c:majorTickMark val="out"/>
    <c:minorTickMark val="none"/>
    <c:tickLblPos val="nextTo"/>
    ${generateAxisSpPrXML()}
    ${generateAxisTxPrXML()}
    <c:crossAx val="${crossAxisId}"/>
    <c:crosses val="autoZero"/>
    <c:crossBetween val="between"/>
  </c:valAx>`;
}

// =============================================================================
// Date Axis (dateAx)
// =============================================================================

/**
 * Generate date axis XML element.
 *
 * Used for: time series charts
 *
 * @param channel - Channel spec for the axis (optional)
 * @param axisId - Unique axis ID
 * @param crossAxisId - ID of the crossing axis
 * @param config - Additional axis configuration
 */
export function generateDateAxisXML(
  channel: ChannelSpec | undefined,
  axisId: number,
  crossAxisId: number,
  config?: DateAxisConfig,
): string {
  const title = channel?.title ?? config?.title;
  const unit = config?.unit ?? 'days';
  const showGrid = config?.showGrid !== false;

  // Map unit to OOXML base time unit
  const baseTimeUnit = unit === 'years' ? 'years' : unit === 'months' ? 'months' : 'days';

  return `<c:dateAx>
    <c:axId val="${axisId}"/>
    <c:scaling>
      <c:orientation val="minMax"/>
    </c:scaling>
    <c:delete val="0"/>
    <c:axPos val="b"/>
    ${showGrid ? generateMajorGridlinesXML() : ''}
    ${title ? generateAxisTitleXML(title) : ''}
    <c:numFmt formatCode="m/d/yyyy" sourceLinked="0"/>
    <c:majorTickMark val="out"/>
    <c:minorTickMark val="none"/>
    <c:tickLblPos val="nextTo"/>
    ${generateAxisSpPrXML()}
    ${generateAxisTxPrXML()}
    <c:crossAx val="${crossAxisId}"/>
    <c:crosses val="autoZero"/>
    <c:auto val="1"/>
    <c:lblOffset val="100"/>
    <c:baseTimeUnit val="${baseTimeUnit}"/>
  </c:dateAx>`;
}

// =============================================================================
// Series Axis (serAx) - for 3D charts
// =============================================================================

/**
 * Generate series axis XML element.
 *
 * Used for: 3D charts (depth axis)
 */
export function generateSeriesAxisXML(axisId: number, crossAxisId: number): string {
  return `<c:serAx>
    <c:axId val="${axisId}"/>
    <c:scaling>
      <c:orientation val="minMax"/>
    </c:scaling>
    <c:delete val="0"/>
    <c:axPos val="b"/>
    <c:majorTickMark val="out"/>
    <c:minorTickMark val="none"/>
    <c:tickLblPos val="nextTo"/>
    ${generateAxisSpPrXML()}
    <c:crossAx val="${crossAxisId}"/>
    <c:crosses val="autoZero"/>
  </c:serAx>`;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert position string to OOXML axPos value.
 */
function positionToAxPos(position: 'b' | 't' | 'l' | 'r'): 'b' | 't' | 'l' | 'r' {
  return position;
}

/**
 * Generate major gridlines XML.
 */
function generateMajorGridlinesXML(): string {
  return `<c:majorGridlines>
    <c:spPr>
      <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr">
        <a:solidFill>
          <a:schemeClr val="tx1">
            <a:lumMod val="15000"/>
            <a:lumOff val="85000"/>
          </a:schemeClr>
        </a:solidFill>
        <a:round/>
      </a:ln>
    </c:spPr>
  </c:majorGridlines>`;
}

/**
 * Generate axis title XML.
 */
function generateAxisTitleXML(title: string): string {
  return `<c:title>
    <c:tx>
      <c:rich>
        <a:bodyPr rot="-5400000" vert="horz"/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr sz="1000" b="0"/>
          </a:pPr>
          <a:r>
            <a:rPr lang="en-US" sz="1000" b="0">
              <a:solidFill>
                <a:schemeClr val="tx1">
                  <a:lumMod val="65000"/>
                  <a:lumOff val="35000"/>
                </a:schemeClr>
              </a:solidFill>
              <a:latin typeface="+mn-lt"/>
            </a:rPr>
            <a:t>${escapeXml(title)}</a:t>
          </a:r>
        </a:p>
      </c:rich>
    </c:tx>
    <c:layout/>
    <c:overlay val="0"/>
  </c:title>`;
}

/**
 * Generate axis shape properties (line styling).
 */
function generateAxisSpPrXML(): string {
  return `<c:spPr>
    <a:noFill/>
    <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr">
      <a:solidFill>
        <a:schemeClr val="tx1">
          <a:lumMod val="25000"/>
          <a:lumOff val="75000"/>
        </a:schemeClr>
      </a:solidFill>
      <a:round/>
    </a:ln>
  </c:spPr>`;
}

/**
 * Generate axis text properties (label styling).
 */
function generateAxisTxPrXML(labelAngle?: number): string {
  const rotAttr = labelAngle !== undefined ? ` rot="${labelAngle * 60000}"` : '';

  return `<c:txPr>
    <a:bodyPr${rotAttr} vert="horz"/>
    <a:lstStyle/>
    <a:p>
      <a:pPr>
        <a:defRPr sz="900" b="0">
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
// Convenience Functions
// =============================================================================

/**
 * Generate both category and value axes for a standard bar/line chart.
 */
export function generateStandardAxesXML(
  xChannel: ChannelSpec | undefined,
  yChannel: ChannelSpec | undefined,
  options?: {
    categoryAxisId?: number;
    valueAxisId?: number;
    showCategoryGrid?: boolean;
    showValueGrid?: boolean;
  },
): string[] {
  const catAxisId = options?.categoryAxisId ?? AXIS_IDS.CATEGORY;
  const valAxisId = options?.valueAxisId ?? AXIS_IDS.VALUE;

  return [
    generateCategoryAxisXML(xChannel, catAxisId, valAxisId, {
      showGrid: options?.showCategoryGrid,
    }),
    generateValueAxisXML(yChannel, valAxisId, catAxisId, {
      showGrid: options?.showValueGrid,
    }),
  ];
}

/**
 * Generate both value axes for a scatter chart (XY chart).
 */
export function generateScatterAxesXML(
  xChannel: ChannelSpec | undefined,
  yChannel: ChannelSpec | undefined,
  options?: {
    xAxisId?: number;
    yAxisId?: number;
    showXGrid?: boolean;
    showYGrid?: boolean;
  },
): string[] {
  const xAxisId = options?.xAxisId ?? AXIS_IDS.CATEGORY;
  const yAxisId = options?.yAxisId ?? AXIS_IDS.VALUE;

  return [
    generateValueAxisXML(xChannel, xAxisId, yAxisId, {
      position: 'b',
      showGrid: options?.showXGrid,
    }),
    generateValueAxisXML(yChannel, yAxisId, xAxisId, {
      position: 'l',
      showGrid: options?.showYGrid,
    }),
  ];
}
