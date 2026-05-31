/**
 * Axis Generation
 *
 * Generates axis marks (lines, ticks, labels, titles, grid lines)
 * for X and Y axes.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import type { AnyMark, PathMark, TextMark } from '../primitives/types';
import type { AnyScale, ScaleMap } from './encoding-resolver';
import type { AxisOrient, AxisSpec, ChannelSpec, ConfigSpec, EncodingSpec, Layout } from './spec';
import {
  formatExcelValueResult,
  type ExcelNumberFormatResult,
} from '@mog/spreadsheet-utils/number-formats';

type AxisPart =
  | 'domain'
  | 'tick'
  | 'minorTick'
  | 'label'
  | 'multiLevelLabel'
  | 'grid'
  | 'minorGrid'
  | 'title'
  | 'displayUnitLabel';
type CategoryCrossingSide = 'min' | 'max';

const DEFAULT_AXIS_TITLE_PADDING = 10;
const ESTIMATED_TEXT_WIDTH_RATIO = 0.6;
const GRAMMAR_AXIS_LABEL_FONT_SIZE = 11;
const GRAMMAR_AXIS_TITLE_FONT_SIZE = 12;

function axisDatum(role: string, axisPart: AxisPart): { role: string; axisPart: AxisPart } {
  return { role, axisPart };
}

function axisPosition(scale: AnyScale, tick: unknown): number {
  const position = scale(tick) as number;
  const bandwidth =
    typeof scale.bandwidth === 'function' ? (scale.bandwidth() as number) : undefined;
  return typeof bandwidth === 'number' && Number.isFinite(bandwidth)
    ? position + bandwidth / 2
    : position;
}

function axisLabelText(
  channel: ChannelSpec,
  axisSpec: AxisSpec,
  tick: unknown,
  format: string | undefined,
): string {
  return axisLabelResult(channel, axisSpec, tick, format).text;
}

function axisLabelResult(
  channel: ChannelSpec,
  axisSpec: AxisSpec,
  tick: unknown,
  format: string | undefined,
): ExcelNumberFormatResult {
  const mapped = axisSpec.labelTextByValue?.[String(tick)];
  const formatted = formatAxisTickResult(
    channel,
    axisSpec,
    displayUnitTickValue(axisSpec, tick),
    format,
  );
  return mapped !== undefined ? { ...formatted, text: mapped } : formatted;
}

function displayUnitTickValue(axisSpec: AxisSpec, tick: unknown): unknown {
  const factor = axisSpec.displayUnitFactor;
  if (factor === undefined || factor <= 0 || !Number.isFinite(factor)) return tick;
  const numeric = typeof tick === 'number' ? tick : Number(tick);
  return Number.isFinite(numeric) ? numeric / factor : tick;
}

function axisMultiLevelLabels(
  axisSpec: AxisSpec,
  tick: unknown,
): Array<{ text: string; level: number }> | undefined {
  const labels = axisSpec.multiLevelLabelsByValue?.[String(tick)];
  if (!labels || labels.length <= 1 || !labels.some((label) => label !== '')) return undefined;
  return labels.map((label, level) => ({ text: label, level }));
}

function multiLevelAxisDatum(
  role: string,
  level: number,
): { role: string; axisPart: AxisPart; level: number } {
  return { ...axisDatum(role, 'multiLevelLabel'), level };
}

function multiLevelYAxisColumnWidth(
  labels: Array<{ text: string; level: number }>,
  fontSize: number,
): number {
  const maxLabelLength = Math.max(1, ...labels.map((label) => label.text.length));
  return Math.max(32, Math.ceil(maxLabelLength * fontSize * 0.52) + 12);
}

/**
 * Generate axis marks.
 */
export function generateAxes(
  encoding: EncodingSpec | undefined,
  scales: ScaleMap,
  layout: Layout,
  config?: ConfigSpec,
): AnyMark[] {
  const marks: AnyMark[] = [];
  const configAxis = config?.axis;

  // X-axis
  if (encoding?.x && encoding.x.axis !== null && scales.x) {
    const axisMarks = generateXAxis(encoding.x, scales.x, layout, configAxis, scales.y);
    marks.push(...axisMarks);
  }
  if (encoding?.x?.secondaryAxis && scales.x) {
    const axisMarks = generateXAxis(
      encoding.x,
      scales.x,
      layout,
      configAxis,
      scales.y,
      encoding.x.secondaryAxis,
    );
    marks.push(...axisMarks);
  }

  // Y-axis
  if (encoding?.y && encoding.y.axis !== null && scales.y) {
    const axisMarks = generateYAxis(encoding.y, scales.y, layout, configAxis, scales.x);
    marks.push(...axisMarks);
  }
  if (encoding?.y?.secondaryAxis && scales.y) {
    const axisMarks = generateYAxis(
      encoding.y,
      scales.y,
      layout,
      configAxis,
      scales.x,
      encoding.y.secondaryAxis,
    );
    marks.push(...axisMarks);
  }

  return marks;
}

/**
 * Generate X-axis marks.
 */
