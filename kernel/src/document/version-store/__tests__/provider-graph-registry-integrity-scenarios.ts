import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../provider';
import { DOCUMENT_SCOPE, expectInitializeFailed, initializeInput } from './provider-test-utils';

export function registerProviderGraphRegistryIntegrityScenarios(): void {
  it('fails closed on corrupt and unsupported registry records without bootstrapping over them', async () => {
    const corruptBackend = new InMemoryVersionDocumentProviderBackend();
    corruptBackend.putCorruptRegistryForTesting(DOCUMENT_SCOPE, 'checksum-mismatch');
    const corruptProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: corruptBackend,
      durability: 'snapshot-test-double',
    });

    const corruptRead = await corruptProvider.readGraphRegistry();
    expect(corruptRead).toMatchObject({
      status: 'corrupt',
      registry: null,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_CORRUPT_REGISTRY',
          messageTemplateId: 'version.registry.corrupt',
          operation: 'readGraphRegistry',
          redacted: true,
        }),
      ],
    });
    const corruptInitialize = await corruptProvider.initializeGraph(
      await initializeInput('graph-corrupt'),
    );
    expectInitializeFailed(corruptInitialize);
    expect(corruptInitialize).toMatchObject({
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ code: 'VERSION_CORRUPT_REGISTRY' })],
    });
    await expect(
      corruptProvider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-corrupt')),
    ).rejects.toMatchObject({
      diagnostic: expect.objectContaining({ code: 'VERSION_CORRUPT_REGISTRY' }),
    });
    expect(
      corruptBackend.getGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-corrupt')),
    ).toBeUndefined();

    const unsupportedBackend = new InMemoryVersionDocumentProviderBackend();
    unsupportedBackend.putUnsupportedRegistryForTesting(DOCUMENT_SCOPE, 'schema-version');
    const unsupportedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: unsupportedBackend,
    });
    const unsupportedRead = await unsupportedProvider.readGraphRegistry();
    expect(unsupportedRead).toMatchObject({
      status: 'unsupported',
      registry: null,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ code: 'VERSION_UNSUPPORTED_REGISTRY' })],
    });
    const unsupportedInitialize = await unsupportedProvider.initializeGraph(
      await initializeInput('graph-unsupported'),
    );
    expectInitializeFailed(unsupportedInitialize);
    expect(unsupportedInitialize.diagnostics[0]).toMatchObject({
      code: 'VERSION_UNSUPPORTED_REGISTRY',
      recoverability: 'unsupported',
    });
  });
}
