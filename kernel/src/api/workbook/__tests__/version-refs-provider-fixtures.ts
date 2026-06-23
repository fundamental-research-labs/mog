import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import {
  DOCUMENT_SCOPE,
  commitGraphChild as commitVersionGraphChild,
  initializeInput,
  expectInitializeSuccess,
  type VersionGraphRefRevision,
} from './version-refs-provider-test-utils';

export async function createProviderGraphFixture(
  options: {
    readonly graphId?: string;
    readonly rootLabel?: string;
  } = {},
) {
  const graphId = options.graphId ?? 'graph-1';
  const rootLabel = options.rootLabel ?? 'root';
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput(graphId, rootLabel));
  expectInitializeSuccess(initialized);
  const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, graphId));

  return {
    graphId,
    graph,
    initialized,
    provider,
  };
}

export type ProviderGraphFixture = Awaited<ReturnType<typeof createProviderGraphFixture>>;

export function commitProviderGraphChild(
  fixture: ProviderGraphFixture,
  label: string,
  options: {
    readonly parentCommitId?: string;
    readonly expectedMainRefVersion?: VersionGraphRefRevision;
  } = {},
) {
  return commitVersionGraphChild(
    fixture.graph,
    fixture.graphId,
    options.parentCommitId ?? fixture.initialized.rootCommit.id,
    options.expectedMainRefVersion ?? fixture.initialized.initialHead.revision,
    label,
  );
}
