import type { VersionMainRefName } from '@mog-sdk/contracts/api';

import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from '../graph';
import {
  createMergePreviewArtifactRecord,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  resolvedMergeAttemptArtifactRef,
} from '../merge-attempt-artifacts';
import { versionGraphNamespaceKey } from '../object-store';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import {
  INDEX_MANIFESTS_STORE,
  REFS_STORE,
  SYMBOLIC_REFS_STORE,
} from '../provider-indexeddb-schema';
import { namespaceForDocumentScope } from '../provider';
import {
  AUTHOR,
  DOCUMENT_SCOPE,
  expectGraphSuccess,
  expectInitializeSuccess,
  expectReadRefSuccess,
  initializeInput,
  readRecord,
  refKey,
  rootWrite,
} from './graph-store-snapshot-provider-test-utils';

export function registerGraphStoreSnapshotProviderPersistenceScenarios(): void {
  it('persists and reloads standalone artifacts, branch manifests, tombstones, and symbolic HEAD', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-provider'));
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-provider');
    const graph = await provider.openGraph(namespace);

    const mainCommit = await graph.commit({
      ...(await rootWrite('main-child', namespace)),
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
      parentCommitIds: [initialized.rootCommit.id],
    });
    expectGraphSuccess(mainCommit);

    const liveBranch = await graph.createBranch({
      name: 'scenario/provider-live',
      targetCommitId: initialized.rootCommit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(liveBranch.ok).toBe(true);
    if (!liveBranch.ok) throw new Error('expected provider live branch create success');
    const liveCommit = await graph.commit({
      ...(await rootWrite('live-branch-child', namespace)),
      targetRef: 'refs/heads/scenario/provider-live',
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedTargetRefVersion: liveBranch.branch.ref.refVersion,
      parentCommitIds: [initialized.rootCommit.id],
    });
    expectGraphSuccess(liveCommit);

    const deletedBranch = await graph.createBranch({
      name: 'scenario/provider-deleted',
      targetCommitId: initialized.rootCommit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(deletedBranch.ok).toBe(true);
    if (!deletedBranch.ok) throw new Error('expected provider deleted branch create success');
    await expect(
      graph.deleteBranch({
        name: 'scenario/provider-deleted',
        expectedHead: initialized.rootCommit.id,
        expectedRefVersion: deletedBranch.branch.ref.refVersion,
        deletedBy: AUTHOR,
        deleteReason: 'provider-snapshot-test',
      }),
    ).resolves.toMatchObject({ ok: true });

    const preview = await createMergePreviewArtifactRecord(namespace, {
      status: 'clean',
      base: initialized.rootCommit.id,
      ours: mainCommit.commit.id,
      theirs: liveCommit.commit.id,
    });
    const resolutionSet = await createMergeResolutionSetArtifactRecord(namespace);
    const resolved = await createResolvedMergeAttemptArtifactRecord(namespace, {
      resultDigest: preview.digest,
      resolutionSetDigest: resolutionSet.digest,
      targetRef: VERSION_GRAPH_MAIN_REF as VersionMainRefName,
      expectedTargetHead: {
        commitId: mainCommit.commit.id,
        revision: mainCommit.main.revision,
      },
    });
    await expect(graph.putObjects([resolved, resolutionSet, preview])).resolves.toMatchObject({
      status: 'success',
    });

    const namespaceKey = versionGraphNamespaceKey(namespace);
    const manifest = await readRecord(INDEX_MANIFESTS_STORE, namespaceKey);
    expect(manifest).toMatchObject({
      refStoreLiveRefCount: 2,
      refStoreNextGeneratedId: expect.any(Number),
    });
    const symbolicHead = await readRecord(
      SYMBOLIC_REFS_STORE,
      refKey(namespaceKey, VERSION_GRAPH_HEAD_REF),
    );
    expect(symbolicHead).toMatchObject({
      ref: {
        name: VERSION_GRAPH_HEAD_REF,
        target: VERSION_GRAPH_MAIN_REF,
        revision: mainCommit.main.revision,
      },
    });
    await expect(
      readRecord(REFS_STORE, refKey(namespaceKey, 'scenario/provider-deleted')),
    ).resolves.toMatchObject({
      record: {
        state: 'tombstone',
        previousTargetCommitId: initialized.rootCommit.id,
        deleteReason: 'provider-snapshot-test',
      },
    });

    await provider.close('test-teardown');
    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloaded = await reloadedProvider.openGraph(namespace);
    const symbolic = await reloaded.readRef(VERSION_GRAPH_HEAD_REF);
    expectReadRefSuccess(symbolic);
    expect(symbolic.ref).toMatchObject({
      target: VERSION_GRAPH_MAIN_REF,
      revision: mainCommit.main.revision,
    });
    await expect(
      reloaded.getObjectRecord(resolvedMergeAttemptArtifactRef(resolved.digest)),
    ).resolves.toMatchObject({
      preimage: {
        objectType: 'workbook.resolvedMergeAttempt.v1',
        payload: {
          resultDigest: preview.digest,
          resolutionSetDigest: resolutionSet.digest,
        },
      },
    });
    await expect(
      reloaded.createBranch({
        name: 'scenario/provider-deleted',
        targetCommitId: initialized.rootCommit.id,
        expectedAbsent: true,
        createdBy: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'refTombstoned' },
    });
  });
}
