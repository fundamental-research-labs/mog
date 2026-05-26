/**
 * WorksheetWhatIfImpl — Implementation of the WorksheetWhatIf sub-API.
 *
 * Delegates to goal-seek-operations and data-table-operations modules.
 */

import type { GoalSeekResult, SheetId, WorksheetWhatIf } from '@mog-sdk/contracts/api';
import type {
  CreateDataTableOptions,
  CreateDataTableResult,
  DataTableResult,
} from '@mog-sdk/contracts/what-if';
import type { DocumentContext } from '../../context';
import * as DataTableOps from './operations/data-table-operations';
import * as GoalSeekOps from './operations/goal-seek-operations';

export class WorksheetWhatIfImpl implements WorksheetWhatIf {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  async goalSeek(
    targetCell: string,
    targetValue: number,
    changingCell: string,
  ): Promise<GoalSeekResult> {
    return GoalSeekOps.goalSeek(this.ctx, this.sheetId, targetCell, targetValue, changingCell);
  }

  async dataTable(
    formulaCell: string,
    options: {
      rowInputCell?: string | null;
      colInputCell?: string | null;
      rowValues: (string | number | boolean | null)[];
      colValues: (string | number | boolean | null)[];
    },
  ): Promise<DataTableResult> {
    return DataTableOps.dataTable(this.ctx, this.sheetId, formulaCell, options);
  }

  async createDataTable(options: CreateDataTableOptions): Promise<CreateDataTableResult> {
    return DataTableOps.createDataTable(this.ctx, this.sheetId, options);
  }
}
