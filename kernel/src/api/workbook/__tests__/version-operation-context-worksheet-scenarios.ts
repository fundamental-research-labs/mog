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
    ])('$name carries context into version capture', async ({ operationIdPrefix, run }) => {
      const { capture, worksheet } = createWorksheetFixture();

      await run(worksheet);

      expectCapturedContext(capture, {
        operation: 'compute_batch_set_cells_by_position',
        operationIdPrefix,
        sheetIds: [SHEET_ID],
        domainIds: ['cells'],
      });
    });
  });
}
