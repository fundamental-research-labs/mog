import {
  DOCUMENT_SCOPE,
  expectGraphWriteSuccess,
  expectInitializeSuccess,
  expectReadHeadSuccess,
  initializeInput,
  namespaceCounts,
  rootWrite,
  storedRef,
} from './provider-indexeddb-recovery-test-utils';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import { namespaceForDocumentScope } from '../provider';

describe('IndexedDB provider recovery hardening: stale heads', () => {
  it('rejects stale expected-head commits across provider reload before object, index, or ref writes', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('stale-reload'));
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'stale-reload');
    await provider.close('test-teardown');

    const staleProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const staleGraph = await staleProvider.openGraph(namespace);
    const staleHead = await staleGraph.readHead();
    expectReadHeadSuccess(staleHead);

    const freshProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const freshGraph = await freshProvider.openGraph(namespace);
    const freshCommit = await freshGraph.commit({
      ...(await rootWrite('fresh', namespace)),
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
      parentCommitIds: [initialized.rootCommit.id],
    });
    expectGraphWriteSuccess(freshCommit);

    const countsBefore = await namespaceCounts(namespace);
    const mainRefBefore = await storedRef(namespace, 'main');
    const staleCommit = await staleGraph.commit({
      ...(await rootWrite('stale', namespace)),
      expectedHeadCommitId: staleHead.head.id,
      expectedMainRefVersion: staleHead.main.revision,
      parentCommitIds: [staleHead.head.id],
    });

    expect(staleCommit).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_REF_CONFLICT',
          refName: 'refs/heads/main',
          commitId: freshCommit.commit.id,
          details: expect.objectContaining({
            expectedHead: initialized.rootCommit.id,
            actualHead: freshCommit.commit.id,
          }),
        }),
      ],
    });
    expect(await namespaceCounts(namespace)).toEqual(countsBefore);
    expect(await storedRef(namespace, 'main')).toEqual(mainRefBefore);

    await staleProvider.close('test-teardown');
    await freshProvider.close('test-teardown');
  });
});
