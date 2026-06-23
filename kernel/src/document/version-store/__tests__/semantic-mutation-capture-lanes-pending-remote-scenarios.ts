import {
  AUTHOR,
  COMMIT_ID,
  REMOTE_AUTHOR,
  capturedChanges,
  captureInput,
  createLaneSemanticMutationCapture,
  expectCaptureMissingChangeSet,
  expectCaptureSuccess,
  operationContext,
  pendingRemoteSnapshots,
  sheetRenameResult,
  syncCollaboration,
} from './semantic-mutation-capture-lanes-test-helpers';

export function describePendingRemoteLaneScenarios(): void {
  it('keeps interleaved pending remote records out of normal commits', async () => {
    const capture = createLaneSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_rename_compute_sheet',
      result: sheetRenameResult('sheet-local-1', 'Sheet1', 'Local One'),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_rename_compute_sheet',
      operationContext: operationContext({
        operationId: 'sync-remote-1',
        kind: 'sync-import',
        author: REMOTE_AUTHOR,
        collaboration: syncCollaboration({
          stableOriginId: 'remote-origin-1',
          updateId: 'remote-update-1',
          payloadHash: 'remote-payload-1',
          remoteSessionId: 'remote-session-1',
        }),
      }),
      result: sheetRenameResult('sheet-remote-1', 'Remote Sheet', 'Remote Rename'),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_rename_compute_sheet',
      operationContext: operationContext({ operationId: 'local-2' }),
      result: sheetRenameResult('sheet-local-2', 'Sheet2', 'Local Two'),
    });

    const remoteBeforeFinalize = pendingRemoteSnapshots(capture);
    expect(remoteBeforeFinalize).toHaveLength(1);
    expect(remoteBeforeFinalize[0]).toMatchObject({
      sequence: 1,
      operation: 'compute_rename_compute_sheet',
      operationContext: expect.objectContaining({
        operationId: 'sync-remote-1',
        author: REMOTE_AUTHOR,
      }),
    });
    expect(
      remoteBeforeFinalize[0]?.changes.map((change: any) => change.structural.changeId),
    ).toEqual(['mutation-1:sheet:0']);

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    const changes = capturedChanges(captured);
    expect(changes.map((change) => change.structural)).toEqual([
      {
        kind: 'metadata',
        changeId: 'mutation-1:sheet:0',
        domain: 'sheet',
        entityId: 'sheet-local-1',
        propertyPath: ['name'],
      },
      {
        kind: 'metadata',
        changeId: 'mutation-2:sheet:0',
        domain: 'sheet',
        entityId: 'sheet-local-2',
        propertyPath: ['name'],
      },
    ]);
    expect(changes.map((change) => change.after.value)).toEqual(['Local One', 'Local Two']);
    expect(captured.input.author).toEqual(AUTHOR);

    const segmentPayloads = captured.input.mutationSegmentRecords?.map(
      (record) => record.preimage.payload as any,
    );
    expect(segmentPayloads?.map((payload) => payload.segmentId)).toEqual([
      'mutation-1',
      'mutation-2',
    ]);
    expect(
      segmentPayloads?.some(
        (payload) => payload.operationContext?.author?.authorId === REMOTE_AUTHOR.authorId,
      ),
    ).toBe(false);

    captured.finalize?.({ status: 'success', commitId: COMMIT_ID });
    expect(pendingRemoteSnapshots(capture)).toHaveLength(1);

    expectCaptureMissingChangeSet(await capture.captureNormalCommit(captureInput()));
  });
}
