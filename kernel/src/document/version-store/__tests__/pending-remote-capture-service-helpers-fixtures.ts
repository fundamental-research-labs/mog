import {
  VERSION_OBJECT_SCHEMA_VERSION,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
  type VersionObjectType,
} from '../object-store';
import type { PendingRemoteSegmentStore } from '../pending-remote-segment-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphRegistry,
  type VersionGraphStore,
} from '../provider';
import { AUTHOR, DOCUMENT_SCOPE } from './pending-remote-capture-service-helpers-context';

type PendingRemoteCaptureProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;

type PendingRemoteCaptureFixture = {
  readonly provider: PendingRemoteCaptureProvider;
  readonly namespace: VersionGraphNamespace;
  readonly graph: VersionGraphStore;
  readonly registry: VersionGraphRegistry;
};

type PendingRemoteCaptureFixtureWithSegmentStore = PendingRemoteCaptureFixture & {
  readonly pendingRemoteSegmentStore: PendingRemoteSegmentStore;
};

export async function createPendingRemoteCaptureFixture(): Promise<PendingRemoteCaptureFixture> {
  const provider = createInMemoryVersionStoreProvider({
    documentScope: DOCUMENT_SCOPE,
    backend: new InMemoryVersionDocumentProviderBackend(),
    durability: 'snapshot-test-double',
  });
  const namespace = await initializeProvider(provider);
  const graph = await provider.openGraph(namespace);
  const registryRead = await provider.readGraphRegistry();
  if (registryRead.status !== 'ok') throw new Error('expected graph registry');

  return {
    provider,
    namespace,
    graph,
    registry: registryRead.registry,
  };
}

export async function createPendingRemoteCaptureFixtureWithSegmentStore(): Promise<PendingRemoteCaptureFixtureWithSegmentStore> {
  const fixture = await createPendingRemoteCaptureFixture();
  const pendingRemoteSegmentStore = await fixture.provider.openPendingRemoteSegmentStore(
    fixture.namespace,
  );

  return {
    ...fixture,
    pendingRemoteSegmentStore,
  };
}

async function initializeProvider(provider: {
  initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
}): Promise<VersionGraphNamespace> {
  const input = await initializeInput('graph-1');
  const initialized = await provider.initializeGraph(input);
  expect(initialized.status).toBe('success');
  if (initialized.status !== 'success') {
    throw new Error(`expected initialize success: ${initialized.diagnostics[0]?.code}`);
  }
  return namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
}

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(
        'workbook.snapshotRoot.v1',
        { label: 'root', sheets: [] },
        namespace,
      ),
      semanticChangeSetRecord: await objectRecord(
        'workbook.semanticChangeSet.v1',
        { label: 'root', changes: [] },
        namespace,
      ),
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: VERSION_OBJECT_SCHEMA_VERSION,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}
