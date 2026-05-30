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
import type { AxisSpec, ChannelSpec, ConfigSpec, EncodingSpec, Layout } from './spec';

function axisPosition(scale: AnyScale, tick: unknown): number {
  const position = scale(tick) as number;
  const bandwidth =
    typeof scale.bandwidth === 'function' ? (scale.bandwidth() as number) : undefined;
  return typeof bandwidth === 'number' && Number.isFinite(bandwidth)
    ? position + bandwidth / 2
    : position;
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

  // Y-axis
  if (encoding?.y && encoding.y.axis !== null && scales.y) {
    const axisMarks = generateYAxis(encoding.y, scales.y, layout, configAxis);
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
): AnyMark[] {
  const marks: AnyMark[] = [];
  const axisSpec = { ...configAxis, ...channel.axis } as AxisSpec;
  const tickFormat = channel.format ?? axisSpec.format;
  const y = xAxisY(axisSpec, valueScale, layout);

  const role = 'x-axis';

  // Axis line
  if (axisSpec.domain !== false) {
    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      datum: { role },
      path: `M${layout.plotArea.x},${y} L${layout.plotArea.x + layout.plotArea.width},${y}`,
      style: {
        stroke: axisSpec.domainColor ?? '#000',
        strokeWidth: axisSpec.domainWidth ?? 1,
      },
    } as PathMark);
  }

  // Get ticks
  const ticks: unknown[] =
    typeof scale.ticks === 'function'
      ? scale.ticks(axisSpec.tickCount ?? 10)
      : typeof scale.domain === 'function'
        ? scale.domain()
        : [];

  // Compute label skip interval to prevent overlap.
  // Estimate label widths and determine how many labels to skip so adjacent
  // labels don't collide.
  const fontSize = axisSpec.labelFontSize ?? 11;
  let labelSkip = 1;
  if (axisSpec.labels !== false && ticks.length > 1) {
    const avgCharWidth = fontSize * 0.6;
    const maxLabelLen = ticks.reduce((max: number, t: unknown) => {
      const text =
        channel.type === 'temporal' ? formatTemporalTick(t) : formatTickValue(t, tickFormat);
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

  // Generate tick marks and labels
  let labelIndex = 0;
  for (const tick of ticks) {
    const x = axisPosition(scale, tick);

    if (isNaN(x)) continue;

    // Skip both tick marks and labels together to keep counts consistent
    const showThisTick = labelIndex % labelSkip === 0;

    // Tick mark (skip when label is skipped to maintain tick/label parity)
    if (axisSpec.ticks !== false && showThisTick) {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: { role },
        path: `M${x},${y} L${x},${y + (axisSpec.tickSize ?? 6)}`,
        style: {
          stroke: axisSpec.tickColor ?? '#000',
          strokeWidth: axisSpec.tickWidth ?? 1,
        },
      } as PathMark);
    }

    // Label (skip labels that would overlap)
    if (axisSpec.labels !== false && showThisTick) {
      const labelText =
        channel.type === 'temporal'
          ? formatTemporalTick(tick)
          : formatTickValue(tick, axisSpec.labelFormatByValue?.[String(tick)] ?? tickFormat);
      const labelAngle = axisSpec.labelAngle ?? 0;
      const tickExtent = axisSpec.ticks === false ? 0 : (axisSpec.tickSize ?? 6);
      const labelPadding = axisSpec.labelPadding ?? (labelAngle ? 2 : 3);

      marks.push({
        type: 'text',
        x,
        y: y + tickExtent + labelPadding,
        text: labelText,
        datum: { role },
        fontSize,
        fontFamily: axisSpec.labelFontFamily ?? 'system-ui, sans-serif',
        textAlign: 'center',
        textBaseline: 'top',
        rotation: labelAngle ? (labelAngle * Math.PI) / 180 : undefined,
        style: {
          fill: axisSpec.labelColor ?? '#000',
        },
      } as TextMark);
    }
    labelIndex++;

    // Grid line
    if (axisSpec.grid) {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: { role },
        path: `M${x},${layout.plotArea.y} L${x},${y}`,
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
      marks.push({
        type: 'text',
        x: layout.plotArea.x + layout.plotArea.width / 2,
        y: y + 35,
        text: title,
        datum: { role },
        fontSize: axisSpec.titleFontSize ?? 12,
        fontFamily: axisSpec.titleFontFamily ?? 'system-ui, sans-serif',
        textAlign: 'center',
        textBaseline: 'top',
        fontWeight: 'bold',
        style: {
          fill: axisSpec.titleColor ?? '#000',
        },
      } as TextMark);
    }
  }

  return marks;
}

