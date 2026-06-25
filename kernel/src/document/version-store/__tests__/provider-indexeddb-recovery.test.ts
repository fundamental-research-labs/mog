import {
  DOCUMENT_SCOPE,
  expectGraphWriteSuccess,
  expectInitializeSuccess,
  expectListCommitsSuccess,
  expectReadHeadSuccess,
  initializeInput,
  rootWrite,
  updateFirstByNamespace,
} from './provider-indexeddb-recovery-test-utils';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import { COMMIT_INDEXES_STORE, PARENT_INDEXES_STORE } from '../provider-indexeddb-schema';
import { namespaceForDocumentScope } from '../provider';

describe('IndexedDB provider recovery hardening: derived indexes', () => {
  it('recovers from corrupt derived object sidecars by reloading canonical object rows', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('sidecar-corrupt'));
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'sidecar-corrupt');
    const graph = await provider.openGraph(namespace);
    const committed = await graph.commit({
      ...(await rootWrite('child', namespace)),
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
      parentCommitIds: [initialized.rootCommit.id],
    });
    expectGraphWriteSuccess(committed);

    await updateFirstByNamespace(COMMIT_INDEXES_STORE, namespace, (row) => ({
      ...row,
      schemaVersion: 99,
    }));
    await updateFirstByNamespace(PARENT_INDEXES_STORE, namespace, (row) => ({
      ...row,
      schemaVersion: 99,
    }));
    await provider.close('test-teardown');

    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloaded = await reloadedProvider.openGraph(namespace);
    const head = await reloaded.readHead();
    expectReadHeadSuccess(head);
    expect(head.head.id).toBe(committed.commit.id);
    const listed = await reloaded.listCommits();
    expectListCommitsSuccess(listed);
    expect(listed.commits.map((commit) => commit.id)).toEqual([
      committed.commit.id,
      initialized.rootCommit.id,
    ]);
    await reloadedProvider.close('test-teardown');
  });
});