export function generateXAxis(
  channel: ChannelSpec,
  scale: AnyScale,
  layout: Layout,
  configAxis?: Partial<AxisSpec>,
  valueScale?: AnyScale,
  axisOverride?: AxisSpec,
): AnyMark[] {
  const marks: AnyMark[] = [];
  const axisSpec = { ...configAxis, ...(axisOverride ?? channel.axis) } as AxisSpec;
  const tickFormat = channel.format ?? axisSpec.format;
  const y = xAxisY(axisSpec, valueScale, layout);
  const orient = xAxisOrient(axisSpec);
  const role = orient === 'top' ? 'x-axis-top' : 'x-axis';

  // Axis line
  if (axisSpec.domain !== false) {
    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      datum: axisDatum(role, 'domain'),
      path: `M${layout.plotArea.x},${y} L${layout.plotArea.x + layout.plotArea.width},${y}`,
      style: {
        stroke: axisSpec.domainColor ?? '#000',
        strokeWidth: axisSpec.domainWidth ?? 1,
      },
    } as PathMark);
  }

  // Get ticks
  const ticks = getAxisTicks(scale, axisSpec);
  const minorTicks = getMinorAxisTicks(scale, axisSpec, ticks);

  // Compute label skip interval to prevent overlap.
  // Estimate label widths and determine how many labels to skip so adjacent
  // labels don't collide.
  const fontSize = axisSpec.labelFontSize ?? GRAMMAR_AXIS_LABEL_FONT_SIZE;
  const collisionFontSize = axisSpec.labelFontSize ?? GRAMMAR_AXIS_LABEL_FONT_SIZE;
  let labelSkip = normalizedSkip(axisSpec.tickLabelSkip) ?? 1;
  if (
    axisSpec.tickLabelSkip === undefined &&
    shouldAutoSkipLabels(axisSpec) &&
    axisSpec.labels !== false &&
    ticks.length > 1
  ) {
    const avgCharWidth = collisionFontSize * ESTIMATED_TEXT_WIDTH_RATIO;
    const maxLabelLen = ticks.reduce((max: number, t: unknown) => {
      const text = axisLabelText(channel, axisSpec, t, tickFormat);
      return Math.max(max, text.length);
    }, 0);
    const estimatedLabelWidth = maxLabelLen * avgCharWidth;
    // Compute minimum spacing between tick positions
    const tickPositions = ticks
      .map((t: unknown) => axisPosition(scale, t))
      .filter((x: number) => !isNaN(x))
      .sort((a: number, b: number) => a - b);
    if (tickPositions.length > 1) {
      let minSpacing = Infinity;
      for (let ti = 1; ti < tickPositions.length; ti++) {
        const spacing = tickPositions[ti] - tickPositions[ti - 1];
        if (spacing < minSpacing) minSpacing = spacing;
      }
      // If labels would overlap, compute skip factor
      if (minSpacing > 0 && estimatedLabelWidth > minSpacing) {
        labelSkip = Math.ceil(estimatedLabelWidth / minSpacing);
      }
    }
  }
  const tickSkip = normalizedSkip(axisSpec.tickMarkSkip) ?? 1;

  // Generate minor gridlines and tick marks before major labels.
  for (const tick of minorTicks) {
    const x = axisPosition(scale, tick);
    if (isNaN(x)) continue;
    if (axisSpec.minorGrid) {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: axisDatum(role, 'minorGrid'),
        path: `M${x},${layout.plotArea.y} L${x},${layout.plotArea.y + layout.plotArea.height}`,
        style: {
          stroke: axisSpec.minorGridColor ?? '#eeeeee',
          strokeWidth: axisSpec.minorGridWidth ?? 1,
          opacity: axisSpec.minorGridOpacity ?? 0.35,
          strokeDash: axisSpec.minorGridDash,
        },
      } as PathMark);
    }
    if (axisSpec.minorTicks && axisSpec.minorTickMark !== 'none') {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: axisDatum(role, 'minorTick'),
        path: xTickPath(x, y, axisSpec.minorTickSize ?? Math.max(2, (axisSpec.tickSize ?? 6) / 2), orient, axisSpec.minorTickMark),
        style: {
          stroke: axisSpec.minorTickColor ?? axisSpec.tickColor ?? '#000',
          strokeWidth: axisSpec.minorTickWidth ?? axisSpec.tickWidth ?? 1,
        },
      } as PathMark);
    }
  }

  // Generate tick marks and labels
  let labelIndex = 0;
  for (const tick of ticks) {
    const x = axisPosition(scale, tick);

    if (isNaN(x)) continue;

    const showThisLabel = labelIndex % labelSkip === 0;
    const showThisTick = labelIndex % tickSkip === 0;

    // Tick mark
    if (axisSpec.ticks !== false && axisSpec.tickMark !== 'none' && showThisTick) {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: axisDatum(role, 'tick'),
        path: xTickPath(x, y, axisSpec.tickSize ?? 6, orient, axisSpec.tickMark),
        style: {
          stroke: axisSpec.tickColor ?? '#000',
          strokeWidth: axisSpec.tickWidth ?? 1,
        },
      } as PathMark);
    }

    // Label (skip labels that would overlap or by explicit skip)
    if (axisSpec.labels !== false && axisSpec.labelPosition !== 'none' && showThisLabel) {
      const labelResult = axisLabelResult(
        channel,
        axisSpec,
        tick,
        axisSpec.labelFormatByValue?.[String(tick)] ?? tickFormat,
      );
      const labelText = labelResult.text;
      const labelAngle = axisSpec.labelAngle ?? 0;
      const tickExtent = axisSpec.ticks === false ? 0 : (axisSpec.tickSize ?? 6);
      const labelPadding = axisSpec.labelPadding ?? (labelAngle ? 2 : 3);
      const labelLayout = xLabelLayout(axisSpec, y, tickExtent, labelPadding, layout, orient);
      const multiLevelLabels = labelAngle === 0 ? axisMultiLevelLabels(axisSpec, tick) : undefined;
      if (multiLevelLabels) {
        const outward = xAxisLabelSide(axisSpec, orient) === 'top' ? -1 : 1;
        const lineHeight = fontSize + 2;
        const orderedLabels = [...multiLevelLabels].reverse();
        for (let levelIndex = 0; levelIndex < orderedLabels.length; levelIndex += 1) {
          const levelLabel = orderedLabels[levelIndex];
          marks.push({
            type: 'text',
            x,
            y: labelLayout.y + outward * lineHeight * levelIndex,
            text: levelLabel.text,
            datum: multiLevelAxisDatum(role, levelLabel.level),
            fontSize,
            fontFamily: axisSpec.labelFontFamily ?? 'system-ui, sans-serif',
            textAlign: 'center',
            textBaseline: labelLayout.baseline,
            style: {
              fill: labelResult.color ?? axisSpec.labelColor ?? '#000',
            },
          } as TextMark);
        }
      } else {
        marks.push({
          type: 'text',
          x,
          y: labelLayout.y,
          text: labelText,
          datum: axisDatum(role, 'label'),
          fontSize,
          fontFamily: axisSpec.labelFontFamily ?? 'system-ui, sans-serif',
          textAlign: 'center',
          textBaseline: labelLayout.baseline,
          rotation: labelAngle ? (labelAngle * Math.PI) / 180 : undefined,
          style: {
            fill: labelResult.color ?? axisSpec.labelColor ?? '#000',
          },
        } as TextMark);
      }
    }
    labelIndex++;

    // Grid line
    if (axisSpec.grid) {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: axisDatum(role, 'grid'),
        path: `M${x},${layout.plotArea.y} L${x},${layout.plotArea.y + layout.plotArea.height}`,
        style: {
          stroke: axisSpec.gridColor ?? '#e0e0e0',
          strokeWidth: axisSpec.gridWidth ?? 1,
          opacity: axisSpec.gridOpacity ?? 0.5,
          strokeDash: axisSpec.gridDash,
        },
      } as PathMark);
    }
  }

  // Axis title
  if (axisSpec.title !== null) {
    const title = axisSpec.title ?? channel.title;
    if (title) {
      const titleSide = xAxisLabelSide(axisSpec, orient);
      const titleFontSize = axisSpec.titleFontSize ?? GRAMMAR_AXIS_TITLE_FONT_SIZE;
      const titleY = xAxisTitleY(
        channel,
        axisSpec,
        ticks,
        scale,
        tickFormat,
        labelSkip,
        y,
        layout,
        orient,
        titleFontSize,
      );
      marks.push({
        type: 'text',
        x: layout.plotArea.x + layout.plotArea.width / 2,
        y: titleY,
        text: title,
        datum: axisDatum(role, 'title'),
        fontSize: titleFontSize,
        fontFamily: axisSpec.titleFontFamily ?? 'system-ui, sans-serif',
        textAlign: 'center',
        textBaseline: titleSide === 'top' ? 'bottom' : 'top',
        fontWeight: 'bold',
        style: {
          fill: axisSpec.titleColor ?? '#000',
        },
      } as TextMark);
    }
  }

  if (axisSpec.displayUnitLabel) {
    const labelSide = xAxisLabelSide(axisSpec, orient);
    marks.push({
      type: 'text',
      x: layout.plotArea.x + layout.plotArea.width,
      y:
        labelSide === 'top'
          ? layout.plotArea.y - 8
          : layout.plotArea.y + layout.plotArea.height + 18,
      text: axisSpec.displayUnitLabel,
      datum: axisDatum(role, 'displayUnitLabel'),
      fontSize: axisSpec.labelFontSize ?? GRAMMAR_AXIS_LABEL_FONT_SIZE,
      fontFamily: axisSpec.labelFontFamily ?? 'system-ui, sans-serif',
      textAlign: 'right',
      textBaseline: labelSide === 'top' ? 'bottom' : 'top',
      style: {
        fill: axisSpec.labelColor ?? '#000',
      },
    } as TextMark);
  }

  return marks;
}

