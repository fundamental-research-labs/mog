import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../provider';
import {
  DOCUMENT_SCOPE,
  expectInitializeFailed,
  expectInitializeSuccess,
  initializeInput,
} from './provider-test-utils';

export function registerProviderGraphRegistryConflictScenarios(): void {
  it('treats same root initialization as idempotent and different graph as a registry conflict', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
    });
    const input = await initializeInput('graph-1');

    const first = await provider.initializeGraph(input);
    const second = await provider.initializeGraph(input);
    expectInitializeSuccess(first);
    expectInitializeSuccess(second);
    expect(second.registry).toEqual(first.registry);
    expect(second.rootCommit.id).toBe(first.rootCommit.id);

    const conflicting = await provider.initializeGraph(await initializeInput('graph-2'));
    expectInitializeFailed(conflicting);
    expect(conflicting).toMatchObject({
      mutationGuarantee: 'no-write-attempted',
      retryable: true,
      diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_CONFLICT' })],
    });
    expect(backend.getGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-2'))).toBeUndefined();
  });
}
