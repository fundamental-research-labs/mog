import {
  capturedChanges,
  captureInput,
  createTestSemanticMutationCapture,
  expectCaptureSuccess,
  mutationResult,
  semanticAfterObject,
} from './semantic-mutation-capture-test-helpers';

export function registerSemanticMutationCaptureIdentityReceiptTests(): void {
  it('captures named range, table, and comment receipts with stable identities', async () => {
    const capture = createTestSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_vc06_domain_receipts',
      result: mutationResult({
        namedRangeChanges: [
          { name: 'RevenueTotal', kind: 'Set' },
          { name: 'OldName', kind: 'Removed' },
          { name: '3 names imported', kind: 'Set' },
        ],
        tableChanges: [
          { sheetId: 'sheet-1', tableId: 'table-1', name: 'SalesTable', kind: 'Set' },
          { sheetId: 'sheet-1', tableId: 'table-old', name: 'OldTable', kind: 'Removed' },
          { sheetId: '', name: 'StyleOnly', kind: 'Set' },
        ],
        commentChanges: [
          { sheetId: 'sheet-1', cellId: 'cell-a1', position: { row: 0, col: 0 }, kind: 'Set' },
          {
            sheetId: 'sheet-1',
            cellId: 'cell-b2',
            position: { row: 1, col: 1 },
            kind: 'Removed',
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    const changes = capturedChanges(captured);
    expect(changes).toHaveLength(6);
    expect(changes.map((change) => change.structural)).toEqual([
      {
        kind: 'metadata',
        changeId: 'mutation-1:named-range:0',
        domain: 'named-ranges',
        entityId: 'name:RevenueTotal',
        propertyPath: ['definition'],
      },
      {
        kind: 'metadata',
        changeId: 'mutation-1:named-range:1',
        domain: 'named-ranges',
        entityId: 'name:OldName',
        propertyPath: ['definition'],
      },
      {
        kind: 'metadata',
        changeId: 'mutation-1:table:0',
        domain: 'tables',
        entityId: 'sheet-1!table:table-1',
        propertyPath: ['definition'],
      },
      {
        kind: 'metadata',
        changeId: 'mutation-1:table:1',
        domain: 'tables',
        entityId: 'sheet-1!table:table-old',
        propertyPath: ['definition'],
      },
      {
        kind: 'metadata',
        changeId: 'mutation-1:comment:0',
        domain: 'comments-notes',
        entityId: 'sheet-1!comment:cell-a1',
        propertyPath: ['cell'],
      },
      {
        kind: 'metadata',
        changeId: 'mutation-1:comment:1',
        domain: 'comments-notes',
        entityId: 'sheet-1!comment:cell-b2',
        propertyPath: ['cell'],
      },
    ]);
    expect(changes[0].after).toEqual(
      semanticAfterObject([
        { key: 'kind', value: 'Set' },
        { key: 'name', value: 'RevenueTotal' },
      ]),
    );
    expect(changes[2].after).toEqual(
      semanticAfterObject([
        { key: 'kind', value: 'Set' },
        { key: 'tableId', value: 'table-1' },
        { key: 'name', value: 'SalesTable' },
        { key: 'sheetId', value: 'sheet-1' },
      ]),
    );
    expect(changes[4]).toMatchObject({ display: { address: { kind: 'value', value: 'A1' } } });
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      segmentId: 'mutation-1',
      changeIds: [
        'mutation-1:named-range:0',
        'mutation-1:named-range:1',
        'mutation-1:table:0',
        'mutation-1:table:1',
        'mutation-1:comment:0',
        'mutation-1:comment:1',
      ],
    });
  });
}
