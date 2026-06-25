import { VersionStoreProviderError, createInMemoryVersionStoreProvider } from '../provider';
import { DOCUMENT_SCOPE, expectInitializeFailed, initializeInput } from './provider-test-utils';

describe('InMemoryVersionStoreProvider capabilities and provider states', () => {
  it('reports writable in-memory capabilities without claiming durability', () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });

    expect(provider.capabilities).toMatchObject({
      durableGraphRegistry: false,
      durableObjects: false,
      atomicObjectBatch: true,
      casGraphRegistry: true,
      casRefs: true,
      multiProcessCasGraphRegistry: false,
      multiProcessCasRefs: false,
      readOnlyHistory: false,
      reads: {
        graphRegistry: true,
        objects: true,
        refs: true,
        commits: true,
      },
      writes: {
        initializeGraph: true,
        putObjects: true,
        updateRefs: true,
        updateSymbolicRefs: true,
        commitGraphWrite: true,
      },
    });
  });

  it('returns read-only, unavailable, and unsupported durable-persistence diagnostics', async () => {
    const readOnly = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      readOnly: true,
    });
    expect(readOnly.capabilities.readOnlyHistory).toBe(true);
    expect(readOnly.capabilities.writes.initializeGraph).toBe(false);
    const readOnlyResult = await readOnly.initializeGraph(await initializeInput('graph-readonly'));
    expectInitializeFailed(readOnlyResult);
    expect(readOnlyResult.diagnostics[0]).toMatchObject({
      code: 'VERSION_STORE_READ_ONLY',
      messageTemplateId: 'version.store.read-only',
      operation: 'initializeGraph',
    });

    const unavailable = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      unavailable: true,
    });
    expect(unavailable.capabilities.reads.graphRegistry).toBe(false);
    const unavailableResult = await unavailable.initializeGraph(
      await initializeInput('graph-unavailable'),
    );
    expectInitializeFailed(unavailableResult);
    expect(unavailableResult.diagnostics[0]).toMatchObject({
      code: 'VERSION_STORE_UNAVAILABLE',
      messageTemplateId: 'version.store.unavailable',
      operation: 'initializeGraph',
    });
    await expect(unavailable.readGraphRegistry()).rejects.toBeInstanceOf(VersionStoreProviderError);

    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const unsupported = await provider.initializeGraph({
      ...(await initializeInput('graph-durable')),
      requireDurablePersistence: true,
    });
    expectInitializeFailed(unsupported);
    expect(unsupported.diagnostics[0]).toMatchObject({
      code: 'VERSION_UNSUPPORTED_DURABLE_PERSISTENCE',
      recoverability: 'unsupported',
      operation: 'initializeGraph',
    });
  });

  it('rejects new operations after close and keeps close/dispose idempotent', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });

    await provider.close();
    await provider.close('test-teardown');
    await provider.dispose();
    await provider.dispose('test-teardown');

    await expect(provider.readGraphRegistry()).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'VERSION_STORE_UNAVAILABLE',
        lifecycleState: 'disposed',
        operation: 'readGraphRegistry',
        redacted: true,
      }),
    });
    const initialize = await provider.initializeGraph(await initializeInput('graph-after-close'));
    expectInitializeFailed(initialize);
    expect(initialize).toMatchObject({
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_STORE_UNAVAILABLE',
          lifecycleState: 'disposed',
          operation: 'initializeGraph',
        }),
      ],
    });
  });
});
