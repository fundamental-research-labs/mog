import {
  AUTHOR,
  DOCUMENT_SCOPE,
  VERSION_GRAPH_MAIN_REF,
  copyMainRefToBranch,
  createIndexedDbVersionStoreProvider,
  expectInitializeSuccess,
  expectReadHeadSuccess,
  initializeInput,
  namespaceForDocumentScope,
  rootWrite,
} from './provider-indexeddb-graph-writes-test-utils';

export function registerIndexedDbGraphCommitBranchScenarios(): void {
  it('persists target branch commits with branch-scoped CAS', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-branch-cas'));
    expectInitializeSuccess(initialized);

    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-branch-cas');
    await copyMainRefToBranch(namespace, 'scenario/idb-branch');
    const left = await provider.openGraph(namespace);
    const right = await provider.openGraph(namespace);
    const leftBranch = await left.readRef('refs/heads/scenario/idb-branch');
    expect(leftBranch.status).toBe('success');
    if (leftBranch.status !== 'success' || !('commitId' in leftBranch.ref)) {
      throw new Error('expected readable branch ref');
    }

    const leftCommit = await left.commit({
      ...(await rootWrite('left-branch', namespace)),
      targetRef: 'refs/heads/scenario/idb-branch',
      expectedHeadCommitId: leftBranch.ref.commitId,
      expectedTargetRefVersion: leftBranch.ref.revision,
      parentCommitIds: [leftBranch.ref.commitId],
    });
    expect(leftCommit.status).toBe('success');

    const staleCommit = await right.commit({
      ...(await rootWrite('right-branch', namespace)),
      targetRef: 'refs/heads/scenario/idb-branch',
      expectedHeadCommitId: leftBranch.ref.commitId,
      expectedTargetRefVersion: leftBranch.ref.revision,
      parentCommitIds: [leftBranch.ref.commitId],
    });
    expect(staleCommit).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_REF_CONFLICT',
          refName: 'refs/heads/scenario/idb-branch',
        }),
      ],
    });

    const reloaded = await provider.openGraph(namespace);
    await expect(reloaded.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      status: 'success',
      ref: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
      },
    });
    await expect(reloaded.readRef('refs/heads/scenario/idb-branch')).resolves.toMatchObject({
      status: 'success',
      ref: {
        commitId: leftCommit.status === 'success' ? leftCommit.commit.id : undefined,
        revision: { kind: 'counter', value: '1' },
      },
    });
  });

  it('preserves a concurrently advanced main ref when persisting branch commits', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-branch-isolation'),
    );
    expectInitializeSuccess(initialized);

    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-branch-isolation');
    const bootstrap = await provider.openGraph(namespace);
    const createdBranch = await bootstrap.createBranch({
      name: 'scenario/idb-branch-isolation',
      targetCommitId: initialized.rootCommit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(createdBranch.ok).toBe(true);
    if (!createdBranch.ok) throw new Error('expected branch create success');

    const left = await provider.openGraph(namespace);
    const right = await provider.openGraph(namespace);
    const leftHead = await left.readHead();
    const rightBranch = await right.readBranch({ name: 'scenario/idb-branch-isolation' });
    expectReadHeadSuccess(leftHead);
    expect(rightBranch.ok).toBe(true);
    if (!rightBranch.ok || rightBranch.branch === null) {
      throw new Error('expected readable branch ref');
    }

    const leftCommit = await left.commit({
      ...(await rootWrite('main-advanced', namespace)),
      expectedHeadCommitId: leftHead.head.id,
      expectedMainRefVersion: leftHead.main.revision,
      parentCommitIds: [leftHead.head.id],
    });
    expect(leftCommit.status).toBe('success');
    if (leftCommit.status !== 'success') throw new Error('expected main commit success');

    const rightCommit = await right.commit({
      ...(await rootWrite('branch-advanced', namespace)),
      targetRef: 'refs/heads/scenario/idb-branch-isolation',
      expectedHeadCommitId: rightBranch.branch.ref.targetCommitId,
      expectedTargetRefVersion: rightBranch.branch.ref.refVersion,
      parentCommitIds: [rightBranch.branch.ref.targetCommitId],
    });
    expect(rightCommit.status).toBe('success');
    if (rightCommit.status !== 'success') throw new Error('expected branch commit success');

    const reloaded = await provider.openGraph(namespace);
    await expect(reloaded.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      status: 'success',
      ref: {
        commitId: leftCommit.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });
    await expect(
      reloaded.readRef('refs/heads/scenario/idb-branch-isolation'),
    ).resolves.toMatchObject({
      status: 'success',
      ref: {
        commitId: rightCommit.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });
  });
}