function xAxisOrient(axisSpec: AxisSpec): Extract<AxisOrient, 'top' | 'bottom'> {
  return axisSpec.orient === 'top' ? 'top' : 'bottom';
}

function xAxisLabelSide(
  axisSpec: AxisSpec,
  orient: Extract<AxisOrient, 'top' | 'bottom'>,
): 'top' | 'bottom' {
  if (axisSpec.labelPosition === 'high') return 'top';
  if (axisSpec.labelPosition === 'low') return 'bottom';
  return orient;
}

function xLabelLayout(
  axisSpec: AxisSpec,
  axisY: number,
  tickExtent: number,
  labelPadding: number,
  layout: Layout,
  orient: Extract<AxisOrient, 'top' | 'bottom'>,
): { y: number; baseline: 'top' | 'bottom' } {
  const side = xAxisLabelSide(axisSpec, orient);
  if (axisSpec.labelPosition === 'high') {
    return { y: layout.plotArea.y - tickExtent - labelPadding, baseline: 'bottom' };
  }
  if (axisSpec.labelPosition === 'low') {
    return {
      y: layout.plotArea.y + layout.plotArea.height + tickExtent + labelPadding,
      baseline: 'top',
    };
  }
  return side === 'top'
    ? { y: axisY - tickExtent - labelPadding, baseline: 'bottom' }
    : { y: axisY + tickExtent + labelPadding, baseline: 'top' };
}

function xAxisTitleY(
  channel: ChannelSpec,
  axisSpec: AxisSpec,
  ticks: unknown[],
  scale: AnyScale,
  tickFormat: string | undefined,
  labelSkip: number,
  axisY: number,
  layout: Layout,
  orient: Extract<AxisOrient, 'top' | 'bottom'>,
  titleFontSize: number,
): number {
  const titleSide = xAxisLabelSide(axisSpec, orient);
  const titlePadding = axisSpec.titlePadding ?? DEFAULT_AXIS_TITLE_PADDING;
  const labelOuterY = xAxisLabelOuterY(
    channel,
    axisSpec,
    ticks,
    scale,
    tickFormat,
    labelSkip,
    axisY,
    layout,
    orient,
  );
  const y = titleSide === 'top' ? labelOuterY - titlePadding : labelOuterY + titlePadding;
  const clampedY = clampAxisPosition(y, titleFontSize, layout.height - titleFontSize);
  if (
    (titleSide === 'top' && clampedY <= labelOuterY - titlePadding) ||
    (titleSide === 'bottom' && clampedY >= labelOuterY + titlePadding)
  ) {
    return clampedY;
  }
  return y;
}

function xAxisLabelOuterY(
  channel: ChannelSpec,
  axisSpec: AxisSpec,
  ticks: unknown[],
  scale: AnyScale,
  tickFormat: string | undefined,
  labelSkip: number,
  axisY: number,
  layout: Layout,
  orient: Extract<AxisOrient, 'top' | 'bottom'>,
): number {
  const titleSide = xAxisLabelSide(axisSpec, orient);
  const fontSize = axisSpec.labelFontSize ?? GRAMMAR_AXIS_LABEL_FONT_SIZE;
  const tickExtent = axisSpec.ticks === false ? 0 : (axisSpec.tickSize ?? 6);
  const labelPadding = axisSpec.labelPadding ?? ((axisSpec.labelAngle ?? 0) ? 2 : 3);
  const labelLayout = xLabelLayout(axisSpec, axisY, tickExtent, labelPadding, layout, orient);

  if (axisSpec.labels === false || axisSpec.labelPosition === 'none') {
    const outwardTick =
      axisSpec.ticks === false ? 0 : outwardTickExtent(axisSpec.tickMark, tickExtent);
    return titleSide === 'top' ? axisY - outwardTick : axisY + outwardTick;
  }

  let outerY = labelLayout.y;
  let labelIndex = 0;
  let sawLabel = false;
  for (const tick of ticks) {
    const x = axisPosition(scale, tick);
    if (isNaN(x)) continue;
    const showThisLabel = labelIndex % labelSkip === 0;
    if (showThisLabel) {
      const labelResult = axisLabelResult(
        channel,
        axisSpec,
        tick,
        axisSpec.labelFormatByValue?.[String(tick)] ?? tickFormat,
      );
      const labelAngle = axisSpec.labelAngle ?? 0;
      const multiLevelLabels = labelAngle === 0 ? axisMultiLevelLabels(axisSpec, tick) : undefined;
      const labelHeight = multiLevelLabels
        ? multiLevelLabels.length * (fontSize + 2)
        : rotatedTextHeight(estimatedTextWidth(labelResult.text, fontSize), fontSize, labelAngle);
      outerY =
        titleSide === 'top'
          ? Math.min(outerY, labelLayout.y - labelHeight)
          : Math.max(outerY, labelLayout.y + labelHeight);
      sawLabel = true;
    }
    labelIndex++;
  }

  return sawLabel ? outerY : labelLayout.y;
}

