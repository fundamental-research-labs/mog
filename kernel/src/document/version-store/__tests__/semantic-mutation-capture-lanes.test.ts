import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { MutationResult } from '../../../bridges/compute/compute-types.gen';
import type {
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
} from '../commit-service';
import type { WorkbookCommitId } from '../object-digest';
import type { VersionGraphNamespace } from '../object-store';
import { createSemanticMutationCapture } from '../semantic-mutation-capture';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const REMOTE_AUTHOR: VersionAuthor = {
  authorId: 'remote-user-1',
  actorKind: 'user',
  displayName: 'Remote User One',
};

const NOW = new Date('2026-06-20T00:00:00.000Z');
const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;

describe('semantic mutation capture lanes', () => {
  it('keeps interleaved pending remote records out of normal commits', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

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

    const afterFinalize = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(afterFinalize.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [],
    });
    expect(afterFinalize.input.mutationSegmentRecords).toEqual([]);
    expect(afterFinalize.input.author).toEqual(AUTHOR);
  });

  it('skips blocked mixed unknown excluded and shadow collaboration contexts', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });
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
});

function sheetRenameResult(sheetId: string, oldName: string, name: string): MutationResult {
  return mutationResult({
    sheetChanges: [
      {
        sheetId,
        kind: 'Set',
        field: 'name',
        oldName,
        name,
      },
    ],
  });
}

function mutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
    ...overrides,
  } as MutationResult;
}

function operationContext(
  overrides: Partial<VersionOperationContext> = {},
): VersionOperationContext {
  return {
    operationId: 'operation-1',
    kind: 'mutation',
    author: AUTHOR,
    createdAt: NOW.toISOString(),
    domainIds: ['test'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    ...overrides,
  };
}

function syncCollaboration(
  overrides: Partial<NonNullable<VersionOperationContext['collaboration']>> = {},
): NonNullable<VersionOperationContext['collaboration']> {
  return {
    sourceKind: 'collaborationLiveRemote',
    originKind: 'room',
    roomId: 'room-1',
    payloadHash: 'payload-1',
    trustStatus: 'verified',
    authorState: 'singleRemote',
    replay: false,
    system: false,
    commitGrouping: 'pendingRemote',
    validationDiagnosticCount: 0,
    ...overrides,
  };
}

function pendingRemoteSnapshots(capture: ReturnType<typeof createSemanticMutationCapture>): any[] {
  const mutationCapture = capture.mutationCapture as unknown as {
    snapshotPendingRemoteMutations(): readonly any[];
  };
  return [...mutationCapture.snapshotPendingRemoteMutations()];
}

function capturedChanges(
  captured: Extract<VersionNormalCommitCaptureResult, { status: 'success' }>,
): any[] {
  return (captured.input.semanticChangeSetRecord.preimage.payload as any).changes;
}

function captureInput(): VersionNormalCommitCaptureInput {
  return { namespace: NAMESPACE } as VersionNormalCommitCaptureInput;
}

function expectCaptureSuccess(
  result: VersionNormalCommitCaptureResult,
): Extract<VersionNormalCommitCaptureResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected capture success: ${result.diagnostics[0]?.code}`);
  }
  return result;
}