function xAxisY(axisSpec: AxisSpec, valueScale: AnyScale | undefined, layout: Layout): number {
  const plotBottom = layout.plotArea.y + layout.plotArea.height;
  if (!valueScale) return plotBottom;

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
      return plotBottom;
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

/**
 * Generate Y-axis marks.
 */
export function generateYAxis(
  channel: ChannelSpec,
  scale: AnyScale,
  layout: Layout,
  configAxis?: Partial<AxisSpec>,
): AnyMark[] {
  const marks: AnyMark[] = [];
  const axisSpec = { ...configAxis, ...channel.axis } as AxisSpec;
  const tickFormat = channel.format ?? axisSpec.format;
  const x = layout.plotArea.x;
  const role = 'y-axis';

  // Axis line
  if (axisSpec.domain !== false) {
    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      datum: { role },
      path: `M${x},${layout.plotArea.y} L${x},${layout.plotArea.y + layout.plotArea.height}`,
      style: {
        stroke: axisSpec.domainColor ?? '#000',
        strokeWidth: axisSpec.domainWidth ?? 1,
      },
    } as PathMark);
  }

  // Get ticks
  const ticks: unknown[] =
    typeof scale.ticks === 'function'
      ? scale.ticks(axisSpec.tickCount ?? 10)
      : typeof scale.domain === 'function'
        ? scale.domain()
        : [];

  // Compute label skip interval to prevent vertical overlap on y-axis.
  const yFontSize = axisSpec.labelFontSize ?? 11;
  let yLabelSkip = 1;
  if (axisSpec.labels !== false && ticks.length > 1) {
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
      if (minSpacing > 0 && yFontSize > minSpacing) {
        yLabelSkip = Math.ceil(yFontSize / minSpacing);
      }
    }
  }

  // Generate tick marks and labels
  let yLabelIndex = 0;
  for (const tick of ticks) {
    const y = axisPosition(scale, tick);

    if (isNaN(y)) continue;

    // Skip both tick marks and labels together to keep counts consistent
    const showThisTick = yLabelIndex % yLabelSkip === 0;

    // Tick mark (skip when label is skipped)
    if (axisSpec.ticks !== false && showThisTick) {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: { role },
        path: `M${x - (axisSpec.tickSize ?? 6)},${y} L${x},${y}`,
        style: {
          stroke: axisSpec.tickColor ?? '#000',
          strokeWidth: axisSpec.tickWidth ?? 1,
        },
      } as PathMark);
    }

    // Label (skip labels that would overlap vertically)
    if (axisSpec.labels !== false && showThisTick) {
      const labelText =
        channel.type === 'temporal'
          ? formatTemporalTick(tick)
          : formatTickValue(tick, axisSpec.labelFormatByValue?.[String(tick)] ?? tickFormat);

      marks.push({
        type: 'text',
        x: x - (axisSpec.tickSize ?? 6) - (axisSpec.labelPadding ?? 3),
        y,
        text: labelText,
        datum: { role },
        fontSize: yFontSize,
        fontFamily: axisSpec.labelFontFamily ?? 'system-ui, sans-serif',
        textAlign: 'right',
        textBaseline: 'middle',
        style: {
          fill: axisSpec.labelColor ?? '#000',
        },
      } as TextMark);
    }
    yLabelIndex++;

    // Grid line
    if (axisSpec.grid) {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: { role },
        path: `M${x},${y} L${layout.plotArea.x + layout.plotArea.width},${y}`,
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
      marks.push({
        type: 'text',
        x: x - 45,
        y: layout.plotArea.y + layout.plotArea.height / 2,
        text: title,
        datum: { role },
        fontSize: axisSpec.titleFontSize ?? 12,
        fontFamily: axisSpec.titleFontFamily ?? 'system-ui, sans-serif',
        textAlign: 'center',
        textBaseline: 'middle',
        fontWeight: 'bold',
        rotation: -Math.PI / 2,
        style: {
          fill: axisSpec.titleColor ?? '#000',
        },
      } as TextMark);
    }
  }

  return marks;
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

/**
 * Format a tick value.
 */
export function formatTickValue(value: unknown, format?: string): string {
  if (value === null || value === undefined) return '';

  if (value instanceof Date) {
    return value.toLocaleDateString();
  }

  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;

  if (Number.isFinite(numericValue)) {
    const valueNumber = numericValue;
    if (format) {
      const quotedLiteralNumber = format.match(/^"([^"]*)"\s*0(?:\s*"([^"]*)")?$/);
      if (quotedLiteralNumber) {
        return `${quotedLiteralNumber[1]}${Math.round(valueNumber)}${quotedLiteralNumber[2] ?? ''}`;
      }
      if (format.includes('#,##0')) {
        if (valueNumber === 0 && /[–-]/.test(format)) return '–';
        const formatted = Math.round(Math.abs(valueNumber)).toLocaleString('en-US');
        if (valueNumber < 0 && format.includes('(')) return `(${formatted})`;
        return formatted;
      }
      // Handle simple format patterns
      if (format.includes('%')) {
        return (valueNumber * 100).toFixed(0) + '%';
      }
      const match = format.match(/\.(\d+)f/);
      if (match) {
        return valueNumber.toFixed(parseInt(match[1], 10));
      }
    }

    // Default number formatting
    if (Math.abs(valueNumber) >= 1000000) {
      return (valueNumber / 1000000).toFixed(1) + 'M';
    }
    if (Math.abs(valueNumber) >= 1000) {
      return (valueNumber / 1000).toFixed(1) + 'K';
    }
    if (Number.isInteger(valueNumber)) {
      return valueNumber.toString();
    }
    return valueNumber.toFixed(2);
  }

  return String(value);
}
