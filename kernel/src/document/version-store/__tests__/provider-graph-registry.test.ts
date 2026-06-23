import { VERSION_GRAPH_MAIN_REF } from '../graph-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../provider';
import {
  DOCUMENT_SCOPE,
  OTHER_DOCUMENT_SCOPE,
  expectInitializeFailed,
  expectInitializeSuccess,
  expectReadHeadSuccess,
  expectRegistryAbsent,
  expectRegistryOk,
  initializeInput,
  rootWrite,
} from './provider-test-utils';

describe('InMemoryVersionStoreProvider graph registry', () => {
  it('returns structured uninitialized diagnostics before registry initialization', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });

    const result = await provider.readGraphRegistry();

    expectRegistryAbsent(result);
    expect(result.registry).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_GRAPH_UNINITIALIZED',
        issueCode: 'VERSION_GRAPH_UNINITIALIZED',
        messageTemplateId: 'version.graph.uninitialized',
        operation: 'readGraphRegistry',
        redacted: true,
        documentScope: DOCUMENT_SCOPE,
      }),
    ]);
  });

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

  it('fails initialization for root object records outside the requested namespace', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const wrongNamespace = namespaceForDocumentScope(OTHER_DOCUMENT_SCOPE, 'graph-1');

    const result = await provider.initializeGraph({
      expectedRegistryRevision: null,
      graphId: 'graph-1',
      rootWrite: await rootWrite('wrong-namespace', wrongNamespace),
    });

    expectInitializeFailed(result);
    expect(result).toMatchObject({
      mutationGuarantee: 'no-write-attempted',
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'VERSION_WRONG_NAMESPACE',
          messageTemplateId: 'version.integrity.wrong-namespace',
          operation: 'initializeGraph',
        }),
      ]),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_WRONG_NAMESPACE',
      'VERSION_WRONG_NAMESPACE',
    ]);
    expectRegistryAbsent(await provider.readGraphRegistry());
  });

  it('fails openGraph when the requested namespace does not match the visible registry', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1'));
    expectInitializeSuccess(initialized);

    await expect(
      provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-2')),
    ).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'VERSION_WRONG_NAMESPACE',
        operation: 'openGraph',
      }),
    });
  });

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
});
