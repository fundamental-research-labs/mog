import {
  captureNormalCommit,
  createLifecycleDocumentHandle,
  openLifecycleWorkbook,
  rootWrite,
} from './provider-indexeddb-lifecycle-test-utils';
import {
  createIndexedDbVersionStoreProvider,
  INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
} from '../provider-indexeddb/backend';
import { namespaceForDocumentScope, type VersionDocumentScope } from '../provider';

describe('IndexedDB version provider document/workbook lifecycle', () => {
  it('does not silently attach IndexedDB when no explicit provider selection is supplied', async () => {
    const handle = await createLifecycleDocumentHandle('vc04-no-provider-selection');
    const wb = await handle.workbook({});

    await expect(wb.version.getHead()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
      },
    });

    await handle.dispose();
  });

  it('rejects read-only provider writes with VERSION_STORE_READ_ONLY while preserving reads', async () => {
    const documentId = 'vc04-lifecycle-readonly';
    const documentScope: VersionDocumentScope = { documentId };
    const graphId = 'graph-readonly';
    const root = await rootWrite('root', namespaceForDocumentScope(documentScope, graphId));

    const writable = await openLifecycleWorkbook(documentId, {
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

    const readOnly = await openLifecycleWorkbook(documentId, {
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
    const opened = await openLifecycleWorkbook('vc04-provider-mismatch', { provider });

    await expect(opened.wb.version.getHead()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_WRONG_NAMESPACE' })],
      },
    });
    await expect(opened.wb.version.commit({ message: 'blocked' })).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_WRONG_NAMESPACE' })],
      },
    });

    await opened.handle.dispose();
  });
});
