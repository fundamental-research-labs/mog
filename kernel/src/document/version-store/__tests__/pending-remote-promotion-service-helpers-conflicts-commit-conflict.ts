import type { VersionGraphNamespace } from '../object-store';
import type { VersionGraphStore } from '../provider';
import { expectReadHeadSuccess } from './pending-remote-promotion-service-helpers-assertions';
import { AUTHOR } from './pending-remote-promotion-service-helpers-constants';
import { objectRecord } from './pending-remote-promotion-service-helpers-object-records';
import type {
  ConflictProvider,
  InMemoryProvider,
} from './pending-remote-promotion-service-helpers-conflicts-types';

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
