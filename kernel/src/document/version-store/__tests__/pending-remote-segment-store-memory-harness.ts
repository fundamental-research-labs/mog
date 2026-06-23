import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import {
  DOCUMENT_SCOPE,
  expectReadHeadSuccess,
  initializeProvider,
  pendingSegmentFixture,
} from './pending-remote-segment-store-fixtures';

export async function createPendingRemoteSegmentMemoryHarness() {
  const backend = new InMemoryVersionDocumentProviderBackend();
  const provider = createInMemoryVersionStoreProvider({
    documentScope: DOCUMENT_SCOPE,
    backend,
    durability: 'snapshot-test-double',
  });
  const namespace = await initializeProvider(provider);
  const graph = await provider.openGraph(namespace);
  const store = await provider.openPendingRemoteSegmentStore(namespace);
  const fixture = await pendingSegmentFixture(namespace);
  const input = fixture.input;
  const headBefore = await expectReadHeadSuccess(graph);

  return {
    backend,
    namespace,
    graph,
    store,
    fixture,
    input,
    headBefore,
  };
}

export type PendingRemoteSegmentMemoryHarness = Awaited<
  ReturnType<typeof createPendingRemoteSegmentMemoryHarness>
>;
