export type * from '@mog/types-core/protection';
export type { SheetProtectionOptions, WorkbookProtectionOptions } from '@mog/types-core/protection';
import type { SheetProtectionOptions, WorkbookProtectionOptions } from '@mog/types-core/protection';

/** Default sheet protection options. All operations blocked except selection. */
export const DEFAULT_PROTECTION_OPTIONS: SheetProtectionOptions = {
  selectLockedCells: true,
  selectUnlockedCells: true,
  insertRows: false,
  insertColumns: false,
  insertHyperlinks: false,
  deleteRows: false,
  deleteColumns: false,
  formatCells: false,
  formatColumns: false,
  formatRows: false,
  sort: false,
  useAutoFilter: false,
  usePivotTableReports: false,
  editObjects: false,
  editScenarios: false,
};

/** Default workbook protection options. Structure protection enabled by default. */
export const DEFAULT_WORKBOOK_PROTECTION_OPTIONS: WorkbookProtectionOptions = {
  structure: true,
};
