import type { WorksheetImpl } from '../../worksheet/worksheet-impl';
import {
  createWorksheetFixture,
  expectCapturedContext,
  SECOND_SHEET_ID,
  SHEET_ID,
} from './version-operation-context-test-utils';

export function registerVersionOperationContextWorksheetScenarios(): void {
  describe('VersionOperationContext propagation for public worksheet writes', () => {
    it.each([
      {
        name: 'setCell',
        operationIdPrefix: 'worksheet.setCell',
        run: (worksheet: WorksheetImpl) => worksheet.setCell('A1', 'value'),
        directEdits: [{ sheetId: SHEET_ID, row: 0, col: 0 }],
      },
      {
        name: 'setCells',
        operationIdPrefix: 'worksheet.setCells',
        run: (worksheet: WorksheetImpl) => worksheet.setCells([{ address: 'B1', value: 42 }]),
        directEdits: [{ sheetId: SHEET_ID, row: 0, col: 1 }],
      },
      {
        name: 'setRange',
        operationIdPrefix: 'worksheet.setRange',
        run: (worksheet: WorksheetImpl) => worksheet.setRange('C1:D1', [[1, 2]]),
        directEdits: [
          { sheetId: SHEET_ID, row: 0, col: 2 },
          { sheetId: SHEET_ID, row: 0, col: 3 },
        ],
      },
      {
        name: 'whatIf.createDataTable',
        operation: 'compute_create_data_table',
        operationIdPrefix: 'worksheet.whatIf.createDataTable',
        run: (worksheet: WorksheetImpl) =>
          worksheet.whatIf.createDataTable({
            tableRange: 'A1:B2',
            colInputCell: 'C1',
          }),
      },
      {
        name: 'whatIf.writeDataTableValues',
        operationIdPrefix: 'worksheet.whatIf.writeDataTableValues',
        run: (worksheet: WorksheetImpl) =>
          worksheet.whatIf.writeDataTableValues('A1', {
            rowInputCell: null,
            colInputCell: null,
            rowValues: [1],
            colValues: [],
            targetRange: 'B1:B1',
          }),
        directEdits: [{ sheetId: SHEET_ID, row: 0, col: 1 }],
      },
      {
        name: 'moveTo',
        operation: 'compute_relocate_cells_yrs',
        operationIdPrefix: 'worksheet.moveTo',
        run: (worksheet: WorksheetImpl) => worksheet.moveTo('A1:B2', 4, 5),
        domainIds: ['cells', 'cells.formats.direct'],
        directEditRanges: [
          { sheetId: SHEET_ID, startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
          { sheetId: SHEET_ID, startRow: 4, startCol: 5, endRow: 5, endCol: 6 },
        ],
      },
      {
        name: 'copyFrom',
        operation: 'compute_copy_range',
        operationIdPrefix: 'worksheet.copyFrom',
        run: (worksheet: WorksheetImpl) => worksheet.copyFrom('A1:B2', 'C3:D4'),
        domainIds: ['cells', 'cells.formats.direct'],
        directEditRanges: [{ sheetId: SHEET_ID, startRow: 2, startCol: 2, endRow: 3, endCol: 3 }],
      },
      {
        name: 'internal.relocateCells',
        operation: 'compute_relocate_cells_yrs',
        operationIdPrefix: 'worksheet.relocateCells',
        run: (worksheet: WorksheetImpl) =>
          worksheet._internal.relocateCells(
            { startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
            1,
            2,
          ),
        domainIds: ['cells', 'cells.formats.direct'],
        directEditRanges: [
          { sheetId: SHEET_ID, startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
          { sheetId: SHEET_ID, startRow: 1, startCol: 2, endRow: 1, endCol: 3 },
        ],
      },
      {
        name: 'internal.relocateCellsToSheet',
        operation: 'compute_relocate_cells_yrs',
        operationIdPrefix: 'worksheet.relocateCellsToSheet',
        run: (worksheet: WorksheetImpl) =>
          worksheet._internal.relocateCellsToSheet(
            { startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
            SECOND_SHEET_ID,
            2,
            3,
          ),
        sheetIds: [SHEET_ID, SECOND_SHEET_ID],
        domainIds: ['cells', 'cells.formats.direct'],
        directEditRanges: [
          { sheetId: SHEET_ID, startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
          { sheetId: SECOND_SHEET_ID, startRow: 2, startCol: 3, endRow: 2, endCol: 4 },
        ],
      },
      {
        name: 'internal.copyRangeToSheet',
        operation: 'compute_copy_range',
        operationIdPrefix: 'worksheet.copyRangeToSheet',
        run: (worksheet: WorksheetImpl) =>
          worksheet._internal.copyRangeToSheet(
            { startRow: 0, startCol: 0, endRow: 1, endCol: 2 },
            SECOND_SHEET_ID,
            3,
            4,
            'all',
            false,
            false,
          ),
        sheetIds: [SHEET_ID, SECOND_SHEET_ID],
        domainIds: ['cells', 'cells.formats.direct'],
        directEditRanges: [
          { sheetId: SECOND_SHEET_ID, startRow: 3, startCol: 4, endRow: 4, endCol: 6 },
        ],
      },
    ])(
      '$name carries context into version capture',
      async ({
        operation = 'compute_batch_set_cells_by_position',
        operationIdPrefix,
        run,
        domainIds = ['cells'],
        sheetIds = [SHEET_ID],
        directEdits,
        directEditRanges,
      }) => {
        const { capture, worksheet } = createWorksheetFixture();

        await run(worksheet);

        expectCapturedContext(capture, {
          operation,
          operationIdPrefix,
          sheetIds,
          domainIds,
          directEdits,
          directEditRanges,
        });
      },
    );
  });
}
