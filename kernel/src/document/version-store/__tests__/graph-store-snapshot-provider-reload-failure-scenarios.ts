import type { VersionMainRefName } from '@mog-sdk/contracts/api';

import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from '../graph';
import {
  createMergePreviewArtifactRecord,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
} from '../merge-attempt-artifacts';
import { versionGraphNamespaceKey } from '../object-store';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import {
  INDEX_MANIFESTS_STORE,
  OBJECTS_STORE,
  SYMBOLIC_REFS_STORE,
} from '../provider-indexeddb-schema';
import { namespaceForDocumentScope } from '../provider';
import {
  AUTHOR,
  DOCUMENT_SCOPE,
  SECRET_DOCUMENT_SCOPE,
  deleteStoreRecord,
  expectGraphSuccess,
  expectInitializeSuccess,
  expectReloadErrorRedactsSecretScope,
  initializeInput,
  objectKey,
  refKey,
  rootWrite,
  updateStoreRecord,
} from './graph-store-snapshot-provider-test-utils';

export function registerGraphStoreSnapshotProviderReloadFailureScenarios(): void {
  it('fails closed when symbolic HEAD is missing and redacts namespace details', async () => {
    const provider = createIndexedDbVersionStoreProvider({
      documentScope: SECRET_DOCUMENT_SCOPE,
    });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-secret', SECRET_DOCUMENT_SCOPE),
    );
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(SECRET_DOCUMENT_SCOPE, 'graph-secret');
    const namespaceKey = versionGraphNamespaceKey(namespace);
    await deleteStoreRecord(SYMBOLIC_REFS_STORE, refKey(namespaceKey, VERSION_GRAPH_HEAD_REF));

    const reloadedProvider = createIndexedDbVersionStoreProvider({
      documentScope: SECRET_DOCUMENT_SCOPE,
    });
    await expect(reloadedProvider.openGraph(namespace)).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'VERSION_OBJECT_STORE_FAILURE',
        operation: 'openGraph',
        details: expect.objectContaining({
          reloadIssue: 'corrupt',
          store: SYMBOLIC_REFS_STORE,
        }),
      }),
    });
    await expectReloadErrorRedactsSecretScope(
      reloadedProvider.openGraph(namespace),
      SECRET_DOCUMENT_SCOPE,
      namespace,
    );
  });

  it('fails closed on stale branch manifest counters during reload', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-stale-manifest'),
    );
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-stale-manifest');
    const graph = await provider.openGraph(namespace);
    await expect(
      graph.createBranch({
        name: 'scenario/manifest-live',
        targetCommitId: initialized.rootCommit.id,
        expectedAbsent: true,
        createdBy: AUTHOR,
      }),
    ).resolves.toMatchObject({ ok: true });
    await updateStoreRecord(INDEX_MANIFESTS_STORE, versionGraphNamespaceKey(namespace), (row) => ({
      ...row,
      refStoreLiveRefCount: 999,
    }));

    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    await expect(reloadedProvider.openGraph(namespace)).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'VERSION_OBJECT_STORE_FAILURE',
        operation: 'openGraph',
        details: expect.objectContaining({
          reloadIssue: 'corrupt',
          store: INDEX_MANIFESTS_STORE,
          path: 'refStoreLiveRefCount',
        }),
      }),
    });
  });

  it('fails closed when reloaded standalone artifacts have missing dependencies', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-missing-dep'));
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-missing-dep');
    const graph = await provider.openGraph(namespace);
    const mainCommit = await graph.commit({
      ...(await rootWrite('missing-dep-main', namespace)),
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
      parentCommitIds: [initialized.rootCommit.id],
    });
    expectGraphSuccess(mainCommit);
    const secondCommit = await graph.commit({
      ...(await rootWrite('missing-dep-second', namespace)),
      expectedHeadCommitId: mainCommit.commit.id,
      expectedMainRefVersion: mainCommit.main.revision,
      parentCommitIds: [mainCommit.commit.id],
    });
    expectGraphSuccess(secondCommit);

    const preview = await createMergePreviewArtifactRecord(namespace, {
      status: 'clean',
      base: initialized.rootCommit.id,
      ours: mainCommit.commit.id,
      theirs: secondCommit.commit.id,
    });
    const resolutionSet = await createMergeResolutionSetArtifactRecord(namespace);
    const resolved = await createResolvedMergeAttemptArtifactRecord(namespace, {
      resultDigest: preview.digest,
      resolutionSetDigest: resolutionSet.digest,
      targetRef: VERSION_GRAPH_MAIN_REF as VersionMainRefName,
      expectedTargetHead: {
        commitId: secondCommit.commit.id,
        revision: secondCommit.main.revision,
      },
    });
    await expect(graph.putObjects([resolved, resolutionSet, preview])).resolves.toMatchObject({
      status: 'success',
    });
    await deleteStoreRecord(
      OBJECTS_STORE,
      objectKey(versionGraphNamespaceKey(namespace), resolutionSet),
    );

    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    await expect(reloadedProvider.openGraph(namespace)).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'VERSION_MISSING_DEPENDENCY',
        operation: 'openGraph',
        details: expect.objectContaining({
          reloadIssue: 'missing-dependency',
          store: OBJECTS_STORE,
        }),
      }),
    });
  });
}
