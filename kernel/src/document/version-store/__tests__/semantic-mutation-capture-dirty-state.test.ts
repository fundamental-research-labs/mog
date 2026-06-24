import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

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

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const NOW = new Date('2026-06-20T00:00:00.000Z');
const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;

describe('semantic mutation capture dirty state', () => {
  it('keeps uncaptured normal mutations in the capture state after successful finalization', async () => {
    const capture = createRustBackedTestSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_unsupported_normal_local_write',
      result: mutationResult(),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_rename_compute_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            field: 'name',
            oldName: 'Sheet1',
            name: 'Renamed',
          },
        ],
      }),
    });

    expect(capture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 1,
      pendingUncapturedNormalMutationCount: 1,
      hasPendingNormalMutations: true,
      hasUncapturedNormalMutations: true,
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    captured.finalize?.({ status: 'success', commitId: COMMIT_ID });

    expect(capture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 1,
      hasPendingNormalMutations: true,
      hasUncapturedNormalMutations: true,
    });
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

function captureInput(): VersionNormalCommitCaptureInput {
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

function expectCaptureSuccess(
  result: VersionNormalCommitCaptureResult,
): Extract<VersionNormalCommitCaptureResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected capture success: ${result.diagnostics[0]?.code}`);
  }
  return result;
}
