import {
  captureInput,
  createRangeSemanticMutationCapture,
  expectCaptureSuccess,
  mutationResult,
} from './semantic-mutation-capture-range-test-helpers';

export function describeRangeCopyRelocateScenarios(): void {
  it.each([
    [
      'compute_copy_range',
      [{ sheetId: 'sheet-1', startRow: 2, startCol: 1, endRow: 2, endCol: 2 }],
    ],
    [
      'compute_relocate_cells_yrs',
      [
        { sheetId: 'sheet-1', startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
        { sheetId: 'sheet-1', startRow: 2, startCol: 1, endRow: 2, endCol: 2 },
      ],
    ],
  ])('captures %s cell changes from direct edit ranges', async (operation, directEditRanges) => {
    const capture = createRangeSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation,
      directEditRanges,
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'cell-b3',
              sheetId: 'sheet-1',
              position: { row: 2, col: 1 },
              oldValue: null,
              value: 'copied',
              extraFlags: 0,
            },
            {
              cellId: 'cell-c3',
              sheetId: 'sheet-1',
              position: { row: 2, col: 2 },
              oldFormula: '=A1',
              newFormula: '=B1',
              oldValue: 1,
              value: 2,
              extraFlags: 0,
            },
            {
              cellId: 'cell-d4-cascade',
              sheetId: 'sheet-1',
              position: { row: 3, col: 3 },
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

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
      reviewChanges: [
        {
          structural: { entityId: 'sheet-1!B3' },
          before: { kind: 'value', value: null },
          after: { kind: 'value', value: 'copied' },
        },
        {
          structural: { entityId: 'sheet-1!C3' },
          before: { kind: 'value', value: { kind: 'formula', formula: '=A1', result: 1 } },
          after: { kind: 'value', value: { kind: 'formula', formula: '=B1', result: 2 } },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      operation,
      changeIds: ['mutation-1:cell:0', 'mutation-1:cell:1'],
      directEditRanges: expect.arrayContaining([
        expect.objectContaining({ sheetId: 'sheet-1', address: 'B3:C3' }),
      ]),
    });
  });
}
