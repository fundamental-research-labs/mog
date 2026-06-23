import type { WorkbookCommitId } from '../../../document/version-store/object-digest';
import type {
  VersionGraphStore,
  VersionStoreProvider,
} from '../../../document/version-store/provider';

export function providerWithClosureSubstitution(
  provider: VersionStoreProvider,
  requestedCommitId: WorkbookCommitId,
  returnedCommitId: WorkbookCommitId,
): VersionStoreProvider {
  const readGraphRegistry: VersionStoreProvider['readGraphRegistry'] = () =>
    provider.readGraphRegistry();
  const openGraph: VersionStoreProvider['openGraph'] = async (namespace, accessContext) =>
    graphWithClosureSubstitution(
      await provider.openGraph(namespace, accessContext),
      requestedCommitId,
      returnedCommitId,
    );

  return {
    readGraphRegistry,
    openGraph,
  } as VersionStoreProvider;
}

function graphWithClosureSubstitution(
  graph: VersionGraphStore,
  requestedCommitId: WorkbookCommitId,
  returnedCommitId: WorkbookCommitId,
): VersionGraphStore {
  return new Proxy(graph, {
    get(target, property, receiver) {
      if (property !== 'readCommitClosure') return Reflect.get(target, property, receiver);
      return (commitId: WorkbookCommitId | string) =>
        target.readCommitClosure(commitId === requestedCommitId ? returnedCommitId : commitId);
    },
  });
}
