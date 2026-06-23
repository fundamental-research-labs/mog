import type { VersionMergeInput } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createInMemoryWorkbookCommitStore } from '../../../document/version-store/commit-store';
import { createWorkbookVersionMergeService } from '../../../document/version-store/merge-service';
import type { VersionObjectType, WorkbookCommitId } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import { mapApplyMergeWriteResult } from '../version-apply-merge-write-result';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-vc07',
  documentId: 'document-vc07-merge-base',
  principalScope: 'principal-vc07',
};
const CREATED_AT = '2026-06-22T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-vc07',
  actorKind: 'user',
  displayName: 'VC07 User',
};

describe('WorkbookVersion VC-07 merge-base gate', () => {
  it('blocks criss-cross histories with ambiguous lowest common merge bases', async () => {
    const graph = await graphWithRoot('graph-ambiguous-merge-base');
    const baseA = await createCommit(graph, {
      label: 'base-a',
      parentCommitIds: [graph.rootCommitId],
    });
    const baseB = await createCommit(graph, {
      label: 'base-b',
      parentCommitIds: [graph.rootCommitId],
    });
    const ours = await createCommit(graph, {
      label: 'ours-criss-cross',
      parentCommitIds: [baseA, baseB],
    });
    const theirs = await createCommit(graph, {
      label: 'theirs-criss-cross',
      parentCommitIds: [baseB, baseA],
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({ base: baseA, ours, theirs });

    expect(result).toMatchObject({
      status: 'blocked',
      base: baseA,
      ours,
      theirs,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'preview-only',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_BASE_AMBIGUOUS',
          payload: expect.objectContaining({
            diagnosticCode: 'mergeBaseAmbiguous',
            lowestCommonAncestorCount: 2,
          }),
          redacted: true,
        }),
      ],
    });
  });

  it('blocks unrelated histories that have no common merge base', async () => {
    const graph = await graphWithRoot('graph-unrelated-histories');
    const unrelatedRoot = await createCommit(graph, {
      label: 'unrelated-root',
      parentCommitIds: [],
    });
    const ours = await createCommit(graph, {
      label: 'ours-related-to-main-root',
      parentCommitIds: [graph.rootCommitId],
    });
    const theirs = await createCommit(graph, {
      label: 'theirs-related-to-unrelated-root',
      parentCommitIds: [unrelatedRoot],
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({ base: graph.rootCommitId, ours, theirs });

    expect(result).toMatchObject({
      status: 'blocked',
      base: graph.rootCommitId,
      ours,
      theirs,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'preview-only',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_UNRELATED_HISTORIES',
          payload: expect.objectContaining({ diagnosticCode: 'unrelatedHistories' }),
          redacted: true,
        }),
      ],
    });
  });

  it('returns stale-target-head apply diagnostics without accepting merge application', () => {
    const plan = {
      base: commitId('1'),
      ours: commitId('2'),
      theirs: commitId('3'),
      changes: [],
      resolutionCount: 0,
    };

    const result = mapApplyMergeWriteResult(
      {
        status: 'staleTargetHead',
        base: plan.base,
        ours: plan.ours,
        theirs: plan.theirs,
        diagnostics: [],
      },
      plan,
      'merge-commit-created',
    );

    expect(result).toMatchObject({
      status: 'staleTargetHead',
      base: plan.base,
      ours: plan.ours,
      theirs: plan.theirs,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'ref-not-mutated',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'staleTargetHead',
          }),
          mutationGuarantee: 'ref-not-mutated',
          redacted: true,
        }),
      ],
    });
  });
});

async function graphWithRoot(graphId: string) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput(graphId, 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    provider,
    namespace,
    rootCommitId: initialized.rootCommit.id,
  };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

async function createCommit(
  graph: {
    readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
    readonly namespace: VersionGraphNamespace;
  },
  options: {
    readonly label: string;
    readonly parentCommitIds: readonly WorkbookCommitId[];
  },
): Promise<WorkbookCommitId> {
  const opened = await graph.provider.openGraph(graph.namespace);
  const commitStore = createInMemoryWorkbookCommitStore(opened.objectStore);
  const created = await commitStore.createWorkbookCommit({
    documentId: graph.namespace.documentId,
    parentCommitIds: options.parentCommitIds,
    snapshotRootRecord: await objectRecord(graph.namespace, 'workbook.snapshotRoot.v1', {
      label: options.label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(graph.namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: [],
    }),
    mutationSegmentRecords: [
      await objectRecord(graph.namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${options.label}-segment-1`,
      }),
    ],
    author: AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
  });
  if (created.status !== 'success') {
    throw new Error(`expected commit create success: ${created.diagnostics[0]?.code}`);
  }
  return created.commit.id;
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
        schemaVersion: 1,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

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

function commitId(hexDigit: string): VersionMergeInput['base'] {
  return `commit:sha256:${hexDigit.repeat(64)}` as VersionMergeInput['base'];
}