function xTickPath(
  x: number,
  y: number,
  size: number,
  orient: Extract<AxisOrient, 'top' | 'bottom'>,
  tickMark: AxisSpec['tickMark'] | AxisSpec['minorTickMark'],
): string {
  const side = orient === 'top' ? -1 : 1;
  switch (tickMark) {
    case 'in':
      return `M${x},${y} L${x},${y - side * size}`;
    case 'cross':
      return `M${x},${y - side * size} L${x},${y + side * size}`;
    case 'out':
    default:
      return `M${x},${y} L${x},${y + side * size}`;
  }
}

function xAxisY(axisSpec: AxisSpec, valueScale: AnyScale | undefined, layout: Layout): number {
  const plotBottom = layout.plotArea.y + layout.plotArea.height;
  const defaultY = xAxisOrient(axisSpec) === 'top' ? layout.plotArea.y : plotBottom;
  if (!valueScale) return defaultY;

  if (axisSpec.categoryCrossing === 'midCat' && isCategoricalScale(valueScale)) {
    const side = xAxisCategoryCrossingSide(axisSpec, xAxisOrient(axisSpec));
    if (side) {
      return categoricalScaleCrossingPosition(
        valueScale,
        side,
        layout.plotArea.y,
        plotBottom,
        'y',
        defaultY,
      );
    }
  }

  switch (axisSpec.crossesAt) {
    case 'min':
      return plotBottom;
    case 'max':
      return layout.plotArea.y;
    case 'custom':
      if (axisSpec.crossesAtValue !== undefined) {
        return clampAxisPosition(
          valueScale(axisSpec.crossesAtValue) as number,
          layout.plotArea.y,
          plotBottom,
        );
      }
      return plotBottom;
    case 'automatic': {
      const domain = typeof valueScale.domain === 'function' ? valueScale.domain() : undefined;
      const min = numericDomainValue(domain, 0);
      const max = numericDomainValue(domain, 1);
      if (min !== undefined && max !== undefined && min < 0 && max > 0) {
        return clampAxisPosition(valueScale(0) as number, layout.plotArea.y, plotBottom);
      }
      return plotBottom;
    }
    default:
      return defaultY;
  }
}

