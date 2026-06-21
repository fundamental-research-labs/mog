import type { VersionMergeResultId } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createInMemoryWorkbookCommitStore } from '../commit-store';
import { intentIdForMergeResultId } from '../merge-apply-intent-store';
import { mergePreviewArtifactRef } from '../merge-attempt-artifacts';
import { createWorkbookVersionMergeService } from '../merge-service';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType, WorkbookCommitId } from '../object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const CREATED_AT = '2026-06-20T00:00:00.000Z';

describe('WorkbookVersionMergeService persisted review artifacts', () => {
  it('persists clean divergent previews as durable review artifacts', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-b1', 'cells.values', 'sheet-1!B1', [], null, 'ready'),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge(
      {
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: graph.theirsCommitId,
      },
      {
        mode: 'preview',
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead: {
          commitId: graph.oursCommitId,
          revision: { kind: 'counter', value: '1' },
        },
        persistReviewRecord: true,
      },
    );

    expect(result).toMatchObject({
      status: 'clean',
      attemptPersistence: 'persisted',
      attemptKind: 'reviewOnly',
      resultDigest: {
        algorithm: 'sha256',
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      previewArtifactDigest: {
        algorithm: 'sha256',
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
    });
    if (result.status !== 'clean' || !result.previewArtifactDigest || !result.resultId) {
      throw new Error('expected a persisted clean review artifact');
    }
    expect(result.resultDigest).toEqual(result.previewArtifactDigest);

    const opened = await graph.provider.openGraph(graph.namespace);
    await expect(opened.getObjectRecord(mergePreviewArtifactRef(result.previewArtifactDigest)))
      .resolves.toMatchObject({
        preimage: {
          payload: {
            recordKind: 'mergePreview',
            status: 'clean',
            changes: expect.arrayContaining([
              expect.objectContaining({
                structural: expect.objectContaining({ entityId: 'sheet-1!A1' }),
              }),
              expect.objectContaining({
                structural: expect.objectContaining({ entityId: 'sheet-1!B1' }),
              }),
            ]),
            conflicts: [],
          },
        },
      });

    await expectNoIntentForReviewResult(graph, result.resultId);
  });

  it('persists conflicted previews as durable review artifacts without apply intents', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-a1', 'cell', 'sheet-1!A1', ['value'], 1, 3),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge(
      {
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: graph.theirsCommitId,
      },
      {
        mode: 'preview',
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead: {
          commitId: graph.oursCommitId,
          revision: { kind: 'counter', value: '1' },
        },
        persistReviewRecord: true,
      },
    );

    expect(result).toMatchObject({
      status: 'conflicted',
      attemptPersistence: 'persisted',
      attemptKind: 'reviewOnly',
      resultDigest: {
        algorithm: 'sha256',
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      previewArtifactDigest: {
        algorithm: 'sha256',
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
    });
    if (result.status !== 'conflicted' || !result.previewArtifactDigest || !result.resultId) {
      throw new Error('expected a persisted conflicted review artifact');
    }
    expect(result.resultDigest).toEqual(result.previewArtifactDigest);

    const opened = await graph.provider.openGraph(graph.namespace);
    await expect(opened.getObjectRecord(mergePreviewArtifactRef(result.previewArtifactDigest)))
      .resolves.toMatchObject({
        preimage: {
          payload: {
            recordKind: 'mergePreview',
            status: 'conflicted',
            changes: [],
            conflicts: [
              expect.objectContaining({
                conflictKind: 'same-property',
                structural: expect.objectContaining({ entityId: 'sheet-1!A1' }),
              }),
            ],
          },
        },
      });

    await expectNoIntentForReviewResult(graph, result.resultId);
  });
});

async function expectNoIntentForReviewResult(
  graph: Awaited<ReturnType<typeof graphWithRootAndDetachedChildren>>,
  resultId: VersionMergeResultId,
) {
  const intentId = intentIdForMergeResultId(resultId);
  if (!intentId) throw new Error('expected review result id to parse as an intent id');
  const store = await graph.provider.openMergeApplyIntentStore(graph.namespace);
  await expect(store.readByIntentId(intentId)).resolves.toMatchObject({ status: 'missing' });
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

async function graphWithRootAndDetachedChildren(options: {
  readonly oursSemanticPayload: unknown;
  readonly theirsSemanticPayload: unknown;
}) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-persist', 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-persist');
  const rootCommitId = initialized.rootCommit.id;
  const graph = { provider, namespace, rootCommitId };

  const oursCommitId = await createDetachedChild(graph, {
    label: 'ours',
    parentCommitId: rootCommitId,
    semanticPayload: options.oursSemanticPayload,
  });
  const theirsCommitId = await createDetachedChild(graph, {
    label: 'theirs',
    parentCommitId: rootCommitId,
    semanticPayload: options.theirsSemanticPayload,
  });

  return {
    provider,
    namespace,
    rootCommitId,
    oursCommitId,
    theirsCommitId,
  };
}

async function createDetachedChild(
  graph: {
    readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
    readonly namespace: VersionGraphNamespace;
  },
  options: {
    readonly label: string;
    readonly parentCommitId: WorkbookCommitId;
    readonly semanticPayload: unknown;
  },
): Promise<WorkbookCommitId> {
  const opened = await graph.provider.openGraph(graph.namespace);
  const commitStore = createInMemoryWorkbookCommitStore(opened.objectStore);
  const created = await commitStore.createWorkbookCommit({
    documentId: graph.namespace.documentId,
    parentCommitIds: [options.parentCommitId],
    snapshotRootRecord: await objectRecord(graph.namespace, 'workbook.snapshotRoot.v1', {
      label: options.label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(
      graph.namespace,
      'workbook.semanticChangeSet.v1',
      options.semanticPayload,
    ),
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
    throw new Error(`expected detached child commit success: ${created.diagnostics[0]?.code}`);
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

function validSemanticPayload(changes: readonly unknown[]) {
  return {
    schemaVersion: 1,
    changes,
  };
}

function valueChange(
  changeId: string,
  domain: string,
  entityId: string,
  propertyPath: readonly string[],
  before: unknown,
  after: unknown,
) {
  return {
    changeId,
    domain,
    entityId,
    propertyPath,
    before: { kind: 'value', value: before },
    after: { kind: 'value', value: after },
    display: {
      address: { kind: 'value', value: entityId.split('!')[1] ?? entityId },
    },
  };
}
