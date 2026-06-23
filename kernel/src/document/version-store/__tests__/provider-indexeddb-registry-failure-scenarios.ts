import {
  DOCUMENT_SCOPE,
  createIndexedDbVersionStoreProvider,
  createVersionGraphRegistry,
  initializeInput,
  namespaceForDocumentScope,
  putRegistryEnvelope,
  resetIndexedDbVersionStoreForTesting,
} from './provider-indexeddb-core-test-utils';

export function registerIndexedDbRegistryFailureScenarios(): void {
  it('fails closed on corrupt and unsupported visible registries', async () => {
    const corrupt = await createVersionGraphRegistry({
      documentScope: DOCUMENT_SCOPE,
      graphId: 'graph-corrupt',
      rootCommitId:
        'commit:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    await putRegistryEnvelope({
      schemaVersion: 1,
      registry: {
        ...corrupt,
        registryChecksum: { ...corrupt.registryChecksum, digest: '0'.repeat(64) },
      },
    });

    const corruptProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    await expect(
      corruptProvider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-corrupt')),
    ).rejects.toMatchObject({
      diagnostic: expect.objectContaining({ code: 'VERSION_CORRUPT_REGISTRY' }),
    });
    expect(await corruptProvider.readGraphRegistry()).toMatchObject({
      status: 'corrupt',
      mutationGuarantee: 'no-write-attempted',
    });
    expect(
      await corruptProvider.initializeGraph(await initializeInput('replacement')),
    ).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ code: 'VERSION_CORRUPT_REGISTRY' })],
    });

    await corruptProvider.close('test-teardown');
    await resetIndexedDbVersionStoreForTesting();
    await putRegistryEnvelope({ schemaVersion: 99, registry: null });
    const unsupportedProvider = createIndexedDbVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
    });
    expect(await unsupportedProvider.readGraphRegistry()).toMatchObject({
      status: 'unsupported',
      diagnostics: [expect.objectContaining({ code: 'VERSION_UNSUPPORTED_REGISTRY' })],
    });
  });
}
