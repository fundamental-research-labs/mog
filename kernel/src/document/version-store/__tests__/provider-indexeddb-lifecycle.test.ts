import 'fake-indexeddb/auto';

import { jest } from '@jest/globals';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { withVersionManifest } from '../../../api/workbook/__tests__/version-domain-support-test-utils';
import type { VersionNormalCommitCapture } from '../commit-service';
import type { VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
  createIndexedDbVersionStoreProvider,
  INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
} from '../provider-indexeddb-backend';
import {
  OBJECTS_STORE,
  deleteVersionStoreIndexedDbForTesting,
  openVersionStoreIndexedDb,
  REGISTRIES_STORE,
} from '../provider-indexeddb-schema';
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
} from '../provider';
import {
  decodeWorkbookSnapshotRootRecord,
  YRS_FULL_STATE_SNAPSHOT_ROOT_KIND,
  YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE,
} from '../snapshot-root-capture';

const SHEET_ID = 'sheet-1';
const FULL_STATE_BYTES = new Uint8Array([0x0a, 0x0b, 0x0c]);

function createMockEventBus() {
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn().mockReturnValue(() => undefined),
    onMany: jest.fn(),
    emit: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

function createMockContext() {
  return {
    eventBus: createMockEventBus(),
    computeBridge: {
      getAllSheetIds: jest.fn().mockResolvedValue([SHEET_ID] as never),
      getSheetName: jest.fn().mockResolvedValue('Sheet1' as never),
      isSheetHidden: jest.fn().mockResolvedValue(false as never),
      getMutationHandler: jest.fn().mockReturnValue(null),
      onTrap: jest.fn().mockReturnValue(() => undefined),
      syncApply: jest.fn().mockResolvedValue(undefined as never),
      encodeDiff: jest.fn().mockResolvedValue(FULL_STATE_BYTES as never),
      currentStateVector: jest.fn().mockResolvedValue(new Uint8Array([0x01]) as never),
    },
    mirror: {
      getSheetIds: jest.fn().mockReturnValue([SHEET_ID]),
      getSheetMeta: jest.fn().mockReturnValue({ name: 'Sheet1', hidden: false }),
      getWorkbookSettings: jest.fn().mockReturnValue({}),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    workbookLinkScope: jest.fn().mockReturnValue({ requestingSessionId: 'session-1' }),
  };
}

jest.unstable_mockModule('../../index', () => ({
  DocumentLifecycleSystem: jest.fn().mockImplementation(() => {
    const context = createMockContext();
    let documentId = 'doc-test';
    return {
      create: jest.fn((id: string) => {
        documentId = id;
      }),
      waitForReady: jest.fn().mockResolvedValue(undefined as never),
      dispose: jest.fn().mockResolvedValue(undefined as never),
      scheduleDeferredHydration: jest.fn().mockResolvedValue(undefined as never),
      ensureDeferredHydration: jest.fn().mockResolvedValue(undefined as never),
      awaitMaterialized: jest.fn().mockResolvedValue(undefined as never),
      awaitImportDurability: jest.fn().mockResolvedValue(undefined as never),
      attachStorageProvider: jest.fn().mockResolvedValue(undefined as never),
      checkpoint: jest.fn().mockResolvedValue({ status: 'checkpointed' } as never),
      close: jest.fn().mockResolvedValue({
        status: 'closed',
        detachedProviders: [],
        errors: [],
        timestamp: Date.now(),
      } as never),
      get snapshot() {
        return { context: { docId: documentId, initialSheetIds: [SHEET_ID] } };
      },
      get documentContext() {
        return context;
      },
      get initialSheetId() {
        return SHEET_ID;
      },
      get rustDocument() {
        return null;
      },
      get computeBridge() {
        return context.computeBridge;
      },
      get isImportDurabilityPending() {
        return false;
      },
      _devtoolsProviders: jest.fn().mockReturnValue([]),
    };
  }),
}));

jest.unstable_mockModule('../../../api/worksheet/worksheet-impl', () => ({
  WorksheetImpl: jest.fn().mockImplementation((sheetId: string) => ({
    _sheetId: sheetId,
    _syncMetadata: jest.fn(),
    dispose: jest.fn(),
  })),
}));

jest.unstable_mockModule('../../../services/checkpoint', () => ({
  createCheckpointManager: jest.fn().mockReturnValue({
    create: jest.fn(),
    createSync: jest.fn(),
    restore: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    get: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  }),
}));

jest.unstable_mockModule('../../../api/namespaces/records', () => ({
  get: jest.fn(),
  query: jest.fn(),
  getFieldValue: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  del: jest.fn(),
}));

const { DocumentFactory } = await import('../../../api/document/document-factory');

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('IndexedDB version provider document/workbook lifecycle', () => {
  it('requires explicit IndexedDB selection and reloads committed state through a fresh provider instance', async () => {
    const documentId = 'vc04-lifecycle-reload';
    const documentScope: VersionDocumentScope = { documentId };
    const graphId = 'graph-lifecycle-reload';
    const root = await rootWrite('root', namespaceForDocumentScope(documentScope, graphId));

    const first = await openWorkbook(documentId, {
      providerSelection: {
        kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
        requireDurablePersistence: true,
        initialize: { graphId, rootWrite: root },
      },
      captureNormalCommit,
    });
    const initialHeadResult = await first.wb.version.getHead();
    expect(initialHeadResult).toMatchObject({
      ok: true,
      value: {
        id: expect.stringMatching(/^commit:sha256:[0-9a-f]{64}$/),
        refName: 'refs/heads/main',
      },
    });
    if (!initialHeadResult.ok) throw new Error(`expected head: ${initialHeadResult.error.code}`);
    const initialHead = initialHeadResult.value;

    const committedResult = await first.wb.version.commit({ message: 'normal lifecycle commit' });
    expect(committedResult).toMatchObject({
      ok: true,
      value: {
        id: expect.stringMatching(/^commit:sha256:[0-9a-f]{64}$/),
        parents: [initialHead.id],
      },
    });
    if (!committedResult.ok) throw new Error(`expected commit: ${committedResult.error.code}`);
    const committed = committedResult.value;
    expect(committed.id).not.toBe(initialHead.id);

    const reader = createIndexedDbVersionStoreProvider({ documentScope });
    const graph = await reader.openGraph(namespaceForDocumentScope(documentScope, graphId));
    const read = await graph.readCommit(committed.id);
    expect(read.status).toBe('success');
    if (read.status !== 'success') throw new Error('expected committed record to be readable');
    const snapshotRootRecord = await graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.snapshotRoot.v1',
      digest: read.commit.payload.snapshotRootDigest,
    });
    expect(snapshotRootRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      kind: YRS_FULL_STATE_SNAPSHOT_ROOT_KIND,
      encoding: 'base64',
      byteLength: FULL_STATE_BYTES.byteLength,
      source: YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE,
    });
    expect(Array.from(decodeWorkbookSnapshotRootRecord(snapshotRootRecord))).toEqual(
      Array.from(FULL_STATE_BYTES),
    );
    await reader.dispose();
    await first.handle.dispose();

    const reopened = await openWorkbook(documentId, {
      providerSelection: {
        kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
        requireDurablePersistence: true,
      },
      captureNormalCommit,
    });
    await expect(reopened.wb.version.getHead()).resolves.toMatchObject({
      ok: true,
      value: {
        id: committed.id,
        refName: 'refs/heads/main',
      },
    });
    await expect(reopened.wb.version.listCommits()).resolves.toMatchObject({
      ok: true,
      value: {
        items: expect.arrayContaining([
          expect.objectContaining({ id: committed.id }),
          expect.objectContaining({ id: initialHead.id }),
        ]),
      },
    });
    await reopened.handle.dispose();
  });

  it('does not silently attach IndexedDB when no explicit provider selection is supplied', async () => {
    const handle = await DocumentFactory.create({
      documentId: 'vc04-no-provider-selection',
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const wb = await handle.workbook({});

    await expect(wb.version.getHead()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
      },
    });

    await handle.dispose();
  });

  it('fails closed for corrupt and unsupported registries through wb.version reads', async () => {
    const documentId = 'vc04-lifecycle-corrupt';
    const documentScope: VersionDocumentScope = { documentId };
    const corrupt = await createVersionGraphRegistry({
      documentScope,
      graphId: 'graph-corrupt',
      rootCommitId: `commit:sha256:${'a'.repeat(64)}`,
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    await putRegistryEnvelope(documentScope, {
      schemaVersion: 1,
      registry: {
        ...corrupt,
        registryChecksum: { ...corrupt.registryChecksum, digest: '0'.repeat(64) },
      },
    });

    const corruptWorkbook = await openWorkbook(documentId, {
      providerSelection: { kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND },
      captureNormalCommit,
    });
    await expect(corruptWorkbook.wb.version.getHead()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_CORRUPT_REGISTRY' })],
      },
    });
    await expect(corruptWorkbook.wb.version.listCommits()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_CORRUPT_REGISTRY' })],
      },
    });
    await corruptWorkbook.handle.dispose();

    await deleteVersionStoreIndexedDbForTesting();
    await putRegistryEnvelope(documentScope, { schemaVersion: 99, registry: null });
    const unsupportedWorkbook = await openWorkbook(documentId, {
      providerSelection: { kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND },
      captureNormalCommit,
    });
    await expect(unsupportedWorkbook.wb.version.getHead()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_UNSUPPORTED_REGISTRY' })],
      },
    });
    await unsupportedWorkbook.handle.dispose();
  });

  it('surfaces graph reload corruption through wb.version reads without masking read-only writes', async () => {
    const documentId = 'vc04-lifecycle-reload-corrupt-row';
    const documentScope: VersionDocumentScope = { documentId };
    const graphId = 'graph-reload-corrupt-row';
    const root = await rootWrite('root', namespaceForDocumentScope(documentScope, graphId));

    const writable = await openWorkbook(documentId, {
      providerSelection: {
        kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
        initialize: { graphId, rootWrite: root },
      },
      captureNormalCommit,
    });
    await writable.handle.dispose();

    await updateFirstByNamespace(
      OBJECTS_STORE,
      namespaceForDocumentScope(documentScope, graphId),
      (row) => ({
        ...row,
        schemaVersion: 99,
      }),
    );

    const reopened = await openWorkbook(documentId, {
      providerSelection: { kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND },
      captureNormalCommit,
    });
    await expect(reopened.wb.version.getHead()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_OBJECT_STORE_FAILURE' })],
      },
    });
    await reopened.handle.dispose();

    const readOnly = await openWorkbook(documentId, {
      providerSelection: {
        kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
        readOnly: true,
      },
      captureNormalCommit,
    });
    await expect(readOnly.wb.version.commit({ message: 'blocked' })).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_STORE_READ_ONLY' })],
      },
    });
    await readOnly.handle.dispose();
  });

  it('rejects read-only provider writes with VERSION_STORE_READ_ONLY while preserving reads', async () => {
    const documentId = 'vc04-lifecycle-readonly';
    const documentScope: VersionDocumentScope = { documentId };
    const graphId = 'graph-readonly';
    const root = await rootWrite('root', namespaceForDocumentScope(documentScope, graphId));

    const writable = await openWorkbook(documentId, {
      providerSelection: {
        kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
        initialize: { graphId, rootWrite: root },
      },
      captureNormalCommit,
    });
    const headResult = await writable.wb.version.getHead();
    if (!headResult.ok) throw new Error(`expected writable head: ${headResult.error.code}`);
    const head = headResult.value;
    await writable.handle.dispose();

    const readOnly = await openWorkbook(documentId, {
      providerSelection: {
        kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
        readOnly: true,
      },
      captureNormalCommit,
    });
    await expect(readOnly.wb.version.getHead()).resolves.toMatchObject({
      ok: true,
      value: {
        id: head.id,
        refName: 'refs/heads/main',
      },
    });
    await expect(readOnly.wb.version.commit({ message: 'blocked' })).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_STORE_READ_ONLY' })],
      },
    });
    await readOnly.handle.dispose();
  });

  it('fails closed when a concrete provider belongs to a different document namespace', async () => {
    const provider = createIndexedDbVersionStoreProvider({
      documentScope: { documentId: 'vc04-other-document' },
    });
    const handle = await DocumentFactory.create({
      documentId: 'vc04-provider-mismatch',
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });

    await expect(wb.version.getHead()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_WRONG_NAMESPACE' })],
      },
    });
    await expect(wb.version.commit({ message: 'blocked' })).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_WRONG_NAMESPACE' })],
      },
    });

    await handle.dispose();
  });
});

