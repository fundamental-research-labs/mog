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

type AxisPart = 'domain' | 'tick' | 'label' | 'grid' | 'title';

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
  const mapped = axisSpec.labelTextByValue?.[String(tick)];
  return mapped !== undefined ? mapped : formatAxisTick(channel, axisSpec, tick, format);
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

  // Compute label skip interval to prevent overlap.
  // Estimate label widths and determine how many labels to skip so adjacent
  // labels don't collide.
  const fontSize = axisSpec.labelFontSize ?? 11;
  let labelSkip = 1;
  if (axisSpec.labels !== false && ticks.length > 1) {
    const avgCharWidth = fontSize * 0.6;
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
        datum: axisDatum(role, 'tick'),
        path: `M${x},${y} L${x},${y + (axisSpec.tickSize ?? 6)}`,
        style: {
          stroke: axisSpec.tickColor ?? '#000',
          strokeWidth: axisSpec.tickWidth ?? 1,
        },
      } as PathMark);
    }

    // Label (skip labels that would overlap)
    if (axisSpec.labels !== false && showThisTick) {
      const labelText = axisLabelText(
        channel,
        axisSpec,
        tick,
        axisSpec.labelFormatByValue?.[String(tick)] ?? tickFormat,
      );
      const labelAngle = axisSpec.labelAngle ?? 0;
      const tickExtent = axisSpec.ticks === false ? 0 : (axisSpec.tickSize ?? 6);
      const labelPadding = axisSpec.labelPadding ?? (labelAngle ? 2 : 3);

      marks.push({
        type: 'text',
        x,
        y: y + tickExtent + labelPadding,
        text: labelText,
        datum: axisDatum(role, 'label'),
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
        datum: axisDatum(role, 'grid'),
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
        datum: axisDatum(role, 'title'),
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
  const isRight = axisSpec.orient === 'right';
  const x = isRight ? layout.plotArea.x + layout.plotArea.width : layout.plotArea.x;
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
      const tickSize = axisSpec.tickSize ?? 6;
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        datum: axisDatum(role, 'tick'),
        path: isRight ? `M${x},${y} L${x + tickSize},${y}` : `M${x - tickSize},${y} L${x},${y}`,
        style: {
          stroke: axisSpec.tickColor ?? '#000',
          strokeWidth: axisSpec.tickWidth ?? 1,
        },
      } as PathMark);
    }

    // Label (skip labels that would overlap vertically)
    if (axisSpec.labels !== false && showThisTick) {
      const labelText = axisLabelText(
        channel,
        axisSpec,
        tick,
        axisSpec.labelFormatByValue?.[String(tick)] ?? tickFormat,
      );

      const tickSize = axisSpec.ticks === false ? 0 : (axisSpec.tickSize ?? 6);
      const labelPadding = axisSpec.labelPadding ?? 3;
      marks.push({
        type: 'text',
        x: isRight ? x + tickSize + labelPadding : x - tickSize - labelPadding,
        y,
        text: labelText,
        datum: axisDatum(role, 'label'),
        fontSize: yFontSize,
        fontFamily: axisSpec.labelFontFamily ?? 'system-ui, sans-serif',
        textAlign: isRight ? 'left' : 'right',
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
        datum: axisDatum(role, 'grid'),
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
        x: isRight ? x + 45 : x - 45,
        y: layout.plotArea.y + layout.plotArea.height / 2,
        text: title,
        datum: axisDatum(role, 'title'),
        fontSize: axisSpec.titleFontSize ?? 12,
        fontFamily: axisSpec.titleFontFamily ?? 'system-ui, sans-serif',
        textAlign: 'center',
        textBaseline: 'middle',
        fontWeight: 'bold',
        rotation: isRight ? Math.PI / 2 : -Math.PI / 2,
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
  if (channel.type === 'temporal') return formatTemporalTick(value);
  if (axisSpec.formatType === 'time') return formatExcelSerialDateTick(value, format);
  return formatTickValue(value, format);
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
        const hasCurrency = format.includes('$');
        if (valueNumber === 0 && /[–-]/.test(format)) return hasCurrency ? '$-' : '–';
        const formatted = Math.round(Math.abs(valueNumber)).toLocaleString('en-US');
        if (valueNumber < 0 && format.includes('('))
          return hasCurrency ? `($${formatted})` : `(${formatted})`;
        return hasCurrency ? `$${formatted}` : formatted;
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