function numericDomainValue(domain: unknown[] | undefined, index: number): number | undefined {
  const value = domain?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampAxisPosition(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(min, Math.min(max, value));
}

function isCategoricalScale(scale: AnyScale | undefined): scale is AnyScale {
  return Boolean(scale && typeof scale.bandwidth === 'function');
}

function xAxisCategoryCrossingSide(
  axisSpec: AxisSpec,
  orient: Extract<AxisOrient, 'top' | 'bottom'>,
): CategoryCrossingSide | undefined {
  switch (axisSpec.crossesAt) {
    case 'min':
      return 'min';
    case 'max':
      return 'max';
    case 'custom':
      return undefined;
    case 'automatic':
    default:
      return orient === 'top' ? 'max' : 'min';
  }
}

function yAxisCategoryCrossingSide(
  axisSpec: AxisSpec,
  orient: Extract<AxisOrient, 'left' | 'right'>,
): CategoryCrossingSide | undefined {
  switch (axisSpec.crossesAt) {
    case 'min':
      return 'min';
    case 'max':
      return 'max';
    case 'custom':
      return undefined;
    case 'automatic':
    default:
      return orient === 'right' ? 'max' : 'min';
  }
}

function categoricalScaleCrossingPosition(
  scale: AnyScale,
  side: CategoryCrossingSide,
  minPixel: number,
  maxPixel: number,
  dimension: 'x' | 'y',
  fallback: number,
): number {
  const domain = typeof scale.domain === 'function' ? scale.domain() : undefined;
  if (!Array.isArray(domain) || domain.length === 0) return fallback;
  const index =
    dimension === 'x'
      ? side === 'min'
        ? 0
        : domain.length - 1
      : side === 'min'
        ? domain.length - 1
        : 0;
  return clampAxisPosition(axisPosition(scale, domain[index]), minPixel, maxPixel);
}

/**
 * Generate Y-axis marks.
 */
export function generateYAxis(
  channel: ChannelSpec,
  scale: AnyScale,
  layout: Layout,
  configAxis?: Partial<AxisSpec>,
  categoryScale?: AnyScale,
  axisOverride?: AxisSpec,
): AnyMark[] {
  const marks: AnyMark[] = [];
  const axisSpec = { ...configAxis, ...(axisOverride ?? channel.axis) } as AxisSpec;
  const tickFormat = channel.format ?? axisSpec.format;
  const orient = yAxisOrient(axisSpec);
  const isRight = orient === 'right';
  const x = yAxisX(axisSpec, categoryScale, layout);
  const role = isRight ? 'y-axis-right' : 'y-axis';

  // Axis line
  if (axisSpec.domain !== false) {
    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      datum: axisDatum(role, 'domain'),
      path: `M${x},${layout.plotArea.y} L${x},${layout.plotArea.y + layout.plotArea.height}`,
      style: {
        stroke: axisSpec.domainColor ?? '#000',
        strokeWidth: axisSpec.domainWidth ?? 1,
      },
    } as PathMark);
  }

  // Get ticks
  const ticks = getAxisTicks(scale, axisSpec);
  const minorTicks = getMinorAxisTicks(scale, axisSpec, ticks);

  // Compute label skip interval to prevent vertical overlap on y-axis.
  const yFontSize = axisSpec.labelFontSize ?? GRAMMAR_AXIS_LABEL_FONT_SIZE;
  const yCollisionFontSize = axisSpec.labelFontSize ?? GRAMMAR_AXIS_LABEL_FONT_SIZE;
  let yLabelSkip = normalizedSkip(axisSpec.tickLabelSkip) ?? 1;
  if (
    axisSpec.tickLabelSkip === undefined &&
    shouldAutoSkipLabels(axisSpec) &&
    axisSpec.labels !== false &&
    ticks.length > 1
  ) {
    const tickPositions = ticks
      .map((t: unknown) => axisPosition(scale, t))
      .filter((v: number) => !isNaN(v))
      .sort((a: number, b: number) => a - b);
    if (tickPositions.length > 1) {
      let minSpacing = Infinity;
      for (let ti = 1; ti < tickPositions.length; ti++) {
        const spacing = tickPositions[ti] - tickPositions[ti - 1];
        if (spacing < minSpacing) minSpacing = spacing;
      }
      // Each label needs at least fontSize height
      if (minSpacing > 0 && yCollisionFontSize > minSpacing) {
        yLabelSkip = Math.ceil(yCollisionFontSize / minSpacing);
      }
    }
  }
  const tickSkip = normalizedSkip(axisSpec.tickMarkSkip) ?? 1;

  for (const tick of minorTicks) {
    const y = axisPosition(scale, tick);
    if (isNaN(y)) continue;

    if (axisSpec.minorGrid) {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: axisDatum(role, 'minorGrid'),
        path: `M${layout.plotArea.x},${y} L${layout.plotArea.x + layout.plotArea.width},${y}`,
        style: {
          stroke: axisSpec.minorGridColor ?? '#eeeeee',
          strokeWidth: axisSpec.minorGridWidth ?? 1,
          opacity: axisSpec.minorGridOpacity ?? 0.35,
          strokeDash: axisSpec.minorGridDash,
        },
      } as PathMark);
    }
    if (axisSpec.minorTicks && axisSpec.minorTickMark !== 'none') {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: axisDatum(role, 'minorTick'),
        path: yTickPath(
          x,
          y,
          axisSpec.minorTickSize ?? Math.max(2, (axisSpec.tickSize ?? 6) / 2),
          orient,
          axisSpec.minorTickMark,
        ),
        style: {
          stroke: axisSpec.minorTickColor ?? axisSpec.tickColor ?? '#000',
          strokeWidth: axisSpec.minorTickWidth ?? axisSpec.tickWidth ?? 1,
        },
      } as PathMark);
    }
  }

  // Generate tick marks and labels
  let yLabelIndex = 0;
  for (const tick of ticks) {
    const y = axisPosition(scale, tick);

    if (isNaN(y)) continue;

    const showThisLabel = yLabelIndex % yLabelSkip === 0;
    const showThisTick = yLabelIndex % tickSkip === 0;

    // Tick mark
    if (axisSpec.ticks !== false && axisSpec.tickMark !== 'none' && showThisTick) {
      const tickSize = axisSpec.tickSize ?? 6;
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: axisDatum(role, 'tick'),
        path: yTickPath(x, y, tickSize, orient, axisSpec.tickMark),
        style: {
          stroke: axisSpec.tickColor ?? '#000',
          strokeWidth: axisSpec.tickWidth ?? 1,
        },
      } as PathMark);
    }

    // Label (skip labels that would overlap vertically or by explicit skip)
    if (axisSpec.labels !== false && axisSpec.labelPosition !== 'none' && showThisLabel) {
      const labelResult = axisLabelResult(
        channel,
        axisSpec,
        tick,
        axisSpec.labelFormatByValue?.[String(tick)] ?? tickFormat,
      );
      const labelText = labelResult.text;

      const tickSize = axisSpec.ticks === false ? 0 : (axisSpec.tickSize ?? 6);
      const labelPadding = axisSpec.labelPadding ?? 3;
      const labelLayout = yLabelLayout(axisSpec, x, tickSize, labelPadding, layout, orient);
      const labelAngle = axisSpec.labelAngle ?? 0;
      const multiLevelLabels = labelAngle === 0 ? axisMultiLevelLabels(axisSpec, tick) : undefined;
      if (multiLevelLabels) {
        const outward = yAxisLabelSide(axisSpec, orient) === 'right' ? 1 : -1;
        const columnWidth = multiLevelYAxisColumnWidth(multiLevelLabels, yFontSize);
        const orderedLabels = [...multiLevelLabels].reverse();
        for (let levelIndex = 0; levelIndex < orderedLabels.length; levelIndex += 1) {
          const levelLabel = orderedLabels[levelIndex];
          marks.push({
            type: 'text',
            x: labelLayout.x + outward * columnWidth * levelIndex,
            y,
            text: levelLabel.text,
            datum: multiLevelAxisDatum(role, levelLabel.level),
            fontSize: yFontSize,
            fontFamily: axisSpec.labelFontFamily ?? 'system-ui, sans-serif',
            textAlign: labelLayout.align,
            textBaseline: 'middle',
            style: {
              fill: labelResult.color ?? axisSpec.labelColor ?? '#000',
            },
          } as TextMark);
        }
      } else {
        marks.push({
          type: 'text',
          x: labelLayout.x,
          y,
          text: labelText,
          datum: axisDatum(role, 'label'),
          fontSize: yFontSize,
          fontFamily: axisSpec.labelFontFamily ?? 'system-ui, sans-serif',
          textAlign: labelLayout.align,
          textBaseline: 'middle',
          rotation: labelAngle ? (labelAngle * Math.PI) / 180 : undefined,
          style: {
            fill: labelResult.color ?? axisSpec.labelColor ?? '#000',
          },
        } as TextMark);
      }
    }
    yLabelIndex++;

    // Grid line
    if (axisSpec.grid) {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: axisDatum(role, 'grid'),
        path: `M${layout.plotArea.x},${y} L${layout.plotArea.x + layout.plotArea.width},${y}`,
        style: {
          stroke: axisSpec.gridColor ?? '#e0e0e0',
          strokeWidth: axisSpec.gridWidth ?? 1,
          opacity: axisSpec.gridOpacity ?? 0.5,
          strokeDash: axisSpec.gridDash,
        },
      } as PathMark);
    }
  }

  // Axis title
  if (axisSpec.title !== null) {
    const title = axisSpec.title ?? channel.title;
    if (title) {
      const titleSide = yAxisLabelSide(axisSpec, orient);
      const titleFontSize = axisSpec.titleFontSize ?? GRAMMAR_AXIS_TITLE_FONT_SIZE;
      const titleX = yAxisTitleX(
        channel,
        axisSpec,
        ticks,
        scale,
        tickFormat,
        yLabelSkip,
        x,
        layout,
        orient,
        titleFontSize,
      );
      marks.push({
        type: 'text',
        x: titleX,
        y: layout.plotArea.y + layout.plotArea.height / 2,
        text: title,
        datum: axisDatum(role, 'title'),
        fontSize: titleFontSize,
        fontFamily: axisSpec.titleFontFamily ?? 'system-ui, sans-serif',
        textAlign: 'center',
        textBaseline: 'middle',
        fontWeight: 'bold',
        rotation: titleSide === 'right' ? Math.PI / 2 : -Math.PI / 2,
        style: {
          fill: axisSpec.titleColor ?? '#000',
        },
      } as TextMark);
    }
  }

  if (axisSpec.displayUnitLabel) {
    const labelSide = yAxisLabelSide(axisSpec, orient);
    marks.push({
      type: 'text',
      x: labelSide === 'right' ? layout.plotArea.x + layout.plotArea.width + 8 : layout.plotArea.x - 8,
      y: layout.plotArea.y - 10,
      text: axisSpec.displayUnitLabel,
      datum: axisDatum(role, 'displayUnitLabel'),
      fontSize: axisSpec.labelFontSize ?? GRAMMAR_AXIS_LABEL_FONT_SIZE,
      fontFamily: axisSpec.labelFontFamily ?? 'system-ui, sans-serif',
      textAlign: labelSide === 'right' ? 'left' : 'right',
      textBaseline: 'bottom',
      style: {
        fill: axisSpec.labelColor ?? '#000',
      },
    } as TextMark);
  }

  return marks;
}

