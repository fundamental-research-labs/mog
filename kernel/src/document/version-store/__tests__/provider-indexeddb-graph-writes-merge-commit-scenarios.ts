import {
  DOCUMENT_SCOPE,
  VERSION_GRAPH_MAIN_REF,
  copyMainRefToBranch,
  createIndexedDbVersionStoreProvider,
  expectInitializeSuccess,
  expectReadHeadSuccess,
  initializeInput,
  namespaceForDocumentScope,
  objectDigestFromWorkbookCommitId,
  rootWrite,
} from './provider-indexeddb-graph-writes-test-utils';

export function registerIndexedDbGraphMergeCommitScenarios(): void {
  it('persists explicit two-parent merge commits with main-ref CAS', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-merge-cas'));
    expectInitializeSuccess(initialized);

    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-merge-cas');
    await copyMainRefToBranch(namespace, 'scenario/idb-merge-parent');
    const graph = await provider.openGraph(namespace);
    const head = await graph.readHead();
    const branch = await graph.readRef('refs/heads/scenario/idb-merge-parent');
    expectReadHeadSuccess(head);
    expect(branch.status).toBe('success');
    if (branch.status !== 'success' || !('commitId' in branch.ref)) {
      throw new Error('expected readable branch ref');
    }

    const ours = await graph.commit({
      ...(await rootWrite('merge-ours', namespace)),
      expectedHeadCommitId: head.head.id,
      expectedMainRefVersion: head.main.revision,
      parentCommitIds: [head.head.id],
    });
    expect(ours.status).toBe('success');
    if (ours.status !== 'success') throw new Error('expected ours commit success');

    const theirs = await graph.commit({
      ...(await rootWrite('merge-theirs', namespace)),
      targetRef: 'refs/heads/scenario/idb-merge-parent',
      expectedHeadCommitId: branch.ref.commitId,
      expectedTargetRefVersion: branch.ref.revision,
      parentCommitIds: [branch.ref.commitId],
    });
    expect(theirs.status).toBe('success');
    if (theirs.status !== 'success') throw new Error('expected theirs commit success');

    const merge = await graph.mergeCommit({
      ...(await rootWrite('merge-result', namespace)),
      expectedHeadCommitId: ours.commit.id,
      expectedMainRefVersion: ours.main.revision,
      mergeParentCommitId: theirs.commit.id,
    });
    expect(merge.status).toBe('success');
    if (merge.status !== 'success') throw new Error('expected merge commit success');
    expect(merge.commit.payload.parentCommitIds).toEqual([ours.commit.id, theirs.commit.id]);

    const stale = await graph.mergeCommit({
      ...(await rootWrite('merge-stale', namespace)),
      expectedHeadCommitId: ours.commit.id,
      expectedMainRefVersion: ours.main.revision,
      mergeParentCommitId: theirs.commit.id,
    });
    expect(stale).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ code: 'VERSION_REF_CONFLICT' })],
    });

    const reloaded = await provider.openGraph(namespace);
    const reloadedMerge = await reloaded.readCommit(merge.commit.id);
    expect(reloadedMerge).toMatchObject({
      status: 'success',
      commit: {
        payload: {
          parentCommitIds: [ours.commit.id, theirs.commit.id],
        },
      },
    });
    const intentStore = await provider.openMergeApplyIntentStore(namespace);
    await expect(
      intentStore.readRefCasProof({
        applyKind: 'mergeCommit',
        targetRef: VERSION_GRAPH_MAIN_REF,
        headBefore: ours.commit.id,
        headAfter: merge.commit.id,
      }),
    ).resolves.toMatchObject({
      status: 'found',
      proof: {
        schemaVersion: 1,
        applyKind: 'mergeCommit',
        commitMetadataDigest: objectDigestFromWorkbookCommitId(merge.commit.id),
      },
    });
    await expect(reloaded.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      status: 'success',
      ref: {
        commitId: merge.commit.id,
        revision: { kind: 'counter', value: '2' },
      },
    });
  });
}
