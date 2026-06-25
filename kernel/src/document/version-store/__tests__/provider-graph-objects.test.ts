import {
  createMergePreviewArtifactRecord,
  mergePreviewArtifactRef,
} from '../merge-attempt-artifacts';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../provider';
import {
  DOCUMENT_SCOPE,
  MISSING_COMMIT_ID,
  expectInitializeSuccess,
  initializeInput,
  rootWrite,
} from './provider-test-utils';

describe('InMemoryVersionStoreProvider graph registry', () => {
  it('puts standalone graph objects and preserves them through durable snapshots', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    const initialized = await provider.initializeGraph(await initializeInput('graph-objects'));
    expectInitializeSuccess(initialized);

    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-objects');
    const graph = await provider.openGraph(namespace);
    const ours = await graph.commit({
      ...(await rootWrite('objects-ours', namespace)),
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
      parentCommitIds: [initialized.rootCommit.id],
    });
    expect(ours.status).toBe('success');
    if (ours.status !== 'success') throw new Error('expected ours commit success');
    const theirs = await graph.commit({
      ...(await rootWrite('objects-theirs', namespace)),
      expectedHeadCommitId: ours.commit.id,
      expectedMainRefVersion: ours.main.revision,
      parentCommitIds: [ours.commit.id],
    });
    expect(theirs.status).toBe('success');
    if (theirs.status !== 'success') throw new Error('expected theirs commit success');

    const preview = await createMergePreviewArtifactRecord(namespace, {
      status: 'clean',
      base: initialized.rootCommit.id,
      ours: ours.commit.id,
      theirs: theirs.commit.id,
    });
    const put = await graph.putObjects([preview]);
    expect(put).toMatchObject({ status: 'success', records: [preview] });
    await expect(
      graph.getObjectRecord(mergePreviewArtifactRef(preview.digest)),
    ).resolves.toMatchObject({
      preimage: { payload: { recordKind: 'mergePreview', status: 'clean' } },
    });

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
    await expect(
      graph.hasObject(mergePreviewArtifactRef(missingDependencyPreview.digest)),
    ).resolves.toBe(false);

    const snapshot = await backend.exportSnapshot();
    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
    const reloadedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: reloadedBackend,
      durability: 'snapshot-test-double',
    });
    const reloadedGraph = await reloadedProvider.openGraph(namespace);
    await expect(
      reloadedGraph.getObjectRecord(mergePreviewArtifactRef(preview.digest)),
    ).resolves.toMatchObject({
      preimage: { payload: { base: initialized.rootCommit.id, ours: ours.commit.id } },
    });
    await expect(
      reloadedGraph.hasObject(mergePreviewArtifactRef(missingDependencyPreview.digest)),
    ).resolves.toBe(false);
  });
});
