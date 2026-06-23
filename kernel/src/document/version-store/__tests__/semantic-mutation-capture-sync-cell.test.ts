import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { MutationResult } from '../../../bridges/compute/compute-types.gen';
import type {
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
} from '../commit-service';
import type { VersionGraphNamespace } from '../object-store';
import { createSemanticMutationCapture } from '../semantic-mutation-capture';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const LOCAL_AUTHOR: VersionAuthor = {
  authorId: 'local-user-1',
  actorKind: 'user',
  displayName: 'Local User One',
};

const REMOTE_AUTHOR: VersionAuthor = {
  authorId: 'remote-user-1',
  actorKind: 'user',
  displayName: 'Remote User One',
};

const NOW = new Date('2026-06-20T00:00:00.000Z');

describe('semantic mutation capture sync cell lane', () => {
  it('captures sync-authored cell changes only in the pending remote lane', async () => {
    const capture = createSemanticMutationCapture({ author: LOCAL_AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_apply_sync_update',
      operationContext: pendingRemoteOperationContext(),
      result: mutationResult({
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

    const normalCommit = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(normalCommit.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [],
    });
    expect(normalCommit.input.mutationSegmentRecords).toEqual([]);
    expect(normalCommit.input.author).toEqual(LOCAL_AUTHOR);
    expect(pendingRemoteSnapshots(capture)).toHaveLength(1);
  });
});

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

function pendingRemoteOperationContext(): VersionOperationContext {
  return {
    operationId: 'sync:providerLiveInbound:remote-update-1',
    kind: 'sync-import',
    author: REMOTE_AUTHOR,
    createdAt: NOW.toISOString(),
    domainIds: ['runtime-diagnostics'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    collaboration: {
      sourceKind: 'providerLiveInbound',
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-stable-1',
      providerKind: 'test-provider',
      authorityRef: 'authority-1',
      epoch: '1',
      updateId: 'remote-update-1',
      payloadHash: 'remote-payload-hash-1',
      trustStatus: 'verified',
      authorState: 'singleRemote',
      remoteSessionId: 'remote-session-1',
      replay: false,
      system: false,
      commitGrouping: 'pendingRemote',
      validationDiagnosticCount: 0,
    },
  };
}

function pendingRemoteSnapshots(capture: ReturnType<typeof createSemanticMutationCapture>): any[] {
  const mutationCapture = capture.mutationCapture as unknown as {
    snapshotPendingRemoteMutations(): readonly any[];
  };
  return [...mutationCapture.snapshotPendingRemoteMutations()];
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
