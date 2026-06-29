import { jest } from '@jest/globals';

import {
  expectCapturedCoreCommit,
  expectDateAndTimeValueWriteCapture,
  expectDirectCellEditCapture,
  expectDirectCellEditLifecycleDrainsAfterSuccessfulFinalize,
} from './semantic-mutation-capture-core-assertions';
import {
  recordDateAndTimeValueWriteScenario,
  recordDirectCellEditScenario,
} from './semantic-mutation-capture-core-scenarios';
import { createCoreMutationCaptureContext } from './semantic-mutation-capture-core-setup';
import {
  captureInput,
  capturedChanges,
  createRustBackedTestSemanticMutationCapture,
  expectCaptureSuccess,
  mutationResult,
} from './semantic-mutation-capture-test-helpers';

describe('semantic mutation capture', () => {
  it('captures only direct cell edits and drains after successful commit finalization', async () => {
    const context = createCoreMutationCaptureContext();
    recordDirectCellEditScenario(context.capture);

    const first = await expectCapturedCoreCommit(context);
    expectDirectCellEditCapture(first);
    await expectDirectCellEditLifecycleDrainsAfterSuccessfulFinalize(context, first);
  });

  it('captures direct date and time value writes', async () => {
    const context = createCoreMutationCaptureContext();
    recordDateAndTimeValueWriteScenario(context.capture);

    expectDateAndTimeValueWriteCapture(await expectCapturedCoreCommit(context));
  });

  it('records sheet names on direct cell review changes from the pre-mutation sheet resolver', async () => {
    const readSheetName = jest.fn(async (sheetId: string) => {
      if (sheetId === 'sheet-1') return 'North';
      if (sheetId === 'sheet-2') return 'South';
      return null;
    });
    const capture = createRustBackedTestSemanticMutationCapture({ readSheetName });

    await capture.mutationCapture.recordPreMutation?.({
      operation: 'compute_batch_set_cells_by_position',
      directEdits: [
        { sheetId: 'sheet-1', row: 2, col: 1 },
        { sheetId: 'sheet-2', row: 2, col: 1 },
      ],
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      directEdits: [
        { sheetId: 'sheet-1', row: 2, col: 1 },
        { sheetId: 'sheet-2', row: 2, col: 1 },
      ],
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'north-b3',
              sheetId: 'sheet-1',
              position: { row: 2, col: 1 },
              oldValue: undefined,
              value: 'Same',
              extraFlags: 0,
            },
            {
              cellId: 'south-b3',
              sheetId: 'sheet-2',
              position: { row: 2, col: 1 },
              oldValue: undefined,
              value: 'Same',
              extraFlags: 0,
            },
          ],
          projectionChanges: [],
          errors: [],
          validationAnnotations: [],
          metrics: {},
        },
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(readSheetName).toHaveBeenCalledWith('sheet-1');
    expect(readSheetName).toHaveBeenCalledWith('sheet-2');
    expect(capturedChanges(captured)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          structural: expect.objectContaining({ entityId: 'sheet-1!B3' }),
          after: { kind: 'value', value: 'Same' },
          display: {
            sheetName: { kind: 'value', value: 'North' },
            address: { kind: 'value', value: 'B3' },
          },
        }),
        expect.objectContaining({
          structural: expect.objectContaining({ entityId: 'sheet-2!B3' }),
          after: { kind: 'value', value: 'Same' },
          display: {
            sheetName: { kind: 'value', value: 'South' },
            address: { kind: 'value', value: 'B3' },
          },
        }),
      ]),
    );
  });
});
