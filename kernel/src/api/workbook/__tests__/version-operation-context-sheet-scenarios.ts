import { jest } from '@jest/globals';

import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import {
  capturedPreMutationInputs,
  createSheetsFixture,
  expectCapturedContext,
  expectGroupedCommandIdentity,
  SECOND_SHEET_ID,
  SHEET_ID,
} from './version-operation-context-test-utils';

export function registerVersionOperationContextSheetScenarios(): void {
  describe('VersionOperationContext propagation for public sheet writes', () => {
    it('sheet add carries context into version capture', async () => {
      const { capture, sheets } = createSheetsFixture();

      await sheets.add('Revenue');

      expectCapturedContext(capture, {
        operation: 'compute_create_sheet_with_default_col_width',
        operationIdPrefix: 'workbook.sheets.add',
        domainIds: ['sheets'],
      });
    });

    it('sheet add with index preserves outer command identity for nested move', async () => {
      const { capture, sheets } = createSheetsFixture();

      await sheets.add('Revenue', 0);

      expectGroupedCommandIdentity(capturedPreMutationInputs(capture), {
        operations: ['compute_create_sheet_with_default_col_width', 'compute_move_sheet'],
        operationIdPrefix: 'workbook.sheets.add',
        rejectedOperationIdPrefix: 'workbook.sheets.add.move',
      });
    });

    it('sheet copy with index preserves outer command identity for nested move', async () => {
      const { bridge, capture, sheets } = createSheetsFixture();
      bridge.getAllSheetIds = jest.fn(async () => [
        SHEET_ID,
        toSheetId('sheet-copied'),
        SECOND_SHEET_ID,
      ]) as any;

      await sheets.copy('Sheet1', 'Sheet1 Copy', 0);

      expectGroupedCommandIdentity(capturedPreMutationInputs(capture), {
        operations: ['compute_copy_sheet', 'compute_move_sheet'],
        operationIdPrefix: 'workbook.sheets.copy',
        rejectedOperationIdPrefix: 'workbook.sheets.copy.move',
      });
    });

    it('sheet rename carries context into version capture', async () => {
      const { capture, sheets } = createSheetsFixture();

      await sheets.rename('Sheet1', 'Renamed');

      expectCapturedContext(capture, {
        operation: 'compute_rename_compute_sheet',
        operationIdPrefix: 'workbook.sheets.rename',
        sheetIds: [SHEET_ID],
        domainIds: ['sheets'],
      });
    });

    it('sheet remove carries context into version capture', async () => {
      const { capture, sheets } = createSheetsFixture();

      await sheets.remove('Sheet1');

      expectCapturedContext(capture, {
        operation: 'compute_delete_sheet',
        operationIdPrefix: 'workbook.sheets.remove',
        sheetIds: [SHEET_ID],
        domainIds: ['sheets'],
      });
    });
  });
}
