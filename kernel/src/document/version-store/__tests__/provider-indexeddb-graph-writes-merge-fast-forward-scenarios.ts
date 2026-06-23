import {
  AUTHOR,
  DOCUMENT_SCOPE,
  VERSION_GRAPH_MAIN_REF,
  copyMainRefToBranch,
  createIndexedDbVersionStoreProvider,
  expectInitializeSuccess,
  initializeInput,
  namespaceForDocumentScope,
  objectDigestFromWorkbookCommitId,
  rootWrite,
} from './provider-indexeddb-graph-writes-test-utils';

export function registerIndexedDbGraphMergeFastForwardScenarios(): void {
  it('persists graph fast-forward ref advances with main-ref CAS', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-fast-forward-cas'),
    );
    expectInitializeSuccess(initialized);

    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-fast-forward-cas');
    await copyMainRefToBranch(namespace, 'scenario/idb-fast-forward');
    const graph = await provider.openGraph(namespace);
    const branch = await graph.readRef('refs/heads/scenario/idb-fast-forward');
    expect(branch.status).toBe('success');
    if (branch.status !== 'success' || !('commitId' in branch.ref)) {
      throw new Error('expected readable branch ref');
    }

    const incoming = await graph.commit({
      ...(await rootWrite('fast-forward-incoming', namespace)),
      targetRef: 'refs/heads/scenario/idb-fast-forward',
      expectedHeadCommitId: branch.ref.commitId,
      expectedTargetRefVersion: branch.ref.revision,
      parentCommitIds: [branch.ref.commitId],
    });
    expect(incoming.status).toBe('success');
    if (incoming.status !== 'success') throw new Error('expected incoming commit success');

    const fastForward = await graph.fastForwardRef({
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
      nextCommitId: incoming.commit.id,
      updatedBy: AUTHOR,
    });
    expect(fastForward).toMatchObject({
      status: 'success',
      commit: { id: incoming.commit.id },
      main: {
        commitId: incoming.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });

    const reloaded = await provider.openGraph(namespace);
    await expect(reloaded.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      status: 'success',
      ref: {
        commitId: incoming.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });
    const reloadedCommit = await reloaded.readCommit(incoming.commit.id);
    expect(reloadedCommit).toMatchObject({
      status: 'success',
      commit: {
        payload: {
          parentCommitIds: [initialized.rootCommit.id],
        },
      },
    });
    const intentStore = await provider.openMergeApplyIntentStore(namespace);
    await expect(
      intentStore.readRefCasProof({
        applyKind: 'fastForward',
        targetRef: VERSION_GRAPH_MAIN_REF,
        headBefore: initialized.rootCommit.id,
        headAfter: incoming.commit.id,
      }),
    ).resolves.toMatchObject({
      status: 'found',
      proof: {
        schemaVersion: 1,
        applyKind: 'fastForward',
        commitMetadataDigest: objectDigestFromWorkbookCommitId(incoming.commit.id),
      },
    });
  });
}