function yAxisOrient(axisSpec: AxisSpec): Extract<AxisOrient, 'left' | 'right'> {
  return axisSpec.orient === 'right' ? 'right' : 'left';
}

function yAxisLabelSide(
  axisSpec: AxisSpec,
  orient: Extract<AxisOrient, 'left' | 'right'>,
): 'left' | 'right' {
  if (axisSpec.labelPosition === 'high') return 'right';
  if (axisSpec.labelPosition === 'low') return 'left';
  return orient;
}

function yAxisX(axisSpec: AxisSpec, categoryScale: AnyScale | undefined, layout: Layout): number {
  const plotLeft = layout.plotArea.x;
  const plotRight = layout.plotArea.x + layout.plotArea.width;
  const defaultX = yAxisOrient(axisSpec) === 'right' ? plotRight : plotLeft;
  if (!categoryScale) return defaultX;

  if (axisSpec.categoryCrossing === 'midCat' && isCategoricalScale(categoryScale)) {
    const side = yAxisCategoryCrossingSide(axisSpec, yAxisOrient(axisSpec));
    if (side) {
      return categoricalScaleCrossingPosition(
        categoryScale,
        side,
        plotLeft,
        plotRight,
        'x',
        defaultX,
      );
    }
  }

  switch (axisSpec.crossesAt) {
    case 'min':
      return plotLeft;
    case 'max':
      return plotRight;
    case 'custom':
      if (
        axisSpec.crossesAtValue !== undefined &&
        typeof categoryScale.bandwidth !== 'function'
      ) {
        return clampAxisPosition(
          categoryScale(axisSpec.crossesAtValue) as number,
          plotLeft,
          plotRight,
        );
      }
      return defaultX;
    case 'automatic': {
      if (typeof categoryScale.bandwidth === 'function') return defaultX;
      const domain = typeof categoryScale.domain === 'function' ? categoryScale.domain() : undefined;
      const min = numericDomainValue(domain, 0);
      const max = numericDomainValue(domain, 1);
      if (min !== undefined && max !== undefined && min < 0 && max > 0) {
        return clampAxisPosition(categoryScale(0) as number, plotLeft, plotRight);
      }
      return defaultX;
    }
    default:
      return defaultX;
  }
}

function yLabelLayout(
  axisSpec: AxisSpec,
  axisX: number,
  tickExtent: number,
  labelPadding: number,
  layout: Layout,
  orient: Extract<AxisOrient, 'left' | 'right'>,
): { x: number; align: 'left' | 'right' } {
  const side = yAxisLabelSide(axisSpec, orient);
  if (axisSpec.labelPosition === 'high') {
    return {
      x: layout.plotArea.x + layout.plotArea.width + tickExtent + labelPadding,
      align: 'left',
    };
  }
  if (axisSpec.labelPosition === 'low') {
    return { x: layout.plotArea.x - tickExtent - labelPadding, align: 'right' };
  }
  return side === 'right'
    ? { x: axisX + tickExtent + labelPadding, align: 'left' }
    : { x: axisX - tickExtent - labelPadding, align: 'right' };
}

function yAxisTitleX(
  channel: ChannelSpec,
  axisSpec: AxisSpec,
  ticks: unknown[],
  scale: AnyScale,
  tickFormat: string | undefined,
  labelSkip: number,
  axisX: number,
  layout: Layout,
  orient: Extract<AxisOrient, 'left' | 'right'>,
  titleFontSize: number,
): number {
  const titleSide = yAxisLabelSide(axisSpec, orient);
  const titleHalfWidth = titleFontSize / 2;
  const titlePadding = axisSpec.titlePadding ?? DEFAULT_AXIS_TITLE_PADDING;
  const labelOuterX = yAxisLabelOuterX(
    channel,
    axisSpec,
    ticks,
    scale,
    tickFormat,
    labelSkip,
    axisX,
    layout,
    orient,
  );
  const x =
    titleSide === 'right'
      ? labelOuterX + titlePadding + titleHalfWidth
      : labelOuterX - titlePadding - titleHalfWidth;
  const clampedX = clampAxisPosition(x, titleHalfWidth, layout.width - titleHalfWidth);
  if (
    (titleSide === 'right' && clampedX - titleHalfWidth >= labelOuterX + titlePadding) ||
    (titleSide === 'left' && clampedX + titleHalfWidth <= labelOuterX - titlePadding)
  ) {
    return clampedX;
  }
  return x;
}

