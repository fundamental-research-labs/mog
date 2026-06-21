import {
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
} from '../provider-registry';
import { type VersionDocumentScope } from '../provider';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

describe('VersionStoreProviderRegistry', () => {
  it('reports explicit memory and durable snapshot capabilities', () => {
    const registry = createDefaultVersionStoreProviderRegistry();

    expect(registry.capabilities('memory')).toMatchObject({
      durableGraphRegistry: false,
      durableObjects: false,
      reads: { graphRegistry: true, objects: true, refs: true, commits: true },
      writes: { initializeGraph: true, putObjects: true },
    });
    expect(registry.capabilities('memory-durable-snapshot')).toMatchObject({
      durableGraphRegistry: true,
      durableObjects: true,
      reads: { graphRegistry: true, objects: true, refs: true, commits: true },
      writes: { initializeGraph: true, putObjects: true },
    });
    expect(registry.capabilities('nodeFile')).toBeNull();
  });

  it('selects unavailable providers for unsupported or required-durable requests', async () => {
    const durableRequired = selectVersionStoreProvider({
      kind: 'memory',
      documentScope: DOCUMENT_SCOPE,
      requireDurablePersistence: true,
    });
    expect(durableRequired.capabilities).toMatchObject({
      durableGraphRegistry: false,
      durableObjects: false,
      readOnlyHistory: true,
      reads: { graphRegistry: false },
      writes: { initializeGraph: false },
    });
    await expect(durableRequired.readGraphRegistry()).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'VERSION_STORE_UNAVAILABLE',
        messageTemplateId: 'version.store.unavailable',
        operation: 'readGraphRegistry',
        redacted: true,
      }),
    });

    const unsupported = selectVersionStoreProvider({
      kind: 'nodeFile',
      documentScope: DOCUMENT_SCOPE,
    });
    await expect(unsupported.readGraphRegistry()).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'VERSION_STORE_UNAVAILABLE',
        messageTemplateId: 'version.store.unavailable',
        operation: 'readGraphRegistry',
        redacted: true,
      }),
    });
    await expect(unsupported.readGraphRegistry()).rejects.not.toMatchObject({
      diagnostic: expect.objectContaining({
        details: expect.anything(),
      }),
    });
  });

  it('selects the durable snapshot provider only when explicitly requested', () => {
    const provider = selectVersionStoreProvider({
      kind: 'memory-durable-snapshot',
      documentScope: DOCUMENT_SCOPE,
      requireDurablePersistence: true,
    });

    expect(provider.capabilities).toMatchObject({
      durableGraphRegistry: true,
      durableObjects: true,
      readOnlyHistory: false,
      writes: { initializeGraph: true },
    });
  });
});
