import {
  DOCUMENT_SCOPE,
  createIndexedDbVersionStoreProvider,
  expectInitializeSuccess,
  expectReadHeadSuccess,
  initializeInput,
  namespaceForDocumentScope,
  rootWrite,
} from './provider-indexeddb-graph-writes-test-utils';

export function registerIndexedDbGraphCommitMainRefScenarios(): void {
  it('enforces single-process ref CAS for stale graph commits', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-cas'));
    expectInitializeSuccess(initialized);

    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-cas');
    const left = await provider.openGraph(namespace);
    const right = await provider.openGraph(namespace);
    const leftHead = await left.readHead();
    const rightHead = await right.readHead();
    expectReadHeadSuccess(leftHead);
    expectReadHeadSuccess(rightHead);

    const leftCommit = await left.commit({
      ...(await rootWrite('left', namespace)),
      expectedHeadCommitId: leftHead.head.id,
      expectedMainRefVersion: leftHead.main.revision,
      parentCommitIds: [leftHead.head.id],
    });
    expect(leftCommit.status).toBe('success');

    const staleCommit = await right.commit({
      ...(await rootWrite('right', namespace)),
      expectedHeadCommitId: rightHead.head.id,
      expectedMainRefVersion: rightHead.main.revision,
      parentCommitIds: [rightHead.head.id],
    });
    expect(staleCommit).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ code: 'VERSION_REF_CONFLICT' })],
    });
  });
}
