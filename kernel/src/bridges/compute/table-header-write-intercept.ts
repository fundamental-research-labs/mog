import type { CellValue, SheetId } from '@mog-sdk/contracts/core';

import type { CellInput, Table as CanonicalTable } from './compute-types.gen';

export type PositionedCellInput = { row: number; col: number; input: CellInput };

export interface TableHeaderRename {
  tableName: string;
  columnIndex: number;
  newName: string;
}

export interface TableHeaderLookup {
  getTableAtCell(
    sheetId: SheetId,
    row: number,
    col: number,
  ): Promise<CanonicalTable | null>;
  getAllTablesInSheet(sheetId: SheetId): Promise<CanonicalTable[]>;
}

function cellValueToTableHeaderText(value: CellValue): string {
  if (value == null) return '';
  return String(value);
}

function cellInputToTableHeaderText(input: CellInput): string {
  switch (input.kind) {
    case 'clear':
      return '';
    case 'literal':
    case 'parse':
      return input.text;
    case 'value':
      return cellValueToTableHeaderText(input.value as CellValue);
  }
}

function tableHeaderRenameForEdit(
  table: CanonicalTable,
  edit: PositionedCellInput,
): TableHeaderRename | null | undefined {
  if (!table.hasHeaderRow) return undefined;
  const { range } = table;
  if (edit.row !== range.startRow || edit.col < range.startCol || edit.col > range.endCol) {
    return undefined;
  }

  const columnIndex = edit.col - range.startCol;
  const column = table.columns?.[columnIndex];
  if (!column) return undefined;

  const newName = cellInputToTableHeaderText(edit.input);
  if (column.name === newName) return null;

  return {
    tableName: table.name,
    columnIndex,
    newName,
  };
}

export async function splitTableHeaderWritesForSetCells(
  lookup: TableHeaderLookup,
  sheetId: SheetId,
  edits: PositionedCellInput[],
): Promise<{ normalEdits: PositionedCellInput[]; headerRenames: TableHeaderRename[] }> {
  if (edits.length === 0) return { normalEdits: [], headerRenames: [] };

  const normalEdits: PositionedCellInput[] = [];
  const headerWrites = new Map<string, TableHeaderRename | null>();

  if (edits.length === 1) {
    const edit = edits[0]!;
    const table = await lookup.getTableAtCell(sheetId, edit.row, edit.col);
    const rename = table ? tableHeaderRenameForEdit(table, edit) : undefined;
    if (rename !== undefined) {
      headerWrites.set(`${edit.row},${edit.col}`, rename);
    } else {
      normalEdits.push(edit);
    }
  } else {
    const tables = await lookup.getAllTablesInSheet(sheetId);
    for (const edit of edits) {
      const table = tables.find(
        (candidate) =>
          candidate.hasHeaderRow &&
          edit.row === candidate.range.startRow &&
          edit.col >= candidate.range.startCol &&
          edit.col <= candidate.range.endCol,
      );
      const rename = table ? tableHeaderRenameForEdit(table, edit) : undefined;
      if (rename !== undefined) {
        headerWrites.set(`${edit.row},${edit.col}`, rename);
      } else {
        normalEdits.push(edit);
      }
    }
  }

  return {
    normalEdits,
    headerRenames: Array.from(headerWrites.values()).filter(
      (rename): rename is TableHeaderRename => rename !== null,
    ),
  };
}
