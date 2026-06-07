import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { Worksheet } from '@mog-sdk/contracts/api';
import type { CellValuePrimitive } from '@mog-sdk/contracts/core';
import { linearRegression } from '@mog/charts/math';
import { toA1 } from '@mog/spreadsheet-utils/a1';

type ForecastRange = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

type ForecastCell = {
  value: unknown;
  text: string;
};

type ForecastPoint = {
  x: number;
  y: number;
};

type ForecastSource = {
  timelineHeader: string;
  valueHeader: string;
  points: ForecastPoint[];
  rangeLabel: string;
};

export type ForecastSheetPlan = {
  rangeLabel: string;
  values: CellValuePrimitive[][];
};

const FORECAST_HORIZON = 6;
const EXCEL_UNIX_EPOCH_SERIAL = 25569;
const MS_PER_DAY = 86_400_000;

function normalizeRange(range: ForecastRange): ForecastRange {
  return {
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

function formatRangeLabel(range: ForecastRange): string {
  const normalized = normalizeRange(range);
  return `${toA1(normalized.startRow, normalized.startCol)}:${toA1(
    normalized.endRow,
    normalized.endCol,
  )}`;
}

async function getForecastRange(
  deps: ActionDependencies,
  ws: Worksheet,
): Promise<ForecastRange | null> {
  const activeCell = deps.accessors?.selection?.getActiveCell?.() ?? null;
  const ranges = deps.accessors?.selection?.getRanges?.() ?? [];

  if (ranges.length === 1) {
    const range = normalizeRange(ranges[0]);
    const isSingleCell =
      range.startRow === range.endRow && range.startCol === range.endCol && activeCell;
    if (isSingleCell) {
      try {
        const region = await ws.getCurrentRegion(range.startRow, range.startCol);
        if (region) return normalizeRange(region);
      } catch {
        return range;
      }
    }
    return range;
  }

  if (!activeCell) return null;
  try {
    const region = await ws.getCurrentRegion(activeCell.row, activeCell.col);
    if (region) return normalizeRange(region);
  } catch {
    // Fall back to the active cell; validation will reject it if it is not a series.
  }
  return {
    startRow: activeCell.row,
    startCol: activeCell.col,
    endRow: activeCell.row,
    endCol: activeCell.col,
  };
}

async function readForecastCells(ws: Worksheet, range: ForecastRange): Promise<ForecastCell[][]> {
  const matrix: ForecastCell[][] = [];
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    const outRow: ForecastCell[] = [];
    for (let col = range.startCol; col <= range.endCol; col += 1) {
      const cell = (await ws.getCell(row, col)) as {
        value?: unknown;
        displayText?: unknown;
        formatted?: unknown;
      } | null;
      const value = cell?.value ?? null;
      const displayText =
        typeof cell?.displayText === 'string'
          ? cell.displayText
          : typeof cell?.formatted === 'string'
            ? cell.formatted
            : value == null
              ? ''
              : String(value);
      outRow.push({ value, text: displayText });
    }
    matrix.push(outRow);
  }
  return matrix;
}

function parseFiniteNumber(value: unknown, text: string): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime() / MS_PER_DAY + EXCEL_UNIX_EPOCH_SERIAL;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  if (text.trim().length > 0) {
    const parsed = Number(text.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseTimelineValue(cell: ForecastCell): number | null {
  const numeric = parseFiniteNumber(cell.value, cell.text);
  if (numeric !== null) return numeric;

  const rawText =
    typeof cell.value === 'string' && cell.value.trim().length > 0 ? cell.value : cell.text;
  const parsedDate = Date.parse(rawText);
  if (Number.isFinite(parsedDate)) {
    return parsedDate / MS_PER_DAY + EXCEL_UNIX_EPOCH_SERIAL;
  }

  return null;
}

function parseForecastSource(
  matrix: ForecastCell[][],
  range: ForecastRange,
): ForecastSource | null {
  if (range.endCol - range.startCol + 1 !== 2 || matrix.length < 3) return null;

  for (const dataStartRow of [0, 1]) {
    const points: ForecastPoint[] = [];
    let valid = true;
    for (let row = dataStartRow; row < matrix.length; row += 1) {
      const x = parseTimelineValue(matrix[row][0]);
      const y = parseFiniteNumber(matrix[row][1].value, matrix[row][1].text);
      if (x === null || y === null) {
        valid = false;
        break;
      }
      points.push({ x, y });
    }

    if (!valid || points.length < 2) continue;

    const increasing = points.every((point, index) => index === 0 || point.x > points[index - 1].x);
    const decreasing = points.every((point, index) => index === 0 || point.x < points[index - 1].x);
    if (!increasing && !decreasing) continue;

    const hasHeader = dataStartRow === 1;
    return {
      timelineHeader: hasHeader ? matrix[0][0].text || 'Timeline' : 'Timeline',
      valueHeader: hasHeader ? matrix[0][1].text || 'Value' : 'Value',
      points,
      rangeLabel: formatRangeLabel(range),
    };
  }

  return null;
}

function residualStandardError(points: ForecastPoint[], predict: (x: number) => number): number {
  if (points.length <= 2) return 0;
  const squaredError = points.reduce((sum, point) => {
    const residual = point.y - predict(point.x);
    return sum + residual * residual;
  }, 0);
  return Math.sqrt(squaredError / (points.length - 2));
}

function serialToUtcDate(serial: number): Date {
  return new Date((serial - EXCEL_UNIX_EPOCH_SERIAL) * MS_PER_DAY);
}

function utcDateToSerial(date: Date): number {
  return date.getTime() / MS_PER_DAY + EXCEL_UNIX_EPOCH_SERIAL;
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function isMonthlyDateSeries(points: ForecastPoint[]): boolean {
  if (!points.every((point) => point.x >= 20_000 && point.x <= 80_000)) return false;
  const dates = points.map((point) => serialToUtcDate(point.x));
  const day = dates[0].getUTCDate();
  if (!dates.every((date) => date.getUTCDate() === day)) return false;
  for (let index = 1; index < dates.length; index += 1) {
    const prev = dates[index - 1];
    const current = dates[index];
    const monthDelta =
      (current.getUTCFullYear() - prev.getUTCFullYear()) * 12 +
      current.getUTCMonth() -
      prev.getUTCMonth();
    if (monthDelta !== 1) return false;
  }
  return true;
}

function futureTimelineValues(points: ForecastPoint[], horizon: number): number[] {
  if (isMonthlyDateSeries(points)) {
    const lastDate = serialToUtcDate(points[points.length - 1].x);
    const day = lastDate.getUTCDate();
    const values: number[] = [];
    for (let offset = 1; offset <= horizon; offset += 1) {
      const year = lastDate.getUTCFullYear();
      const month = lastDate.getUTCMonth() + offset;
      const futureDate = new Date(
        Date.UTC(year, month, Math.min(day, daysInUtcMonth(year, month))),
      );
      values.push(utcDateToSerial(futureDate));
    }
    return values;
  }

  const deltas = points
    .slice(1)
    .map((point, index) => point.x - points[index].x)
    .sort((a, b) => a - b);
  const medianDelta = deltas[Math.floor(deltas.length / 2)] || 1;
  const last = points[points.length - 1].x;
  return Array.from({ length: horizon }, (_, index) => last + medianDelta * (index + 1));
}

function buildForecastValues(source: ForecastSource): CellValuePrimitive[][] {
  const regression = linearRegression(source.points);
  if (
    !Number.isFinite(regression.coefficients[0]) ||
    !Number.isFinite(regression.coefficients[1])
  ) {
    return [];
  }

  const stderr = residualStandardError(source.points, regression.predict);
  const confidence = Math.max(stderr * 1.96, 0);
  const values: CellValuePrimitive[][] = [
    ['Forecast Sheet', '', '', '', ''],
    ['Source Range', source.rangeLabel, '', '', ''],
    [
      'Timeline',
      source.valueHeader,
      'Forecast',
      'Lower Confidence Bound',
      'Upper Confidence Bound',
    ],
  ];

  source.points.forEach((point) => {
    values.push([point.x, point.y, null, null, null]);
  });

  futureTimelineValues(source.points, FORECAST_HORIZON).forEach((x) => {
    const forecast = regression.predict(x);
    values.push([x, null, forecast, forecast - confidence, forecast + confidence]);
  });

  values.push(['', '', '', '', '']);
  values.push(['Forecast Method', 'Linear trend forecast', '', '', '']);
  values.push(['Timeline Field', source.timelineHeader, '', '', '']);

  return values;
}

export async function createForecastSheetPlan(
  deps: ActionDependencies,
  ws: Worksheet,
): Promise<ForecastSheetPlan> {
  const range = await getForecastRange(deps, ws);
  const rangeLabel = range ? formatRangeLabel(range) : 'the selected range';
  const source = range ? parseForecastSource(await readForecastCells(ws, range), range) : null;
  return {
    rangeLabel,
    values: source ? buildForecastValues(source) : [],
  };
}

export async function uniqueForecastSheetName(
  workbook: ActionDependencies['workbook'],
): Promise<string> {
  const names = new Set((await workbook.getSheetNames()).map((name) => name.toLowerCase()));
  if (!names.has('forecast')) return 'Forecast';
  let suffix = 1;
  while (names.has(`forecast ${suffix}`)) suffix += 1;
  return `Forecast ${suffix}`;
}
