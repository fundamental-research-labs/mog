import type { VersionGraphNamespace } from '../object-store';
import type { PendingRemoteSegmentStore } from '../pending-remote-segment-store';
import type {
  createInMemoryVersionStoreProvider,
  VersionGraphStore,
  VersionStoreProvider,
} from '../provider';
import { expectReadHeadSuccess } from './pending-remote-promotion-service-helpers-assertions';
import { AUTHOR } from './pending-remote-promotion-service-helpers-constants';
import { objectRecord } from './pending-remote-promotion-service-helpers-object-records';

type InMemoryProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;
type ConflictProvider = VersionStoreProvider &
  Pick<InMemoryProvider, 'openPendingRemoteSegmentStore' | 'openSyncBatchStatusStore'>;

export function providerWithCommitConflict(
  provider: InMemoryProvider,
  namespace: VersionGraphNamespace,
): ConflictProvider {
  return {
    documentScope: provider.documentScope,
    accessContext: provider.accessContext,
    capabilities: provider.capabilities,
    readGraphRegistry: provider.readGraphRegistry.bind(provider),
    initializeGraph: provider.initializeGraph.bind(provider),
    scanDocumentIntegrity: provider.scanDocumentIntegrity.bind(provider),
    close: provider.close.bind(provider),
    dispose: provider.dispose.bind(provider),
    openPendingRemoteSegmentStore: provider.openPendingRemoteSegmentStore.bind(provider),
    openSyncBatchStatusStore: provider.openSyncBatchStatusStore.bind(provider),
    openGraph: async (requestedNamespace, accessContext) => {
      const graph = await provider.openGraph(requestedNamespace, accessContext);
      return graphWithOneCommitConflict(graph, namespace);
    },
  };
}

export function providerWithGatedCommit(
  provider: InMemoryProvider,
  gate: { readonly beforeCommit: () => Promise<void> },
): ConflictProvider {
  return {
    documentScope: provider.documentScope,
    accessContext: provider.accessContext,
    capabilities: provider.capabilities,
    readGraphRegistry: provider.readGraphRegistry.bind(provider),
    initializeGraph: provider.initializeGraph.bind(provider),
    scanDocumentIntegrity: provider.scanDocumentIntegrity.bind(provider),
    close: provider.close.bind(provider),
    dispose: provider.dispose.bind(provider),
    openPendingRemoteSegmentStore: provider.openPendingRemoteSegmentStore.bind(provider),
    openSyncBatchStatusStore: provider.openSyncBatchStatusStore.bind(provider),
    openGraph: async (requestedNamespace, accessContext) => {
      const graph = await provider.openGraph(requestedNamespace, accessContext);
      return graphWithGatedCommit(graph, gate);
    },
  };
}

export function providerWithCompletionFailures(
  provider: InMemoryProvider,
  shouldFail: (
    attempt: number,
    input: Parameters<PendingRemoteSegmentStore['completeSegment']>[0],
  ) => boolean,
): ConflictProvider {
  let completionAttempts = 0;
  return {
    documentScope: provider.documentScope,
    accessContext: provider.accessContext,
    capabilities: provider.capabilities,
    readGraphRegistry: provider.readGraphRegistry.bind(provider),
    initializeGraph: provider.initializeGraph.bind(provider),
    scanDocumentIntegrity: provider.scanDocumentIntegrity.bind(provider),
    close: provider.close.bind(provider),
    dispose: provider.dispose.bind(provider),
    openGraph: provider.openGraph.bind(provider),
    openSyncBatchStatusStore: provider.openSyncBatchStatusStore.bind(provider),
    openPendingRemoteSegmentStore: async (namespace) => {
      const store = await provider.openPendingRemoteSegmentStore(namespace);
      const wrapped: PendingRemoteSegmentStore = {
        namespace: store.namespace,
        reserveSegment: (input) => store.reserveSegment(input),
        readBySegmentId: (segmentId) => store.readBySegmentId(segmentId),
        readByIdempotencyKey: (idempotencyKey) => store.readByIdempotencyKey(idempotencyKey),
        listByState: (state) => store.listByState(state),
        completeSegment: (input) => {
          completionAttempts += 1;
          if (!shouldFail(completionAttempts, input)) return store.completeSegment(input);
          const failed: Awaited<ReturnType<PendingRemoteSegmentStore['completeSegment']>> = {
            status: 'failed',
            record: null,
            diagnostics: [
              {
                code: 'VERSION_PROVIDER_FAILED',
                message: 'Injected pending remote completion failure.',
                recoverability: 'retry',
              },
            ],
          };
          return Promise.resolve(failed);
        },
      };
      return wrapped;
    },
  };
}

