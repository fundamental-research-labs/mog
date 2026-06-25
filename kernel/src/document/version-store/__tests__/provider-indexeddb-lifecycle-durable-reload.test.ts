import {
  captureNormalCommit,
  FULL_STATE_BYTES,
  openLifecycleWorkbook,
  rootWrite,
  updateFirstByNamespace,
} from './provider-indexeddb-lifecycle-test-utils';
import {
  createIndexedDbVersionStoreProvider,
  INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
} from '../provider-indexeddb/backend';
import { OBJECTS_STORE } from '../provider-indexeddb-schema';
import { namespaceForDocumentScope, type VersionDocumentScope } from '../provider';
import {
  decodeWorkbookSnapshotRootRecord,
  YRS_FULL_STATE_SNAPSHOT_ROOT_KIND,
  YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE,
} from '../snapshot-root-capture';

describe('IndexedDB version provider document/workbook lifecycle durable reload', () => {
  it('requires explicit IndexedDB selection and reloads committed state through a fresh provider instance', async () => {
    const documentId = 'vc04-lifecycle-reload';
    const documentScope: VersionDocumentScope = { documentId };
    const graphId = 'graph-lifecycle-reload';
    const root = await rootWrite('root', namespaceForDocumentScope(documentScope, graphId));

    const first = await openLifecycleWorkbook(documentId, {
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
        annotation: {
          message: { kind: 'text', value: 'normal lifecycle commit' },
        },
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

    const reopened = await openLifecycleWorkbook(documentId, {
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
          expect.objectContaining({
            id: committed.id,
            annotation: {
              message: { kind: 'text', value: 'normal lifecycle commit' },
            },
          }),
          expect.objectContaining({ id: initialHead.id }),
        ]),
      },
    });
    await reopened.handle.dispose();
  });

  it('surfaces graph reload corruption through wb.version reads without masking read-only writes', async () => {
    const documentId = 'vc04-lifecycle-reload-corrupt-row';
    const documentScope: VersionDocumentScope = { documentId };
    const graphId = 'graph-reload-corrupt-row';
    const root = await rootWrite('root', namespaceForDocumentScope(documentScope, graphId));

    const writable = await openLifecycleWorkbook(documentId, {
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

    const reopened = await openLifecycleWorkbook(documentId, {
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

    const readOnly = await openLifecycleWorkbook(documentId, {
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
});