function yAxisLabelOuterX(
  channel: ChannelSpec,
  axisSpec: AxisSpec,
  ticks: unknown[],
  scale: AnyScale,
  tickFormat: string | undefined,
  labelSkip: number,
  axisX: number,
  layout: Layout,
  orient: Extract<AxisOrient, 'left' | 'right'>,
): number {
  const titleSide = yAxisLabelSide(axisSpec, orient);
  const fontSize = axisSpec.labelFontSize ?? GRAMMAR_AXIS_LABEL_FONT_SIZE;
  const tickExtent = axisSpec.ticks === false ? 0 : (axisSpec.tickSize ?? 6);
  const labelPadding = axisSpec.labelPadding ?? 3;
  const labelLayout = yLabelLayout(axisSpec, axisX, tickExtent, labelPadding, layout, orient);

  if (axisSpec.labels === false || axisSpec.labelPosition === 'none') {
    const outwardTick =
      axisSpec.ticks === false ? 0 : outwardTickExtent(axisSpec.tickMark, tickExtent);
    return titleSide === 'right' ? axisX + outwardTick : axisX - outwardTick;
  }

  let outerX = labelLayout.x;
  let labelIndex = 0;
  let sawLabel = false;
  for (const tick of ticks) {
    const y = axisPosition(scale, tick);
    if (isNaN(y)) continue;
    const showThisLabel = labelIndex % labelSkip === 0;
    if (showThisLabel) {
      const labelResult = axisLabelResult(
        channel,
        axisSpec,
        tick,
        axisSpec.labelFormatByValue?.[String(tick)] ?? tickFormat,
      );
      const labelAngle = axisSpec.labelAngle ?? 0;
      const multiLevelLabels = labelAngle === 0 ? axisMultiLevelLabels(axisSpec, tick) : undefined;
      if (multiLevelLabels) {
        const outward = titleSide === 'right' ? 1 : -1;
        const orderedLabels = [...multiLevelLabels].reverse();
        const columnWidth = multiLevelYAxisColumnWidth(multiLevelLabels, fontSize);
        for (let levelIndex = 0; levelIndex < orderedLabels.length; levelIndex += 1) {
          const label = orderedLabels[levelIndex];
          const labelX = labelLayout.x + outward * columnWidth * levelIndex;
          const width = estimatedTextWidth(label.text, fontSize);
          outerX =
            titleSide === 'right'
              ? Math.max(outerX, labelX + width)
              : Math.min(outerX, labelX - width);
        }
      } else {
        const width = rotatedTextWidth(
          estimatedTextWidth(labelResult.text, fontSize),
          fontSize,
          labelAngle,
        );
        outerX =
          titleSide === 'right'
            ? Math.max(outerX, labelLayout.x + width)
            : Math.min(outerX, labelLayout.x - width);
      }
      sawLabel = true;
    }
    labelIndex++;
  }

  return sawLabel ? outerX : labelLayout.x;
}

function estimatedTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * ESTIMATED_TEXT_WIDTH_RATIO;
}

function rotatedTextWidth(width: number, height: number, angleDegrees: number): number {
  const radians = (Math.abs(angleDegrees) * Math.PI) / 180;
  return Math.cos(radians) * width + Math.sin(radians) * height;
}

function rotatedTextHeight(width: number, height: number, angleDegrees: number): number {
  const radians = (Math.abs(angleDegrees) * Math.PI) / 180;
  return Math.sin(radians) * width + Math.cos(radians) * height;
}

function outwardTickExtent(
  tickMark: AxisSpec['tickMark'] | AxisSpec['minorTickMark'],
  tickSize: number,
): number {
  return tickMark === 'in' || tickMark === 'none' ? 0 : tickSize;
}

function yTickPath(
  x: number,
  y: number,
  size: number,
  orient: Extract<AxisOrient, 'left' | 'right'>,
  tickMark: AxisSpec['tickMark'] | AxisSpec['minorTickMark'],
): string {
  const side = orient === 'right' ? 1 : -1;
  switch (tickMark) {
    case 'in':
      return `M${x},${y} L${x - side * size},${y}`;
    case 'cross':
      return `M${x - side * size},${y} L${x + side * size},${y}`;
    case 'out':
    default:
      return `M${x},${y} L${x + side * size},${y}`;
  }
}

/**
 * Format a temporal tick value as a readable date string.
 * Uses "Mon YYYY" format which is not parseable as a bare number.
 */
export function formatTemporalTick(value: unknown): string {
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  let ts: number;
  if (typeof value === 'number') {
    ts = value;
  } else if (value instanceof Date) {
    ts = value.getTime();
  } else {
    ts = new Date(String(value)).getTime();
  }
  if (isNaN(ts)) return String(value);
  const date = new Date(ts);
  return MONTHS[date.getMonth()] + ' ' + date.getFullYear();
}

function getAxisTicks(scale: AnyScale, axisSpec: AxisSpec): unknown[] {
  if (axisSpec.tickInterval !== undefined && typeof scale.domain === 'function') {
    const domain = scale.domain();
    const start = numericTickValue(domain?.[0]);
    const stop = numericTickValue(domain?.[1]);
    if (start !== undefined && stop !== undefined) {
      return generateIntervalTicks(start, stop, axisSpec.tickInterval);
    }
  }

  if (axisSpec.tickStep !== undefined && axisSpec.tickStep > 0 && typeof scale.domain === 'function') {
    const domain = scale.domain();
    const start = numericTickValue(domain?.[0]);
    const stop = numericTickValue(domain?.[1]);
    if (start !== undefined && stop !== undefined) {
      return generateSteppedTicks(start, stop, axisSpec.tickStep);
    }
  }

  if (typeof scale.ticks === 'function') return scale.ticks(axisSpec.tickCount ?? 10);
  if (typeof scale.domain === 'function') return scale.domain();
  return [];
}

