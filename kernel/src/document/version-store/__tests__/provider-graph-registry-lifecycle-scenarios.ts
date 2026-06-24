import { VERSION_GRAPH_MAIN_REF } from '../graph';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../provider';
import {
  DOCUMENT_SCOPE,
  expectInitializeSuccess,
  expectReadHeadSuccess,
  expectRegistryOk,
  initializeInput,
} from './provider-test-utils';

export function registerProviderGraphRegistryLifecycleScenarios(): void {
  it('initializes, reads, and opens the current registry-bound graph', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const input = await initializeInput('graph-1');

    const initialized = await provider.initializeGraph(input);
    expectInitializeSuccess(initialized);
    expect(initialized.registry).toMatchObject({
      schemaVersion: 1,
      workspaceId: DOCUMENT_SCOPE.workspaceId,
      documentId: DOCUMENT_SCOPE.documentId,
      principalScope: DOCUMENT_SCOPE.principalScope,
      currentGraphId: 'graph-1',
      headRefName: VERSION_GRAPH_MAIN_REF,
      rootCommitId: initialized.rootCommit.id,
      registryRevision: { kind: 'counter', value: '0' },
      registryChecksum: { algorithm: 'sha256' },
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    expect(initialized.initialHead).toMatchObject({
      name: VERSION_GRAPH_MAIN_REF,
      commitId: initialized.rootCommit.id,
      revision: { kind: 'counter', value: '0' },
    });
    expect(initialized.symbolicHead).toMatchObject({
      name: 'HEAD',
      target: VERSION_GRAPH_MAIN_REF,
    });

    const registryRead = await provider.readGraphRegistry();
    expectRegistryOk(registryRead);
    expect(registryRead.registry).toEqual(initialized.registry);

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const head = await graph.readHead();
    expectReadHeadSuccess(head);
    expect(head.head.id).toBe(initialized.rootCommit.id);
  });

  it('reloads registry and graph readback from a durable snapshot test backend', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1'));
    expectInitializeSuccess(initialized);

    const snapshot = await backend.exportSnapshot();
    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
    const reloadedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: reloadedBackend,
      durability: 'snapshot-test-double',
    });

    expect(reloadedProvider.capabilities).toMatchObject({
      durableGraphRegistry: true,
      durableObjects: true,
      readOnlyHistory: false,
    });
    const registryRead = await reloadedProvider.readGraphRegistry();
    expectRegistryOk(registryRead);
    expect(registryRead.registry).toEqual(initialized.registry);

    const graph = await reloadedProvider.openGraph(
      namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'),
    );
    const head = await graph.readHead();
    expectReadHeadSuccess(head);
    expect(head.head.id).toBe(initialized.rootCommit.id);

    const commits = await graph.listCommits();
    expect(commits.status).toBe('success');
    if (commits.status === 'success') {
      expect(commits.commits.map((commit) => commit.id)).toEqual([initialized.rootCommit.id]);
    }
  });
}
