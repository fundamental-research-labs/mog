import type { WorksheetImpl } from '../../worksheet/worksheet-impl';
import {
  createWorksheetFixture,
  expectCapturedContext,
  SHEET_ID,
} from './version-operation-context-test-utils';

export function registerVersionOperationContextWorksheetScenarios(): void {
  describe('VersionOperationContext propagation for public worksheet writes', () => {
    it.each([
      {
        name: 'setCell',
        operationIdPrefix: 'worksheet.setCell',
        run: (worksheet: WorksheetImpl) => worksheet.setCell('A1', 'value'),
      },
      {
        name: 'setCells',
        operationIdPrefix: 'worksheet.setCells',
        run: (worksheet: WorksheetImpl) => worksheet.setCells([{ address: 'B1', value: 42 }]),
      },
      {
        name: 'setRange',
        operationIdPrefix: 'worksheet.setRange',
        run: (worksheet: WorksheetImpl) => worksheet.setRange('C1:D1', [[1, 2]]),
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
      },
    ])(
      '$name carries context into version capture',
      async ({ operation = 'compute_batch_set_cells_by_position', operationIdPrefix, run }) => {
        const { capture, worksheet } = createWorksheetFixture();

        await run(worksheet);

        expectCapturedContext(capture, {
          operation,
          operationIdPrefix,
          sheetIds: [SHEET_ID],
          domainIds: ['cells'],
        });
      },
    );
  });
}
