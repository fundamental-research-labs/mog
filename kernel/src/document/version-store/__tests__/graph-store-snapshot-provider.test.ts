import 'fake-indexeddb/auto';

import type { VersionMainRefName } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  type VersionGraphReadRefResult,
  type VersionGraphWriteResult,
} from '../graph-store';
import {
  createMergePreviewArtifactRecord,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  resolvedMergeAttemptArtifactRef,
} from '../merge-attempt-artifacts';
import type { VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb-backend';
import {
  INDEX_MANIFESTS_STORE,
  OBJECTS_STORE,
  REFS_STORE,
  SYMBOLIC_REFS_STORE,
  deleteVersionStoreIndexedDbForTesting,
  openVersionStoreIndexedDb,
} from '../provider-indexeddb-schema';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-snapshot-provider',
  documentId: 'document-snapshot-provider',
  principalScope: 'principal-snapshot-provider',
};

const SECRET_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-secret-redaction',
  documentId: 'document-secret-redaction',
  principalScope: 'principal-secret-redaction',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-snapshot-provider',
  actorKind: 'user',
  displayName: 'Snapshot Provider User',
};

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function expectGraphSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

function expectReadRefSuccess(
  result: VersionGraphReadRefResult,
): asserts result is Extract<VersionGraphReadRefResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readRef success: ${result.diagnostics[0]?.code}`);
  }
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

async function rootWrite(
  label: string,
  namespace: VersionGraphNamespace,
): Promise<VersionGraphInitializeInput['rootWrite']> {
  return {
    snapshotRootRecord: await objectRecord(
      'workbook.snapshotRoot.v1',
      { label, sheets: [] },
      namespace,
    ),
    semanticChangeSetRecord: await objectRecord(
      'workbook.semanticChangeSet.v1',
      { label, changes: [] },
      namespace,
    ),
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

describe('IndexedDB graph snapshot reload invariants', () => {
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
    await expect(readRecord(REFS_STORE, refKey(namespaceKey, 'scenario/provider-deleted'))).resolves
      .toMatchObject({
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
    await expect(reloaded.getObjectRecord(resolvedMergeAttemptArtifactRef(resolved.digest)))
      .resolves.toMatchObject({
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
    const initialized = await provider.initializeGraph(await initializeInput('graph-stale-manifest'));
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
});

async function initializeInput(
  graphId: string,
  scope: VersionDocumentScope = DOCUMENT_SCOPE,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(scope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await rootWrite('root', namespace),
  };
}

async function readRecord(storeName: string, key: IDBValidKey): Promise<Record<string, unknown>> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(storeName, 'readonly');
  const value = await requestValue(tx.objectStore(storeName).get(key));
  await transactionDone(tx, `${storeName} read transaction failed`);
  db.close();
  return asRecord(value);
}

async function updateStoreRecord(
  storeName: string,
  key: IDBValidKey,
  mutate: (row: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(storeName, 'readwrite');
  const done = transactionDone(tx, `${storeName} update transaction failed`);
  const store = tx.objectStore(storeName);
  const current = asRecord(await requestValue(store.get(key)));
  store.put(mutate(current), key);
  await done;
  db.close();
}

async function deleteStoreRecord(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(storeName, 'readwrite');
  const done = transactionDone(tx, `${storeName} delete transaction failed`);
  tx.objectStore(storeName).delete(key);
  await done;
  db.close();
}

async function expectReloadErrorRedactsSecretScope(
  promise: Promise<unknown>,
  scope: VersionDocumentScope,
  namespace: VersionGraphNamespace,
): Promise<void> {
  try {
    await promise;
    throw new Error('expected reload failure');
  } catch (error) {
    const serialized = JSON.stringify(error);
    for (const leakedValue of [
      ...Object.values(scope),
      ...Object.values(namespace),
      versionGraphNamespaceKey(namespace),
    ]) {
      expect(serialized).not.toContain(leakedValue);
    }
  }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(message));
    tx.onabort = () => reject(tx.error ?? new Error(message));
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error('IndexedDB row is not an object.');
}

function refKey(namespaceKey: string, name: string): string {
  return `${namespaceKey}\u0000${name}`;
}

function objectKey(namespaceKey: string, record: VersionObjectRecord<unknown>): string {
  return `${namespaceKey}\u0000${record.digest.algorithm}\u0000${record.digest.digest}`;
}
