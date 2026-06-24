import {
  captureInput,
  createFormatSemanticMutationCapture,
  expectCaptureSuccess,
  mutationResult,
  operationContext,
} from './semantic-mutation-capture-formats-helpers';

export function registerSemanticMutationCaptureDirectCellClearFormatScenarios(): void {
  it('captures direct format clears as removals', async () => {
    const capture = createFormatSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_clear_format_for_ranges',
      operationContext: operationContext(),
      result: mutationResult({
        propertyChanges: [
          {
            sheetId: 'sheet-1',
            cellId: 'cell-a1',
            position: { row: 0, col: 0 },
            kind: 'Removed',
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload.reviewChanges).toEqual([
      {
        structural: {
          kind: 'metadata',
          changeId: 'mutation-1:cell-format:0',
          domain: 'cells.formats.direct',
          entityId: 'sheet-1!A1',
          propertyPath: ['format'],
        },
        before: {
          kind: 'value',
          value: {
            kind: 'object',
            fields: [{ key: 'kind', value: 'Removed' }],
          },
        },
        after: { kind: 'value', value: null },
        display: { address: { kind: 'value', value: 'A1' } },
      },
    ]);
  });
}
