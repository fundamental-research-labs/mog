import { jest } from '@jest/globals';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  createWorkbookVersionCommitService,
  type VersionNormalCommitCapture,
} from '../commit-service';
import { createProviderBackedBranchLifecycleService } from '../branch-provider-service';
import { VERSION_GRAPH_MAIN_REF } from '../graph-store';
import type { VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersionCommitService', () => {
  it('normalizes direct branch-name targetRef commits to concrete provider refs', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const branchService = createProviderBackedBranchLifecycleService({ provider });
    const branch = await branchService.createBranch({
      name: 'scenario/direct-service',
      targetCommitId: initialized.rootCommit.id,
      expectedAbsent: true,
      createdBy: VERSION_AUTHOR,
    });
    expect(branch).toMatchObject({
      ok: true,
      branch: {
        name: 'scenario/direct-service',
        ref: {
          targetCommitId: initialized.rootCommit.id,
          refVersion: { kind: 'counter', value: '0' },
        },
      },
    });
    const captureNormalCommit = jest.fn(createNormalCommitCapture('branch-child'));
    const service = createWorkbookVersionCommitService({
      provider,
      captureNormalCommit,
    });

    const committed = await service.commit({
      targetRef: 'scenario/direct-service' as any,
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '0' },
      },
    });

    expect(captureNormalCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRef: expect.objectContaining({
          name: 'refs/heads/scenario/direct-service',
          commitId: initialized.rootCommit.id,
        }),
        options: expect.objectContaining({
          targetRef: 'refs/heads/scenario/direct-service',
        }),
      }),
    );
    expect(committed).toMatchObject({
      status: 'success',
      commitRef: {
        refName: 'refs/heads/scenario/direct-service',
        resolvedFrom: 'refs/heads/scenario/direct-service',
        refRevision: { kind: 'counter', value: '1' },
      },
      main: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
      },
    });
    if (committed.status !== 'success') {
      throw new Error(`expected branch commit success: ${committed.diagnostics[0]?.code}`);
    }

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readRef('refs/heads/scenario/direct-service')).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: 'refs/heads/scenario/direct-service',
        commitId: committed.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });
    await expect(graph.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: VERSION_GRAPH_MAIN_REF,
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
      },
    });
  });
});

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function createNormalCommitCapture(label: string): VersionNormalCommitCapture {
  return async ({ namespace, currentRef }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentRef.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [{ id: `${label}-change-1`, domain: 'test' }],
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: currentRef.commitId,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  });
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
