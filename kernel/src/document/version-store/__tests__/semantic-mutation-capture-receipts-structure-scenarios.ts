import {
  capturedChanges,
  captureInput,
  createTestSemanticMutationCapture,
  expectCaptureSuccess,
  mutationResult,
} from './semantic-mutation-capture-test-helpers';

export function registerSemanticMutationCaptureStructureReceiptTests(): void {
  it('captures row and column structure receipts as rows-columns mutations', async () => {
    const capture = createTestSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_structure_change',
      result: mutationResult({
        structureChanges: [
          { sheetId: 'sheet-1', changeType: 'insertRows', at: 1, count: 1 },
          { sheetId: 'sheet-1', changeType: 'deleteCols', at: 2, count: 1 },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    const changes = capturedChanges(captured);
    expect(changes.map((change) => change.structural)).toEqual([
      {
        kind: 'metadata',
        changeId: 'mutation-1:row:0',
        domain: 'rows-columns',
        entityId: 'sheet-1!row:1',
        propertyPath: ['order'],
      },
      {
        kind: 'metadata',
        changeId: 'mutation-1:column:1',
        domain: 'rows-columns',
        entityId: 'sheet-1!column:2',
        propertyPath: ['order'],
      },
    ]);
    expect(changes[0]).toMatchObject({
      before: { kind: 'value', value: null },
      after: {
        kind: 'value',
        value: expect.objectContaining({
          fields: expect.arrayContaining([
            { key: 'axis', value: 'row' },
            { key: 'sheetId', value: 'sheet-1' },
            { key: 'index', value: 1 },
            { key: 'displayRef', value: '2:2' },
          ]),
        }),
      },
      display: { address: { kind: 'value', value: '2:2' } },
    });
    expect(changes[1]).toMatchObject({
      before: {
        kind: 'value',
        value: expect.objectContaining({
          fields: expect.arrayContaining([
            { key: 'axis', value: 'column' },
            { key: 'sheetId', value: 'sheet-1' },
            { key: 'index', value: 2 },
            { key: 'displayRef', value: 'C:C' },
          ]),
        }),
      },
      after: { kind: 'value', value: null },
      display: { address: { kind: 'value', value: 'C:C' } },
    });
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      segmentId: 'mutation-1',
      operation: 'compute_structure_change',
      changeIds: ['mutation-1:row:0', 'mutation-1:column:1'],
    });
  });
}