type LifecycleVersioningConfig = Parameters<
  Awaited<ReturnType<typeof DocumentFactory.create>>['workbook']
>[0]['versioning'];

async function openWorkbook(
  documentId: string,
  versioning: NonNullable<LifecycleVersioningConfig>,
) {
  const handle = await DocumentFactory.create({
    documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  const wb = await handle.workbook({ versioning: withVersionManifest(versioning) });
  return { handle, wb };
}

const captureNormalCommit: VersionNormalCommitCapture = async ({ namespace, options }) => {
  const label = options.message ?? 'normal commit';
  return {
    status: 'success',
    input: {
      ...(await rootWrite(label, namespace)),
      mutationSegmentRecords: [
        await objectRecord('workbook.mutationSegment.v1', { label, operations: [] }, namespace),
      ],
    },
  };
};

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

async function putRegistryEnvelope(
  documentScope: VersionDocumentScope,
  value: unknown,
): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(REGISTRIES_STORE, 'readwrite');
  tx.objectStore(REGISTRIES_STORE).put(value, versionDocumentScopeKey(documentScope));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('registry put failed'));
    tx.onabort = () => reject(tx.error ?? new Error('registry put aborted'));
  });
  db.close();
}

async function updateFirstByNamespace(
  storeName: string,
  namespace: VersionGraphNamespace,
  mutate: (row: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(storeName, 'readwrite');
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`${storeName} transaction failed`));
    tx.onabort = () => reject(tx.error ?? new Error(`${storeName} transaction aborted`));
  });
  const request = tx
    .objectStore(storeName)
    .index('namespaceKey')
    .openCursor(IDBKeyRange.only(versionGraphNamespaceKey(namespace)));
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        reject(new Error(`No ${storeName} row found for namespace.`));
        return;
      }
      const update = cursor.update(mutate(asRecord(cursor.value)));
      update.onsuccess = () => resolve();
      update.onerror = () => reject(update.error ?? new Error(`${storeName} update failed`));
    };
    request.onerror = () => reject(request.error ?? new Error(`${storeName} cursor failed`));
  });
  await done;
  db.close();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error('IndexedDB row is not an object.');
}
