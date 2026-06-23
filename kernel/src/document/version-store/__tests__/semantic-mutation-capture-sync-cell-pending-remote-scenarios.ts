import {
  REMOTE_AUTHOR,
  captureInput,
  createSyncCellSemanticMutationCapture,
  expectCaptureMissingChangeSet,
  pendingRemoteOperationContext,
  pendingRemoteSnapshots,
  syncCellMutationResult,
} from './semantic-mutation-capture-sync-cell-test-helpers';

export function describePendingRemoteSyncCellScenarios(): void {
  it('captures sync-authored cell changes only in the pending remote lane', async () => {
    const capture = createSyncCellSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_apply_sync_update',
      operationContext: pendingRemoteOperationContext(),
      result: syncCellMutationResult({
        authoredCellChanges: [
          {
            cellId: 'remote-cell-b3',
            sheetId: 'sheet-remote-1',
            position: { row: 2, col: 1 },
            oldFormula: '=A3',
            newFormula: '=A3*2',
            oldValue: 4,
            value: 8,
            extraFlags: 0,
          },
          {
            cellId: 'remote-cell-no-position',
            sheetId: 'sheet-remote-1',
            oldValue: 'ignored',
            value: 'ignored',
            extraFlags: 0,
          },
        ],
      }),
    });

    const pendingRemote = pendingRemoteSnapshots(capture);
    expect(pendingRemote).toHaveLength(1);
    expect(pendingRemote[0]).toMatchObject({
      sequence: 1,
      operation: 'compute_apply_sync_update',
      operationContext: expect.objectContaining({
        operationId: 'sync:providerLiveInbound:remote-update-1',
        author: REMOTE_AUTHOR,
      }),
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:sync-cell:0',
            domain: 'cell',
            entityId: 'sheet-remote-1!B3',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: { kind: 'formula', formula: '=A3', result: 4 } },
          after: { kind: 'value', value: { kind: 'formula', formula: '=A3*2', result: 8 } },
          display: {
            address: { kind: 'value', value: 'B3' },
            entityLabel: { kind: 'value', value: 'sheet-remote-1!B3' },
          },
        },
      ],
    });

    expectCaptureMissingChangeSet(await capture.captureNormalCommit(captureInput()));
    expect(pendingRemoteSnapshots(capture)).toHaveLength(1);
  });
}
