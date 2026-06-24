import type { TableInfo } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../context';
import { parseCellRange } from '../internal/utils';
import { bridgeTableToTableInfo } from './operations/table-operations';

const INVALIDATING_EVENTS = [
  'table:created',
  'table:updated',
  'table:deleted',
  'table:resized',
  'table:column-renamed',
  'table:total-row-changed',
  'table:renamed',
  'table:calculated-column-filled',
  'table:duplicates-removed',
  'table:column-deleted',
  'table:converted-to-range',
] as const;

function cloneTableInfo(table: TableInfo): TableInfo {
  return {
    ...table,
    columns: table.columns.map((column) => ({ ...column })),
  };
}

function cloneTableInfos(tables: readonly TableInfo[]): TableInfo[] {
  return tables.map(cloneTableInfo);
}

export class WorksheetTableListCache {
  private tables: TableInfo[] | null = null;
  private load: Promise<TableInfo[]> | null = null;
  private generation = 0;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {
    for (const type of INVALIDATING_EVENTS) {
      this.unsubscribers.push(
        this.ctx.eventBus.on(type as any, (event: any) => {
          if (event.sheetId && event.sheetId !== this.sheetId) return;
          this.invalidate();
        }),
      );
    }
  }

  invalidate(): void {
    this.generation += 1;
    this.tables = null;
    this.load = null;
  }

  async list(): Promise<TableInfo[]> {
    if (this.tables) return cloneTableInfos(this.tables);

    if (!this.load) {
      const generation = this.generation;
      const load = this.ctx.computeBridge
        .getAllTablesInSheet(this.sheetId)
        .then((tables) => {
          const tableInfos = tables.map((table) => bridgeTableToTableInfo(table));
          if (generation === this.generation) {
            this.tables = tableInfos;
          }
          return tableInfos;
        })
        .finally(() => {
          if (this.load === load) {
            this.load = null;
          }
        });
      this.load = load;
    }

    return cloneTableInfos(await this.load);
  }

  getAtCell(row: number, col: number): TableInfo | null | undefined {
    if (!this.tables) return undefined;

    for (const table of this.tables) {
      const range = parseCellRange(table.range);
      if (!range) continue;
      if (
        row >= range.startRow &&
        row <= range.endRow &&
        col >= range.startCol &&
        col <= range.endCol
      ) {
        return cloneTableInfo(table);
      }
    }

    return null;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.invalidate();
  }
}
