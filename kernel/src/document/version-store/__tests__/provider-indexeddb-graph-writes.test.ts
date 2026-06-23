import 'fake-indexeddb/auto';

import { VERSION_GRAPH_MAIN_REF } from '../graph-store';
import {
  createMergePreviewArtifactRecord,
  mergePreviewArtifactRef,
} from '../merge-attempt-artifacts';
import { objectDigestFromWorkbookCommitId } from '../object-digest';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb-backend';
import { namespaceForDocumentScope } from '../provider';
import {
  AUTHOR,
  DOCUMENT_SCOPE,
  MISSING_COMMIT_ID,
  copyMainRefToBranch,
  expectInitializeSuccess,
  expectReadHeadSuccess,
  initializeInput,
  resetIndexedDbVersionStoreForTesting,
  rootWrite,
} from './provider-indexeddb-test-utils';

beforeEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});

afterEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});

describe('IndexedDbVersionStoreProvider graph writes', () => {
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

  it('persists standalone graph object batches across provider reopen without moving refs', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-object-batch'));
    expectInitializeSuccess(initialized);

    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-object-batch');
    const graph = await provider.openGraph(namespace);
    const ours = await graph.commit({
      ...(await rootWrite('object-batch-ours', namespace)),
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
      parentCommitIds: [initialized.rootCommit.id],
    });
    expect(ours.status).toBe('success');
    if (ours.status !== 'success') throw new Error('expected ours commit success');
    const theirs = await graph.commit({
      ...(await rootWrite('object-batch-theirs', namespace)),
      expectedHeadCommitId: ours.commit.id,
      expectedMainRefVersion: ours.main.revision,
      parentCommitIds: [ours.commit.id],
    });
    expect(theirs.status).toBe('success');
    if (theirs.status !== 'success') throw new Error('expected theirs commit success');
    const headBefore = await graph.readHead();
    expectReadHeadSuccess(headBefore);

    const preview = await createMergePreviewArtifactRecord(namespace, {
      status: 'clean',
      base: initialized.rootCommit.id,
      ours: ours.commit.id,
      theirs: theirs.commit.id,
    });
    const put = await graph.putObjects([preview]);
    expect(put).toMatchObject({ status: 'success', records: [preview] });

    const missingDependencyPreview = await createMergePreviewArtifactRecord(namespace, {
      status: 'clean',
      base: initialized.rootCommit.id,
      ours: ours.commit.id,
      theirs: MISSING_COMMIT_ID,
    });
    const rejected = await graph.putObjects([missingDependencyPreview]);
    expect(rejected).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-objects-written',
      diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_DEPENDENCY' })],
    });

    await provider.close('test-teardown');
    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloaded = await reloadedProvider.openGraph(namespace);
    await expect(reloaded.readHead()).resolves.toMatchObject({
      status: 'success',
      head: { id: headBefore.head.id },
      main: { commitId: headBefore.main.commitId, revision: headBefore.main.revision },
    });
    await expect(
      reloaded.getObjectRecord(mergePreviewArtifactRef(preview.digest)),
    ).resolves.toMatchObject({
      preimage: {
        objectType: 'workbook.mergePreview.v1',
        payload: { recordKind: 'mergePreview', status: 'clean' },
      },
    });
    await expect(
      reloaded.hasObject(mergePreviewArtifactRef(missingDependencyPreview.digest)),
    ).resolves.toBe(false);
  });
});
