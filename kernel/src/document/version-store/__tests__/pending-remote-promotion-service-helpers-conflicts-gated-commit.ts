import type { VersionGraphStore } from '../provider';
import type {
  ConflictProvider,
  InMemoryProvider,
} from './pending-remote-promotion-service-helpers-conflicts-types';

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
