import type { DrawingDescriptor } from '../types';

type DrawingAnchorDescriptor = DrawingDescriptor['anchor'];
type CellRef = { row: number; col: number };

function getObjectChartId(obj: { id: string; data?: Record<string, unknown> }): string | null {
  const chartId = obj.data?.chartId;
  return typeof chartId === 'string' && chartId.length > 0 ? chartId : obj.id;
}

function readStringField(record: unknown, keys: readonly string[]): string | null {
  if (!record || typeof record !== 'object') return null;
  const source = record as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function readNumberField(record: unknown, keys: readonly string[]): number | null {
  if (!record || typeof record !== 'object') return null;
  const source = record as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function readCellRef(record: unknown): CellRef | null {
  const row = readNumberField(record, ['row', 'startRow', 'anchorRow']);
  const col = readNumberField(record, ['col', 'startCol', 'anchorCol']);
  return row === null || col === null ? null : { row, col };
}

export function completeDrawingAnchor(
  anchor: DrawingAnchorDescriptor | null | undefined,
  fallbackToCell: CellRef | null,
): DrawingAnchorDescriptor | null {
  if (!anchor?.from) return null;
  return {
    from: anchor.from,
    ...(anchor.to ? { to: anchor.to } : fallbackToCell ? { to: fallbackToCell } : {}),
    ...(anchor.offsetPx ? { offsetPx: anchor.offsetPx } : {}),
  };
}

async function getChartModel(ws: any, chartId: string | null): Promise<unknown | null> {
  if (!chartId || !ws?.charts) return null;
  try {
    if (typeof ws.charts.get === 'function') {
      const chart = await ws.charts.get(chartId);
      if (chart) return chart;
    }
  } catch {
    // fall through to list lookup
  }
  try {
    if (typeof ws.charts.list === 'function') {
      const charts = await ws.charts.list();
      if (Array.isArray(charts)) {
        return (
          charts.find((chart) => {
            if (!chart || typeof chart !== 'object') return false;
            const record = chart as Record<string, unknown>;
            return (
              record.id === chartId ||
              record.chartId === chartId ||
              record.objectId === chartId ||
              record.name === chartId
            );
          }) ?? null
        );
      }
    }
  } catch {
    // best-effort
  }
  return null;
}

function cellRefToA1(cell: CellRef): string {
  let n = Math.max(0, Math.floor(cell.col)) + 1;
  let col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return `${col}${Math.max(0, Math.floor(cell.row)) + 1}`;
}

function anchorToRange(anchor: DrawingAnchorDescriptor | null): string | null {
  if (!anchor?.from || !anchor.to) return null;
  return `${cellRefToA1(anchor.from)}:${cellRefToA1(anchor.to)}`;
}

function getChartAnchor(
  chart: unknown,
  fallbackToCell: CellRef | null,
): DrawingAnchorDescriptor | null {
  if (!chart || typeof chart !== 'object') return null;
  const record = chart as Record<string, unknown>;
  const explicitAnchor = record.anchor;
  if (explicitAnchor && typeof explicitAnchor === 'object') {
    const anchor = explicitAnchor as { from?: unknown; to?: unknown };
    const from = readCellRef(anchor.from);
    if (from) {
      const to = readCellRef(anchor.to);
      return {
        from,
        ...(to ? { to } : {}),
      };
    }
  }

  const position = record.position;
  if (position && typeof position === 'object') {
    const pos = position as { from?: unknown; to?: unknown };
    const from = readCellRef(pos.from);
    if (from) {
      const to = readCellRef(pos.to);
      return {
        from,
        ...(to ? { to } : fallbackToCell ? { to: fallbackToCell } : {}),
      };
    }
  }

  const anchorRow = readNumberField(record, ['anchorRow', 'row', 'startRow']);
  const anchorCol = readNumberField(record, ['anchorCol', 'col', 'startCol']);
  if (anchorRow === null || anchorCol === null) return null;
  return {
    from: { row: anchorRow, col: anchorCol },
    ...(fallbackToCell ? { to: fallbackToCell } : {}),
  };
}

export async function getChartReadback(
  ws: any,
  obj: { id: string; data?: Record<string, unknown> },
  fallbackToCell: CellRef | null,
): Promise<Partial<DrawingDescriptor> | null> {
  const chartId = getObjectChartId(obj);
  const chart = await getChartModel(ws, chartId);
  const chartType =
    readStringField(chart, ['chartType', 'type', 'kind']) ??
    readStringField(obj.data, ['chartType', 'type']);
  const dataRange =
    readStringField(chart, ['dataRange', 'sourceRange', 'range']) ??
    readStringField(obj.data, ['dataRange', 'sourceRange', 'range']);
  const sourceRange =
    readStringField(chart, ['sourceRange', 'dataRange', 'range']) ??
    readStringField(obj.data, ['sourceRange', 'dataRange', 'range']);
  const chartAnchor = getChartAnchor(chart, fallbackToCell);
  const chartRange =
    readStringField(chart, ['chartRange', 'rangeAddress', 'anchorRange']) ??
    anchorToRange(chartAnchor);

  if (!chart && !chartType && !dataRange && !sourceRange) return null;
  return {
    ...(chartType ? { chartType } : {}),
    ...(dataRange ? { dataRange } : {}),
    ...(sourceRange ? { sourceRange } : {}),
    ...(chartRange ? { chartRange } : {}),
    ...(chartAnchor ? { anchor: chartAnchor, usedSyntheticAnchorFallback: false } : {}),
  };
}
