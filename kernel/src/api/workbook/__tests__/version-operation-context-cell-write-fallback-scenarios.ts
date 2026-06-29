import type { DocumentContext } from '../../../context';
import * as DomainCellValues from '../../../domain/cells/cell-values';
import * as CellOps from '../../worksheet/operations/cell-operations';
import * as RangeOps from '../../worksheet/operations/range-operations';
import {
  clearCapture,
  createBridgeFixture,
  expectCapturedContext,
  SHEET_ID,
} from './version-operation-context-test-utils';

export function registerVersionOperationContextCellWriteFallbackScenarios(): void {
  describe('VersionOperationContext fallback for direct cell write paths', () => {
    it('captures grid-domain setValues writes used by real UI input', async () => {
      const { capture, ctx } = createBridgeFixture();
      clearCapture(capture);

      DomainCellValues.setValues(
        ctx as DocumentContext,
        SHEET_ID,
        [{ row: 0, col: 0, value: 'grid-input' }],
        null,
        'user',
      );
      await waitForCapture(capture);

      expectCapturedContext(capture, {
        operation: 'compute_batch_set_cells_by_position',
        operationIdPrefix: 'grid.setValues.user',
        sheetIds: [SHEET_ID],
        domainIds: ['cells'],
        directEdits: [{ sheetId: SHEET_ID, row: 0, col: 0 }],
      });
    });

    it('creates context for direct CellOps.setCell calls without caller options', async () => {
      const { capture, ctx } = createBridgeFixture();
      clearCapture(capture);

      await CellOps.setCell(ctx as DocumentContext, SHEET_ID, 1, 2, 'direct-cell');

      expectCapturedContext(capture, {
        operation: 'compute_batch_set_cells_by_position',
        operationIdPrefix: 'worksheet.setCell',
        sheetIds: [SHEET_ID],
        domainIds: ['cells'],
        directEdits: [{ sheetId: SHEET_ID, row: 1, col: 2 }],
      });
    });

    it('creates context and range identity for direct RangeOps.setRange calls', async () => {
      const { capture, ctx } = createBridgeFixture();
      clearCapture(capture);

      await RangeOps.setRange(ctx as DocumentContext, SHEET_ID, 2, 3, [['left', 'right']]);

      expectCapturedContext(capture, {
        operation: 'compute_batch_set_cells_by_position',
        operationIdPrefix: 'worksheet.setRange',
        sheetIds: [SHEET_ID],
        domainIds: ['cells'],
        directEdits: [
          { sheetId: SHEET_ID, row: 2, col: 3 },
          { sheetId: SHEET_ID, row: 2, col: 4 },
        ],
        directEditRanges: [{ sheetId: SHEET_ID, startRow: 2, startCol: 3, endRow: 2, endCol: 4 }],
      });
    });
  });
}

async function waitForCapture(capture: { readonly recordPreMutation: unknown }): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      expect(capture.recordPreMutation).toHaveBeenCalled();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}
