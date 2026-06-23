import type { VersionMergeResultId } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createInMemoryWorkbookCommitStore } from '../commit-store';
import { intentIdForMergeResultId } from '../merge-apply-intent-store';
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

type PersistenceGraph = Awaited<ReturnType<typeof graphWithRootAndDetachedChildren>>;

export async function expectNoIntentForReviewResult(
  graph: PersistenceGraph,
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

export async function graphWithRootAndDetachedChildren(options: {
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

export function validSemanticPayload(changes: readonly unknown[]) {
  return {
    schemaVersion: 1,
    changes,
  };
}

export function valueChange(
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
