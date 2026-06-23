import {
  REMOTE_AUTHOR,
  capturedChanges,
  captureInput,
  createLaneSemanticMutationCapture,
  expectCaptureSuccess,
  operationContext,
  pendingRemoteSnapshots,
  sheetRenameResult,
  syncCollaboration,
} from './semantic-mutation-capture-lanes-test-helpers';

export function describeCollaborationPolicyLaneScenarios(): void {
  it('skips blocked mixed unknown excluded and shadow collaboration contexts', async () => {
    const capture = createLaneSemanticMutationCapture();
    const skippedContexts = [
      operationContext({
        operationId: 'blocked-unverified',
        kind: 'sync-import',
        author: REMOTE_AUTHOR,
        collaboration: syncCollaboration({
          trustStatus: 'unverified',
          commitGrouping: 'blockedUnverified',
        }),
      }),
      operationContext({
        operationId: 'blocked-mixed',
        kind: 'sync-import',
        author: { authorId: 'sync:mixed-remote', actorKind: 'system' },
        collaboration: syncCollaboration({
          authorState: 'mixedRemote',
          commitGrouping: 'blockedMixedRemote',
        }),
      }),
      operationContext({
        operationId: 'blocked-unknown',
        kind: 'sync-import',
        author: { authorId: 'sync:unknown:missing-author', actorKind: 'system' },
        collaboration: syncCollaboration({
          authorState: 'unknown',
          commitGrouping: 'blockedUnknownRemote',
        }),
      }),
      operationContext({
        operationId: 'blocked-redaction-key',
        kind: 'sync-import',
        author: REMOTE_AUTHOR,
        collaboration: syncCollaboration({
          commitGrouping: 'blockedMissingRedactionKey',
          validationDiagnosticCount: 1,
        }),
      }),
      operationContext({
        operationId: 'sync-no-pending-group',
        kind: 'sync-import',
        author: REMOTE_AUTHOR,
        collaboration: syncCollaboration({
          commitGrouping: 'none',
        }),
      }),
      operationContext({
        operationId: 'sync-missing-collaboration',
        kind: 'sync-import',
        author: REMOTE_AUTHOR,
        collaboration: undefined,
      }),
      operationContext({
        operationId: 'excluded-lifecycle',
        kind: 'sync-import',
        author: { authorId: 'sync:collaboration-hydration', actorKind: 'system' },
        capturePolicy: 'excluded',
        writeAdmissionMode: 'captureDisabledNoHistory',
        collaboration: syncCollaboration({
          replay: true,
          system: true,
          authorState: 'system',
          commitGrouping: 'excludedLifecycle',
        }),
      }),
      operationContext({
        operationId: 'shadow-only',
        kind: 'sync-import',
        author: { authorId: 'sync:shadow-only', actorKind: 'system' },
        capturePolicy: 'shadowOnly',
        writeAdmissionMode: 'shadowOnly',
        collaboration: syncCollaboration({
          authorState: 'system',
          commitGrouping: 'none',
        }),
      }),
    ];

    skippedContexts.forEach((operationContext, index) => {
      capture.mutationCapture.recordMutationResult({
        operation: 'compute_rename_compute_sheet',
        operationContext,
        result: sheetRenameResult(`sheet-skipped-${index}`, 'Before', 'Skipped'),
      });
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_rename_compute_sheet',
      result: sheetRenameResult('sheet-local', 'Before', 'Local'),
    });

    expect(pendingRemoteSnapshots(capture)).toEqual([]);
    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    const changes = capturedChanges(captured);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      structural: {
        kind: 'metadata',
        changeId: 'mutation-1:sheet:0',
        domain: 'sheet',
        entityId: 'sheet-local',
        propertyPath: ['name'],
      },
      before: { kind: 'value', value: 'Before' },
      after: { kind: 'value', value: 'Local' },
    });
  });
}
