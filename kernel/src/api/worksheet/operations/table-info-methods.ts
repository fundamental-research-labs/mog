import type { TableInfo } from '@mog-sdk/contracts/api';
import { parseCellRange } from '../../internal/utils';

type OperationalTableInfo = TableInfo & {
  totalsRow?: number;
  totalsRowIndex?: number;
  setTotalsRow?: (visible: boolean) => Promise<void>;
  setTotalsFunction?: (columnName: string, func: string) => Promise<void>;
  containsCell?: (row: number, col: number) => boolean;
};

export function attachTableInfoMethods(
  table: TableInfo,
  operations: {
    setTotalsRow(tableName: string, visible: boolean): Promise<unknown>;
    setTotalsFunction(tableName: string, columnName: string, func: string): Promise<unknown>;
  },
): TableInfo {
  const info = table as OperationalTableInfo;

  if (info.hasTotalsRow) {
    const parsed = parseCellRange(info.range);
    if (parsed) {
      info.totalsRow = parsed.endRow;
      info.totalsRowIndex = parsed.endRow;
    }
  }

  info.setTotalsRow = async (visible: boolean) => {
    await operations.setTotalsRow(info.name, visible);
  };
  info.setTotalsFunction = async (columnName: string, func: string) => {
    await operations.setTotalsFunction(info.name, columnName, func);
  };
  info.containsCell = (row: number, col: number): boolean => {
    const parsed = parseCellRange(info.range);
    if (!parsed) return false;
    return (
      row >= parsed.startRow &&
      row <= parsed.endRow &&
      col >= parsed.startCol &&
      col <= parsed.endCol
    );
  };

  return info;
}