function getMinorAxisTicks(
  scale: AnyScale,
  axisSpec: AxisSpec,
  majorTicks: unknown[],
): unknown[] {
  if (!axisSpec.minorTicks && !axisSpec.minorGrid) return [];

  let ticks: unknown[] = [];
  if (axisSpec.minorTickInterval !== undefined && typeof scale.domain === 'function') {
    const domain = scale.domain();
    const start = numericTickValue(domain?.[0]);
    const stop = numericTickValue(domain?.[1]);
    if (start !== undefined && stop !== undefined) {
      ticks = generateIntervalTicks(start, stop, axisSpec.minorTickInterval);
    }
  } else if (
    axisSpec.minorTickStep !== undefined &&
    axisSpec.minorTickStep > 0 &&
    typeof scale.domain === 'function'
  ) {
    const domain = scale.domain();
    const start = numericTickValue(domain?.[0]);
    const stop = numericTickValue(domain?.[1]);
    if (start !== undefined && stop !== undefined) {
      ticks = generateSteppedTicks(start, stop, axisSpec.minorTickStep);
    }
  } else if (typeof scale.ticks === 'function') {
    ticks = scale.ticks(Math.max(2, (axisSpec.tickCount ?? 10) * 5));
  }

  if (ticks.length === 0) return [];

  const majorKeys = new Set(majorTicks.map(axisTickKey));
  return ticks.filter((tick) => !majorKeys.has(axisTickKey(tick)));
}

function axisTickKey(tick: unknown): string {
  if (typeof tick === 'number' && Number.isFinite(tick)) return tick.toPrecision(12);
  if (tick instanceof Date) return String(tick.getTime());
  return String(tick);
}

function normalizedSkip(skip: number | undefined): number | undefined {
  if (skip === undefined || !Number.isFinite(skip) || skip < 1) return undefined;
  return Math.max(1, Math.floor(skip));
}

function shouldAutoSkipLabels(axisSpec: AxisSpec): boolean {
  if (axisSpec.labelOverlap === false) return false;
  return axisSpec.tickInterval === undefined && axisSpec.tickStep === undefined;
}

function numericTickValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : undefined;
  }
  return undefined;
}

function generateSteppedTicks(start: number, stop: number, step: number): number[] {
  const ascending = start <= stop;
  const lo = ascending ? start : stop;
  const hi = ascending ? stop : start;
  const ticks: number[] = [];
  const epsilon = step / 1_000_000;

  for (let tick = lo, count = 0; tick <= hi + epsilon && count < 1000; tick += step, count += 1) {
    ticks.push(parseFloat(tick.toPrecision(12)));
  }

  return ascending ? ticks : ticks.reverse();
}

function generateIntervalTicks(
  start: number,
  stop: number,
  interval: NonNullable<AxisSpec['tickInterval']>,
): number[] {
  if (interval.step <= 0 || !Number.isFinite(interval.step)) return [];
  if (interval.unit === 'day') return generateSteppedTicks(start, stop, interval.step);

  const monthStep = interval.unit === 'year' ? interval.step * 12 : interval.step;
  if (!Number.isInteger(monthStep)) return [];

  return generateCalendarMonthTicks(start, stop, monthStep);
}

function generateCalendarMonthTicks(start: number, stop: number, monthStep: number): number[] {
  if (monthStep <= 0) return [];

  const ascending = start <= stop;
  const lo = ascending ? start : stop;
  const hi = ascending ? stop : start;
  const ticks: number[] = [];
  const epsilon = 1 / 1_000_000;
  let current = excelSerialToUtcDate(lo);

  for (let count = 0; count < 1000; count += 1) {
    const serial = utcDateToExcelSerial(current);
    if (serial > hi + epsilon) break;
    if (serial >= lo - epsilon) ticks.push(parseFloat(serial.toPrecision(12)));

    const next = addUtcMonths(current, monthStep);
    if (next.getTime() <= current.getTime()) break;
    current = next;
  }

  return ascending ? ticks : ticks.reverse();
}

function formatAxisTick(
  channel: ChannelSpec,
  axisSpec: AxisSpec,
  value: unknown,
  format: string | undefined,
): string {
  return formatAxisTickResult(channel, axisSpec, value, format).text;
}

function formatAxisTickResult(
  channel: ChannelSpec,
  axisSpec: AxisSpec,
  value: unknown,
  format: string | undefined,
): ExcelNumberFormatResult {
  if (channel.type === 'temporal') return { text: formatTemporalTick(value), section: 'general' };
  if (axisSpec.formatType === 'time') {
    return formatExcelValueResult(value, format);
  }
  return formatTickValueResult(value, format);
}

const EXCEL_SERIAL_UNIX_EPOCH = 25569;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function excelSerialToUtcDate(serial: number): Date {
  return new Date((serial - EXCEL_SERIAL_UNIX_EPOCH) * MS_PER_DAY);
}

function utcDateToExcelSerial(date: Date): number {
  return date.getTime() / MS_PER_DAY + EXCEL_SERIAL_UNIX_EPOCH;
}

function addUtcMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Format an Excel 1900-system serial date value.
 */
export function formatExcelSerialDateTick(value: unknown, format?: string): string {
  const serial =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;

  if (!Number.isFinite(serial)) return String(value);
  const date = excelSerialToUtcDate(serial);
  if (Number.isNaN(date.getTime())) return String(value);

  return formatUtcDate(date, format);
}

function formatUtcDate(date: Date, format?: string): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const pattern = normalizeExcelDateFormat(format);

  if (!/[dmy]/i.test(pattern)) return `${month}/${day}/${year}`;

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const shortMonthNames = monthNames.map((name) => name.slice(0, 3));

  return pattern.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/gi, (token) => {
    switch (token.toLowerCase()) {
      case 'yyyy':
        return String(year);
      case 'yy':
        return String(year % 100).padStart(2, '0');
      case 'mmmm':
        return monthNames[month - 1];
      case 'mmm':
        return shortMonthNames[month - 1];
      case 'mm':
        return String(month).padStart(2, '0');
      case 'm':
        return String(month);
      case 'dd':
        return String(day).padStart(2, '0');
      case 'd':
        return String(day);
      default:
        return token;
    }
  });
}

function normalizeExcelDateFormat(format: string | undefined): string {
  return (format ?? 'm/d/yyyy')
    .split(';')[0]
    .replace(/"([^"]*)"/g, '$1')
    .replace(/\\(.)/g, '$1')
    .trim();
}

/**
 * Format a tick value.
 */
export function formatTickValue(value: unknown, format?: string): string {
  return formatTickValueResult(value, format).text;
}

export function formatTickValueResult(
  value: unknown,
  format?: string,
): ExcelNumberFormatResult {
  return formatExcelValueResult(value, format);
}
