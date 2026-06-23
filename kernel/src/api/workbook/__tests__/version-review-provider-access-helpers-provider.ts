import type { VersionObjectType } from '../../../document/version-store/object-digest';
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
import {
  CREATED_AT,
  DOCUMENT_SCOPE,
  GRAPH_AUTHOR,
} from './version-review-provider-access-helpers-constants';

export async function providerWithRootAndChildReviewChanges(
  graphId: string,
  reviewChanges: readonly unknown[],
) {
  const documentScope = {
    ...DOCUMENT_SCOPE,
    documentId: `${DOCUMENT_SCOPE.documentId}-${graphId}`,
  };
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(await initializeInput(graphId, documentScope));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const graph = await provider.openGraph(namespace);
  const head = await graph.readHead();
  if (head.status !== 'success') throw new Error('expected initialized graph head');
  const committed = await graph.commit({
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: 'child',
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: reviewChanges,
      reviewChanges,
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: 'child-segment-1',
      }),
    ],
    author: GRAPH_AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
    expectedHeadCommitId: head.head.id,
    expectedMainRefVersion: head.head.refRevision as any,
  });
  if (committed.status !== 'success') {
    throw new Error(`expected child commit success: ${JSON.stringify(committed.diagnostics)}`);
  }
  return {
    provider,
    rootCommitId: initialized.rootCommit.id,
    childCommitId: committed.commit.id,
  };
}

export async function commitReviewFixture(
  graph: Awaited<ReturnType<ReturnType<typeof createInMemoryVersionStoreProvider>['openGraph']>>,
  namespace: VersionGraphNamespace,
  input: {
    readonly expectedHeadCommitId: string;
    readonly expectedMainRefVersion: unknown;
    readonly label: string;
  },
) {
  const committed = await graph.commit({
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: input.label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: [],
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${input.label}-segment`,
      }),
    ],
    author: GRAPH_AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
    expectedHeadCommitId: input.expectedHeadCommitId as any,
    expectedMainRefVersion: input.expectedMainRefVersion as any,
  });
  if (committed.status !== 'success') {
    throw new Error(
      `expected ${input.label} commit success: ${JSON.stringify(committed.diagnostics)}`,
    );
  }
  return committed;
}

export async function providerWithInitializedRegistry(graphId: string) {
  const documentScope = {
    ...DOCUMENT_SCOPE,
    documentId: `${DOCUMENT_SCOPE.documentId}-${graphId}`,
  };
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(await initializeInput(graphId, documentScope));
  expectInitializeSuccess(initialized);
  return provider;
}

async function initializeInput(
  graphId: string,
  documentScope: VersionDocumentScope,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label: 'root',
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        changes: [],
      }),
      author: GRAPH_AUTHOR,
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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}
