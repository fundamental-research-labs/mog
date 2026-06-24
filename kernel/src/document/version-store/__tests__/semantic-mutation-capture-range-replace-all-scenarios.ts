import {
  COMMIT_ID,
  captureInput,
  createRangeSemanticMutationCapture,
  expectCaptureMissingChangeSet,
  expectCaptureSuccess,
  mutationResult,
} from './semantic-mutation-capture-range-test-helpers';

export function describeRangeReplaceAllScenarios(): void {
  it('captures replaceAll changed cells from exact edits instead of searched range', async () => {
    const capture = createRangeSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_replace_all_in_range',
      directEdits: [
        { sheetId: 'sheet-1', row: 0, col: 0 },
        { sheetId: 'sheet-1', row: 0, col: 1 },
      ],
      directEditRanges: [{ sheetId: 'sheet-1', startRow: 0, startCol: 0, endRow: 0, endCol: 2 }],
      result: mutationResult({
        data: 2,
        recalc: {
          changedCells: [
            {
              cellId: 'cell-a1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 0 },
              oldValue: 'old total',
              value: 'new total',
              extraFlags: 0,
            },
            {
              cellId: 'cell-b1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 1 },
              oldValue: 'old detail',
              value: 'new detail',
              extraFlags: 0,
            },
            {
              cellId: 'cell-c1-formula-cascade',
              sheetId: 'sheet-1',
              position: { row: 0, col: 2 },
              oldFormula: '=A1&B1',
              newFormula: '=A1&B1',
              oldValue: 'old totalold detail',
              value: 'new totalnew detail',
              extraFlags: 0,
            },
            {
              cellId: 'cell-a2-cascade',
              sheetId: 'sheet-1',
              position: { row: 1, col: 0 },
              oldValue: 'old derived',
              value: 'new derived',
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
    expect(
      (captured.input.semanticChangeSetRecord.preimage.payload as any).reviewChanges,
    ).toHaveLength(2);
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      source: { kind: 'rustSemanticDiff' },
      reviewChanges: [
        {
          structural: { entityId: 'sheet-1!A1' },
          before: { kind: 'value', value: 'old total' },
          after: { kind: 'value', value: 'new total' },
        },
        {
          structural: { entityId: 'sheet-1!B1' },
          before: { kind: 'value', value: 'old detail' },
          after: { kind: 'value', value: 'new detail' },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      directEdits: [
        { sheetId: 'sheet-1', row: 0, col: 0, address: 'A1' },
        { sheetId: 'sheet-1', row: 0, col: 1, address: 'B1' },
      ],
      directEditRanges: [{ address: 'A1:C1' }],
    });

    captured.finalize?.({ status: 'success', commitId: COMMIT_ID });
    expectCaptureMissingChangeSet(await capture.captureNormalCommit(captureInput()));
  });
}
