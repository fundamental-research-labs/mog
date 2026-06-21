import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { VERSION_GRAPH_MAIN_REF, type VersionGraphReadHeadResult } from '../graph-store';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType } from '../object-digest';
import {
  InMemoryVersionDocumentProviderBackend,
  VersionStoreProviderError,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphRegistryReadResult,
} from '../provider';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const OTHER_DOCUMENT_SCOPE: VersionDocumentScope = {
  ...DOCUMENT_SCOPE,
  documentId: 'document-2',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

function expectRegistryOk(
  result: VersionGraphRegistryReadResult,
): asserts result is Extract<VersionGraphRegistryReadResult, { status: 'ok' }> {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') {
    throw new Error(`expected registry ok: ${result.diagnostics[0]?.code}`);
  }
}

function expectRegistryAbsent(
  result: VersionGraphRegistryReadResult,
): asserts result is Extract<VersionGraphRegistryReadResult, { status: 'absent' }> {
  expect(result.status).toBe('absent');
  if (result.status !== 'absent') {
    throw new Error('expected registry absent');
  }
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function expectInitializeFailed(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected initialize failure');
  }
}

function expectReadHeadSuccess(
  result: VersionGraphReadHeadResult,
): asserts result is Extract<VersionGraphReadHeadResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readHead success: ${result.diagnostics[0]?.code}`);
  }
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

async function rootWrite(
  label: string,
  namespace: VersionGraphNamespace,
): Promise<VersionGraphInitializeInput['rootWrite']> {
  return {
    snapshotRootRecord: await objectRecord(
      'workbook.snapshotRoot.v1',
      { label, sheets: [] },
      namespace,
    ),
    semanticChangeSetRecord: await objectRecord(
      'workbook.semanticChangeSet.v1',
      { label, changes: [] },
      namespace,
    ),
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

async function initializeInput(
  graphId: string,
  documentScope: VersionDocumentScope = DOCUMENT_SCOPE,
  label = 'root',
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await rootWrite(label, namespace),
  };
}

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
