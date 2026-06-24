import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { MutationResult } from '../../../bridges/compute/compute-types.gen';
import type {
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
} from '../commit-service';
import type { VersionGraphNamespace } from '../object-store';
import { createRustBackedTestSemanticMutationCapture } from './semantic-mutation-capture-test-helpers';

const DOCUMENT_SCOPE = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

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

export const REMOTE_AUTHOR: VersionAuthor = {
  authorId: 'remote-user-1',
  actorKind: 'user',
  displayName: 'Remote User One',
};

const NOW = new Date('2026-06-20T00:00:00.000Z');
const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as const;

export function createSyncCellSemanticMutationCapture() {
  return createRustBackedTestSemanticMutationCapture({ author: LOCAL_AUTHOR, now: () => NOW });
}

export function syncCellMutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
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

export function pendingRemoteOperationContext(): VersionOperationContext {
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

export function pendingRemoteSnapshots(
  capture: ReturnType<typeof createRustBackedTestSemanticMutationCapture>,
): any[] {
  const mutationCapture = capture.mutationCapture as unknown as {
    snapshotPendingRemoteMutations(): readonly any[];
  };
  return [...mutationCapture.snapshotPendingRemoteMutations()];
}

export function captureInput(): VersionNormalCommitCaptureInput {
  return {
    provider: { documentScope: DOCUMENT_SCOPE },
    graph: {},
    accessContext: {},
    namespace: NAMESPACE,
    registry: {},
    currentHead: {
      name: 'HEAD',
      target: 'refs/heads/main',
      revision: { providerEpoch: 'test', counter: 1 },
    },
    currentMain: currentRef(),
    currentRef: currentRef(),
    options: {},
  } as VersionNormalCommitCaptureInput;
}

function currentRef() {
  return {
    name: 'refs/heads/main',
    commitId: COMMIT_ID,
    revision: { providerEpoch: 'test', counter: 1 },
    updatedAt: NOW.toISOString(),
  };
}

export function expectCaptureMissingChangeSet(result: VersionNormalCommitCaptureResult): void {
  expect(result).toMatchObject({
    status: 'failed',
    diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_CHANGE_SET' })],
  });
}
