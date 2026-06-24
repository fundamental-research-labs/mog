/**
 * WorksheetWhatIfImpl — Implementation of the WorksheetWhatIf sub-API.
 *
 * Delegates to goal-seek-operations and data-table-operations modules.
 */

import type { GoalSeekResult, SheetId, WorksheetWhatIf } from '@mog-sdk/contracts/api';
import type {
  CreateDataTableOptions,
  CreateDataTableResult,
  DataTableDescriptor,
  DataTableRefreshReceipt,
  DataTableWriteStaticValuesReceipt,
  DataTableResult,
  RefreshDataTableOptions,
  WriteDataTableValuesOptions,
} from '@mog-sdk/contracts/what-if';
import type { DocumentContext } from '../../context';
import { createVersionMutationAdmissionOptions } from '../workbook/version-operation-context';
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
    return DataTableOps.createDataTable(
      this.ctx,
      this.sheetId,
      options,
      createVersionMutationAdmissionOptions(this.ctx, {
        operationIdPrefix: 'worksheet.whatIf.createDataTable',
        sheetIds: [this.sheetId],
        domainIds: ['cells'],
      }),
    );
  }

  async writeDataTableValues(
    formulaCell: string,
    options: WriteDataTableValuesOptions,
  ): Promise<DataTableWriteStaticValuesReceipt> {
    return DataTableOps.writeDataTableValues(
      this.ctx,
      this.sheetId,
      formulaCell,
      options,
      createVersionMutationAdmissionOptions(this.ctx, {
        operationIdPrefix: 'worksheet.whatIf.writeDataTableValues',
        sheetIds: [this.sheetId],
        domainIds: ['cells'],
      }),
    );
  }

  async describeDataTables(range?: string): Promise<DataTableDescriptor[]> {
    return DataTableOps.describeDataTables(this.ctx, this.sheetId, range);
  }

  async refreshDataTable(
    regionIdOrRange: string,
    options?: RefreshDataTableOptions,
  ): Promise<DataTableRefreshReceipt> {
    return DataTableOps.refreshDataTable(this.ctx, this.sheetId, regionIdOrRange, options);
  }
}
