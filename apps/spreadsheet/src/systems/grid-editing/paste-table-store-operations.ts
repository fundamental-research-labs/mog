import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { PasteStoreOperations } from '../../domain/clipboard';

type BridgeMutationGuard = (fn: () => Promise<unknown>) => Promise<boolean>;

export function createTablePasteStoreOperations(
  workbook: WorkbookInternal,
  guardBridgeMutation: BridgeMutationGuard,
): Pick<PasteStoreOperations, 'getTables' | 'resizeTable'> {
  const workbookSheetId = (sheetId: SheetId): Parameters<WorkbookInternal['getSheetById']>[0] =>
    sheetId as unknown as Parameters<WorkbookInternal['getSheetById']>[0];

  return {
    getTables: async (sheetId) => {
      const tables = await workbook.getSheetById(workbookSheetId(sheetId)).tables.list();
      return tables.map((table) => ({
        name: table.name,
        range: table.range,
        autoExpand: table.autoExpand,
        hasTotalsRow: table.hasTotalsRow,
      }));
    },
    resizeTable: async (sheetId, tableName, rangeA1) => {
      await guardBridgeMutation(async () => {
        await workbook.getSheetById(workbookSheetId(sheetId)).tables.resize(tableName, rangeA1);
      });
    },
  };
}
