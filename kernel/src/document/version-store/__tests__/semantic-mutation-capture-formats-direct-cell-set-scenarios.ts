import {
  captureInput,
  createFormatSemanticMutationCapture,
  expectCaptureSuccess,
  mutationResult,
  operationContext,
} from './semantic-mutation-capture-formats-helpers';

export function registerSemanticMutationCaptureDirectCellSetFormatScenarios(): void {
  it('captures a single-cell direct format property change as cells.formats.direct', async () => {
    const capture = createFormatSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_format_for_ranges',
      operationContext: operationContext(),
      result: mutationResult({
        propertyChanges: [
          {
            sheetId: 'sheet-1',
            cellId: 'cell-a1',
            position: { row: 0, col: 0 },
            kind: 'Set',
            format: {
              fontColor: '#FF0000',
              bold: true,
            },
          },
        ],
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
            changeId: 'mutation-1:cell-format:0',
            domain: 'cells.formats.direct',
            entityId: 'sheet-1!A1',
            propertyPath: ['format'],
          },
          before: { kind: 'value', value: null },
          after: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'bold', value: true },
                { key: 'fontColor', value: '#FF0000' },
              ],
            },
          },
          display: { address: { kind: 'value', value: 'A1' } },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      operation: 'compute_set_format_for_ranges',
      changeIds: ['mutation-1:cell-format:0'],
      operationContext: expect.objectContaining({
        domainIds: ['cells.formats.direct'],
      }),
    });
  });

  it('captures multi-cell direct format property changes per resolved cell', async () => {
    const capture = createFormatSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_format_for_ranges',
      operationContext: operationContext(),
      result: mutationResult({
        propertyChanges: [
          {
            sheetId: 'sheet-1',
            cellId: 'cell-a1',
            position: { row: 0, col: 0 },
            kind: 'Set',
            format: { bold: true },
          },
          {
            sheetId: 'sheet-1',
            cellId: 'cell-b1',
            position: { row: 0, col: 1 },
            kind: 'Set',
            format: { italic: true },
          },
          {
            sheetId: 'sheet-1',
            cellId: '',
            position: { row: 10, col: 10 },
            kind: 'Set',
            format: { underline: true },
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    const changes = captured.input.semanticChangeSetRecord.preimage.payload.reviewChanges as Array<{
      structural: { changeId: string; entityId: string };
      after: { value: unknown };
      display: { address: { value: string } };
    }>;

    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.structural)).toEqual([
      {
        kind: 'metadata',
        changeId: 'mutation-1:cell-format:0',
        domain: 'cells.formats.direct',
        entityId: 'sheet-1!A1',
        propertyPath: ['format'],
      },
      {
        kind: 'metadata',
        changeId: 'mutation-1:cell-format:1',
        domain: 'cells.formats.direct',
        entityId: 'sheet-1!B1',
        propertyPath: ['format'],
      },
    ]);
    expect(changes.map((change) => change.display.address.value)).toEqual(['A1', 'B1']);
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      changeIds: ['mutation-1:cell-format:0', 'mutation-1:cell-format:1'],
    });
  });
}
