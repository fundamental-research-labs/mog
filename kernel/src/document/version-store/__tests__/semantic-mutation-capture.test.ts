import {
  COMMIT_ID,
  captureInput,
  createTestSemanticMutationCapture,
  expectCaptureMissingChangeSet,
  expectCaptureSuccess,
  mutationResult,
} from './semantic-mutation-capture-test-helpers';

describe('semantic mutation capture', () => {
  it('captures only direct cell edits and drains after successful commit finalization', async () => {
    const capture = createTestSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'cell-a1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 0 },
              oldFormula: '=1',
              newFormula: '=1+1',
              oldValue: 1,
              value: 2,
              extraFlags: 0,
            },
            {
              cellId: 'cell-b1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 1 },
              oldValue: 10,
              value: 20,
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

    const first = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(first.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:cell:0',
            domain: 'cell',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: { kind: 'formula', formula: '=1', result: 1 } },
          after: { kind: 'value', value: { kind: 'formula', formula: '=1+1', result: 2 } },
          display: { address: { kind: 'value', value: 'A1' } },
        },
      ],
    });
    expect(first.input.mutationSegmentRecords).toHaveLength(1);
    expect(first.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      schemaVersion: 1,
      segmentId: 'mutation-1',
      operation: 'compute_batch_set_cells_by_position',
      changeIds: ['mutation-1:cell:0'],
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0, address: 'A1' }],
    });

    const retryBeforeFinalize = expectCaptureSuccess(
      await capture.captureNormalCommit(captureInput()),
    );
    expect(retryBeforeFinalize.input.mutationSegmentRecords).toHaveLength(1);

    first.finalize?.({ status: 'failed' });
    const retryAfterFailure = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(retryAfterFailure.input.mutationSegmentRecords).toHaveLength(1);

    first.finalize?.({ status: 'success', commitId: COMMIT_ID });
    expectCaptureMissingChangeSet(await capture.captureNormalCommit(captureInput()));
  });

  it('captures direct date and time value writes', async () => {
    const capture = createTestSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_date_value',
      directEdits: [{ sheetId: 'sheet-1', row: 1, col: 2 }],
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'cell-c2',
              sheetId: 'sheet-1',
              position: { row: 1, col: 2 },
              oldValue: null,
              value: 45291,
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
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_time_value',
      directEdits: [{ sheetId: 'sheet-1', row: 2, col: 3 }],
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'cell-d3',
              sheetId: 'sheet-1',
              position: { row: 2, col: 3 },
              oldValue: null,
              value: 0.5,
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
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:cell:0',
            domain: 'cell',
            entityId: 'sheet-1!C2',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: null },
          after: { kind: 'value', value: 45291 },
          display: { address: { kind: 'value', value: 'C2' } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-2:cell:0',
            domain: 'cell',
            entityId: 'sheet-1!D3',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: null },
          after: { kind: 'value', value: 0.5 },
          display: { address: { kind: 'value', value: 'D3' } },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual([
      expect.objectContaining({
        segmentId: 'mutation-1',
        operation: 'compute_set_date_value',
        directEdits: [{ sheetId: 'sheet-1', row: 1, col: 2, address: 'C2' }],
      }),
      expect.objectContaining({
        segmentId: 'mutation-2',
        operation: 'compute_set_time_value',
        directEdits: [{ sheetId: 'sheet-1', row: 2, col: 3, address: 'D3' }],
      }),
    ]);
  });
});