function graphWithOneCommitConflict(
  graph: VersionGraphStore,
  namespace: VersionGraphNamespace,
): VersionGraphStore {
  let advanced = false;
  return {
    namespace: graph.namespace,
    initializeGraph: (input) => graph.initializeGraph(input),
    mergeCommit: (input) => graph.mergeCommit(input),
    fastForwardRef: (input) => graph.fastForwardRef(input),
    putObjects: (batch) => graph.putObjects(batch),
    readCommit: (commitId) => graph.readCommit(commitId),
    getObjectRecord: <TPayload>(ref) => graph.getObjectRecord<TPayload>(ref),
    hasObject: (ref) => graph.hasObject(ref),
    readHead: () => graph.readHead(),
    readRef: (name) => graph.readRef(name),
    createBranch: (input) => graph.createBranch(input),
    readBranch: (input) => graph.readBranch(input),
    listBranches: (input) => graph.listBranches(input),
    fastForwardBranch: (input) => graph.fastForwardBranch(input),
    getHead: () => graph.getHead(),
    listCommits: (options) => graph.listCommits(options),
    readCommitClosure: (commitId) => graph.readCommitClosure(commitId),
    commit: async (input) => {
      if (!advanced) {
        advanced = true;
        const head = await expectReadHeadSuccess(graph);
        await graph.commit({
          ...(await conflictCommitContent(namespace)),
          expectedHeadCommitId: head.commitId,
          expectedTargetRefVersion: head.revision,
          parentCommitIds: [head.commitId],
        });
      }
      return graph.commit(input);
    },
  };
}

function graphWithGatedCommit(
  graph: VersionGraphStore,
  gate: { readonly beforeCommit: () => Promise<void> },
): VersionGraphStore {
  return {
    namespace: graph.namespace,
    initializeGraph: (input) => graph.initializeGraph(input),
    mergeCommit: (input) => graph.mergeCommit(input),
    fastForwardRef: (input) => graph.fastForwardRef(input),
    putObjects: (batch) => graph.putObjects(batch),
    readCommit: (commitId) => graph.readCommit(commitId),
    getObjectRecord: <TPayload>(ref) => graph.getObjectRecord<TPayload>(ref),
    hasObject: (ref) => graph.hasObject(ref),
    readHead: () => graph.readHead(),
    readRef: (name) => graph.readRef(name),
    createBranch: (input) => graph.createBranch(input),
    readBranch: (input) => graph.readBranch(input),
    listBranches: (input) => graph.listBranches(input),
    fastForwardBranch: (input) => graph.fastForwardBranch(input),
    getHead: () => graph.getHead(),
    listCommits: (options) => graph.listCommits(options),
    readCommitClosure: (commitId) => graph.readCommitClosure(commitId),
    commit: async (input) => {
      await gate.beforeCommit();
      return graph.commit(input);
    },
  };
}

async function conflictCommitContent(namespace: VersionGraphNamespace) {
  return {
    snapshotRootRecord: await objectRecord(
      'workbook.snapshotRoot.v1',
      { label: 'conflict', sheets: [] },
      namespace,
    ),
    semanticChangeSetRecord: await objectRecord(
      'workbook.semanticChangeSet.v1',
      { label: 'conflict', changes: [] },
      namespace,
    ),
    author: AUTHOR,
    createdAt: '2026-06-21T00:00:09.000Z',
    completenessDiagnostics: [],
  };
}
