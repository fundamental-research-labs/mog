import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { MutationResult } from '../../../bridges/compute/compute-types.gen';
import type {
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
} from '../commit-service';
import type { WorkbookCommitId } from '../object-digest';
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

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export const REMOTE_AUTHOR: VersionAuthor = {
  authorId: 'remote-user-1',
  actorKind: 'user',
  displayName: 'Remote User One',
};

const NOW = new Date('2026-06-20T00:00:00.000Z');
export const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;

export function createLaneSemanticMutationCapture() {
  return createRustBackedTestSemanticMutationCapture({ author: AUTHOR, now: () => NOW });
}

export function sheetRenameResult(sheetId: string, oldName: string, name: string): MutationResult {
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

export function operationContext(
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

export function syncCollaboration(
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

export function pendingRemoteSnapshots(
  capture: ReturnType<typeof createRustBackedTestSemanticMutationCapture>,
): any[] {
  const mutationCapture = capture.mutationCapture as unknown as {
    snapshotPendingRemoteMutations(): readonly any[];
  };
  return [...mutationCapture.snapshotPendingRemoteMutations()];
}

export function capturedChanges(
  captured: Extract<VersionNormalCommitCaptureResult, { status: 'success' }>,
): any[] {
  const payload = captured.input.semanticChangeSetRecord.preimage.payload as any;
  return payload.reviewChanges ?? payload.changes;
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

export function expectCaptureSuccess(
  result: VersionNormalCommitCaptureResult,
): Extract<VersionNormalCommitCaptureResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected capture success: ${result.diagnostics[0]?.code}`);
  }
  return result;
}

export function expectCaptureMissingChangeSet(result: VersionNormalCommitCaptureResult): void {
  expect(result).toMatchObject({
    status: 'failed',
    diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_CHANGE_SET' })],
  });
}
