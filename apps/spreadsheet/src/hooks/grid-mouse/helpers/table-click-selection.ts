import type { CellRange } from '@mog-sdk/contracts/core';
import type { TotalFunction } from '@mog-sdk/contracts/tables';
import { parseA1Range } from '@mog/spreadsheet-utils/a1';

export type TableRegion =
  | 'header'
  | 'data'
  | 'total'
  | 'header-left-edge'
  | 'data-left-edge'
  | 'total-left-edge'
  | 'corner'
  | 'column-resize-edge'
  | 'outside';

export interface TableHitTestOptions {
  clickXInCell: number;
  clickYInCell: number;
  cellWidth: number;
  cellHeight: number;
}

export interface TableHitResult {
  table: {
    id: string;
    range: CellRange;
    hasHeaderRow: boolean;
    hasTotalsRow: boolean;
    columns: { name: string; totalFunction?: TotalFunction }[];
  } | null;
  region: TableRegion;
  tableColumnIndex: number | null;
}

export type CachedTableHitInfo = NonNullable<TableHitResult['table']>;

const LEFT_EDGE_WIDTH = 4;
const CORNER_WIDTH = 6;
const COLUMN_RESIZE_EDGE_WIDTH = 4;

function tableHitRegionForTable(
  table: CachedTableHitInfo,
  row: number,
  col: number,
  options?: TableHitTestOptions,
): TableHitResult {
  const tableRange = table.range;
  const tableColumnIndex = col - tableRange.startCol;
  const isHeaderRow = table.hasHeaderRow && row === tableRange.startRow;
  const isTotalRow = table.hasTotalsRow && row === tableRange.endRow;

  if (!options) {
    let region: TableRegion;
    if (isHeaderRow) region = 'header';
    else if (isTotalRow) region = 'total';
    else region = 'data';
    return { table, region, tableColumnIndex };
  }

  const { clickXInCell, clickYInCell, cellWidth } = options;
  const isOnLeftEdge = clickXInCell <= LEFT_EDGE_WIDTH;
  const isOnRightEdge = clickXInCell >= cellWidth - COLUMN_RESIZE_EDGE_WIDTH;
  const isFirstColumn = col === tableRange.startCol;

  let region: TableRegion;

  if (isHeaderRow) {
    if (isFirstColumn && isOnLeftEdge && clickYInCell <= CORNER_WIDTH) {
      region = 'corner';
    } else if (isOnRightEdge) {
      region = 'column-resize-edge';
    } else if (isOnLeftEdge) {
      region = 'header-left-edge';
    } else {
      region = 'header';
    }
  } else if (isTotalRow) {
    region = isOnLeftEdge ? 'total-left-edge' : 'total';
  } else {
    region = isOnLeftEdge ? 'data-left-edge' : 'data';
  }

  return { table, region, tableColumnIndex };
}

export function getCachedTableHitRegion(
  tables: CachedTableHitInfo[],
  row: number,
  col: number,
  options?: TableHitTestOptions,
): TableHitResult {
  const table = tables.find(
    (candidate) =>
      row >= candidate.range.startRow &&
      row <= candidate.range.endRow &&
      col >= candidate.range.startCol &&
      col <= candidate.range.endCol,
  );
  if (!table) {
    return { table: null, region: 'outside', tableColumnIndex: null };
  }

  return tableHitRegionForTable(table, row, col, options);
}

export function getTableCornerDoubleClickRange(
  tables: CachedTableHitInfo[],
  row: number,
  col: number,
  options: TableHitTestOptions,
): { tableId: string; range: CellRange } | null {
  const tableHit = getCachedTableHitRegion(tables, row, col, options);
  if (!tableHit.table || tableHit.region !== 'corner') return null;
  return { tableId: tableHit.table.id, range: tableHit.table.range };
}

export async function getTableHitRegion(
  ws: { tables: { getAtCell(row: number, col: number): Promise<any> } },
  row: number,
  col: number,
  options?: TableHitTestOptions,
): Promise<TableHitResult> {
  const tableInfo = await ws.tables.getAtCell(row, col);

  if (!tableInfo) {
    return { table: null, region: 'outside', tableColumnIndex: null };
  }

  let tableRange: CellRange;
  try {
    tableRange = parseA1Range(tableInfo.range);
  } catch {
    return { table: null, region: 'outside', tableColumnIndex: null };
  }

  const table = {
    id: tableInfo.name,
    range: tableRange,
    hasHeaderRow: tableInfo.hasHeaderRow ?? true,
    hasTotalsRow: tableInfo.hasTotalsRow ?? false,
    columns: (tableInfo.columns ?? []).map((c: any) => ({
      name: c.name,
      totalFunction: c.totalFunction,
    })),
  };

  return tableHitRegionForTable(table, row, col, options);
}

