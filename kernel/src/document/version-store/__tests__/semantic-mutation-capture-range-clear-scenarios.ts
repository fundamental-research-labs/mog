import {
  captureInput,
  createRangeSemanticMutationCapture,
  expectCaptureSuccess,
  mutationResult,
} from './semantic-mutation-capture-range-test-helpers';

export function describeRangeClearScenarios(): void {
  it('captures clear range changes inside the authored range and preserves before formulas', async () => {
    const capture = createRangeSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_clear_range',
      directEditRanges: [{ sheetId: 'sheet-1', startRow: 0, startCol: 0, endRow: 1, endCol: 0 }],
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'cell-a1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 0 },
              oldValue: 10,
              value: null,
              extraFlags: 0,
            },
            {
              cellId: 'cell-a2',
              sheetId: 'sheet-1',
              position: { row: 1, col: 0 },
              oldFormula: '=A1*2',
              oldValue: 20,
              value: null,
              extraFlags: 0,
            },
            {
              cellId: 'cell-b2-cascade',
              sheetId: 'sheet-1',
              position: { row: 1, col: 1 },
              oldValue: 40,
              value: 0,
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
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      source: { kind: 'rustSemanticDiff' },
      reviewChanges: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:cell:0',
            domain: 'cell',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: 10 },
          after: { kind: 'value', value: null },
          display: { address: { kind: 'value', value: 'A1' } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:cell:1',
            domain: 'cell',
            entityId: 'sheet-1!A2',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: { kind: 'formula', formula: '=A1*2', result: 20 } },
          after: { kind: 'value', value: null },
          display: { address: { kind: 'value', value: 'A2' } },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      operation: 'compute_clear_range',
      changeIds: ['mutation-1:cell:0', 'mutation-1:cell:1'],
      directEditRanges: [
        {
          sheetId: 'sheet-1',
          startRow: 0,
          startCol: 0,
          endRow: 1,
          endCol: 0,
          address: 'A1:A2',
        },
      ],
    });
  });
}
