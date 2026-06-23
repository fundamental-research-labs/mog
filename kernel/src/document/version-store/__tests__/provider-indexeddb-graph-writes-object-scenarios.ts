import {
  DOCUMENT_SCOPE,
  MISSING_COMMIT_ID,
  createIndexedDbVersionStoreProvider,
  createMergePreviewArtifactRecord,
  expectInitializeSuccess,
  expectReadHeadSuccess,
  initializeInput,
  mergePreviewArtifactRef,
  namespaceForDocumentScope,
  rootWrite,
} from './provider-indexeddb-graph-writes-test-utils';

export function registerIndexedDbGraphObjectScenarios(): void {
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
}