export type PendingTableClickSelection =
  | {
      kind: 'column';
      sheetId: string;
      row: number;
      col: number;
      tableId: string;
      tableRange: CellRange;
      hasHeaderRow: boolean;
      hasTotalsRow: boolean;
    }
  | {
      kind: 'table-data-or-full';
      sheetId: string;
      row: number;
      col: number;
      tableId: string;
      tableRange: CellRange;
      hasHeaderRow: boolean;
      hasTotalsRow: boolean;
    }
  | {
      kind: 'row';
      sheetId: string;
      row: number;
      col: number;
      tableId: string;
      tableRange: CellRange;
      hasHeaderRow: boolean;
      hasTotalsRow: boolean;
    };

export interface PendingTableClickStageResolver {
  handleHeaderClick(tableId: string, columnIndex: number): 0 | 1 | 2;
  handleCornerClick(tableId: string): 0 | 1;
}

export interface ResolvedPendingTableClickSelection {
  range: CellRange;
  activeCell: { row: number; col: number };
}

function tableDataRange(table: PendingTableClickSelection): CellRange | null {
  const startRow = table.hasHeaderRow ? table.tableRange.startRow + 1 : table.tableRange.startRow;
  const endRow = table.hasTotalsRow ? table.tableRange.endRow - 1 : table.tableRange.endRow;
  if (startRow > endRow) return null;
  return {
    startRow,
    endRow,
    startCol: table.tableRange.startCol,
    endCol: table.tableRange.endCol,
  };
}

function tableColumnRange(
  table: Extract<PendingTableClickSelection, { kind: 'column' }>,
  stage: 0 | 1 | 2,
): CellRange | null {
  if (table.col < table.tableRange.startCol || table.col > table.tableRange.endCol) return null;
  if (stage === 2) {
    return {
      startRow: table.tableRange.startRow,
      endRow: table.tableRange.endRow,
      startCol: table.col,
      endCol: table.col,
    };
  }
  const data = tableDataRange(table);
  if (!data) return null;
  return {
    startRow: stage === 1 ? table.tableRange.startRow : data.startRow,
    endRow: data.endRow,
    startCol: table.col,
    endCol: table.col,
  };
}

function tableRowRange(
  table: Extract<PendingTableClickSelection, { kind: 'row' }>,
): CellRange | null {
  const data = tableDataRange(table);
  if (!data || table.row < data.startRow || table.row > data.endRow) return null;
  return {
    startRow: table.row,
    endRow: table.row,
    startCol: table.tableRange.startCol,
    endCol: table.tableRange.endCol,
  };
}

export function getPendingTableClickRange(
  pendingTableClick: PendingTableClickSelection,
  stage?: 0 | 1 | 2,
): CellRange | null {
  if (pendingTableClick.kind === 'column') {
    return tableColumnRange(pendingTableClick, stage ?? 0);
  }
  if (pendingTableClick.kind === 'row') {
    return tableRowRange(pendingTableClick);
  }
  return stage === 0 ? tableDataRange(pendingTableClick) : pendingTableClick.tableRange;
}

export function getPendingTableClickActiveCell(
  pendingTableClick: PendingTableClickSelection,
  selectedRange: CellRange,
): { row: number; col: number } {
  if (
    pendingTableClick.kind === 'column' &&
    pendingTableClick.hasHeaderRow &&
    selectedRange.startRow > pendingTableClick.row &&
    pendingTableClick.col >= selectedRange.startCol &&
    pendingTableClick.col <= selectedRange.endCol
  ) {
    return { row: pendingTableClick.row, col: pendingTableClick.col };
  }

  return { row: selectedRange.startRow, col: selectedRange.startCol };
}

export function resolvePendingTableClickSelection(
  pendingTableClick: PendingTableClickSelection,
  stages: PendingTableClickStageResolver,
): ResolvedPendingTableClickSelection | null {
  let range: CellRange | null = null;

  if (pendingTableClick.kind === 'column') {
    const stage = stages.handleHeaderClick(pendingTableClick.tableId, pendingTableClick.col);
    range = getPendingTableClickRange(pendingTableClick, stage);
  } else if (pendingTableClick.kind === 'table-data-or-full') {
    const stage = stages.handleCornerClick(pendingTableClick.tableId);
    range = getPendingTableClickRange(pendingTableClick, stage);
  } else {
    range = getPendingTableClickRange(pendingTableClick);
  }

  if (!range) return null;

  return {
    range,
    activeCell: getPendingTableClickActiveCell(pendingTableClick, range),
  };
}
