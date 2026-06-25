import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from '../graph';
import { mergeApplyRefCasProofStorageKey } from '../merge-apply-intent-store';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from '../object-store';
import {
  INDEX_MANIFESTS_STORE,
  INTENTS_STORE,
  REFS_STORE,
  SYMBOLIC_REFS_STORE,
  VERSION_STORE_INDEXEDDB_STORES,
} from '../provider-indexeddb-schema';
import { normalizeVersionDocumentScope, versionDocumentScopeKey } from '../registry';
import { refVersionsEqual } from '../refs/ref-store';
import { idbRequest, idbTransactionDone, readAllByIndex } from './internal-idb';
import { cloneJson } from './internal-json';
import { refKey } from './internal-keys';
import type {
  StoredIndexManifest,
  StoredIntent,
  StoredRefCasProofIntent,
  StoredRefRecord,
  StoredSymbolicRef,
} from './internal-records';
import { liveMainFromSnapshot } from './internal-snapshots';
import {
  RefAlreadyExistsError,
  RefCasConflictError,
  RefStoreManifestConflictError,
} from './internal-persistence-errors';
import { writeObjectRecords } from './internal-persistence-objects';
import {
  refCasProofRowForMode,
  refWritePlanForMode,
  type RefWritePlan,
} from './internal-persistence-refs';
import type { PersistGraphSnapshotOptions } from './internal-persistence-types';

export async function persistGraphSnapshot(options: PersistGraphSnapshotOptions): Promise<void> {
  const namespace = normalizeVersionGraphNamespace(options.snapshot.namespace);
  const namespaceKey = versionGraphNamespaceKey(namespace);
  const documentScopeKey = versionDocumentScopeKey(
    normalizeVersionDocumentScope(options.documentScope),
  );
  const refCasProofRow = await refCasProofRowForMode({
    namespaceKey,
    documentScopeKey,
    snapshot: options.snapshot,
    mode: options.mode,
  });
  const tx = options.db.transaction(VERSION_STORE_INDEXEDDB_STORES, 'readwrite');

  if (options.mode.kind === 'commit' || options.mode.kind === 'deleteBranch') {
    const currentRef = await idbRequest<StoredRefRecord | undefined>(
      tx.objectStore(REFS_STORE).get(refKey(namespaceKey, options.mode.targetRefName)),
    );
    const actual = currentRef?.record;
    if (
      !actual ||
      actual.state !== 'live' ||
      (options.mode.expectedHeadCommitId !== undefined &&
        actual.targetCommitId !== options.mode.expectedHeadCommitId) ||
      !refVersionsEqual(actual.refVersion, options.mode.expectedRefVersion)
    ) {
      tx.abort();
      throw new RefCasConflictError({
        ...(options.mode.expectedHeadCommitId === undefined
          ? {}
          : { expectedHead: options.mode.expectedHeadCommitId }),
        expectedRefVersion: options.mode.expectedRefVersion,
        ...(actual?.state === 'live'
          ? { actualHead: actual.targetCommitId }
          : actual?.state === 'tombstone'
            ? { actualHead: actual.previousTargetCommitId }
            : {}),
        ...(actual?.refVersion === undefined ? {} : { actualRefVersion: actual.refVersion }),
        actualRefState: actual?.state ?? 'missing',
      });
    }
  }
  if (options.mode.kind === 'createBranch') {
    const currentRef = await idbRequest<StoredRefRecord | undefined>(
      tx.objectStore(REFS_STORE).get(refKey(namespaceKey, options.mode.targetRefName)),
    );
    if (currentRef !== undefined) {
      tx.abort();
      throw new RefAlreadyExistsError(options.mode.targetRefName);
    }
    const manifest = await idbRequest<StoredIndexManifest | undefined>(
      tx.objectStore(INDEX_MANIFESTS_STORE).get(namespaceKey),
    );
    if (manifest?.refStoreNextGeneratedId !== options.mode.expectedRefStoreNextGeneratedId) {
      tx.abort();
      throw new RefStoreManifestConflictError({
        expectedRefStoreNextGeneratedId: options.mode.expectedRefStoreNextGeneratedId,
        actualRefStoreNextGeneratedId: manifest?.refStoreNextGeneratedId ?? null,
      });
    }
  }
  if (options.mode.kind === 'deleteBranch') {
    const manifest = await idbRequest<StoredIndexManifest | undefined>(
      tx.objectStore(INDEX_MANIFESTS_STORE).get(namespaceKey),
    );
    const actualLiveRefCount =
      manifest === undefined
        ? null
        : typeof manifest.refStoreLiveRefCount === 'number'
          ? manifest.refStoreLiveRefCount
          : (
              await readAllByIndex<StoredRefRecord>(
                tx.objectStore(REFS_STORE),
                'namespaceKey',
                namespaceKey,
              )
            ).filter((row) => row.record.state === 'live').length;
    if (actualLiveRefCount !== options.mode.expectedRefStoreLiveRefCount) {
      tx.abort();
      throw new RefStoreManifestConflictError({
        expectedRefStoreLiveRefCount: options.mode.expectedRefStoreLiveRefCount,
        actualRefStoreLiveRefCount: actualLiveRefCount,
      });
    }
  }

  writeSnapshotStores(tx, {
    namespace,
    namespaceKey,
    documentScopeKey,
    snapshot: options.snapshot,
    refWritePlan: refWritePlanForMode(options.mode),
    refCasProofRow,
  });
  await idbTransactionDone(tx);
}

function writeSnapshotStores(
  tx: IDBTransaction,
  options: {
    readonly namespace: VersionGraphNamespace;
    readonly namespaceKey: string;
    readonly documentScopeKey: string;
    readonly snapshot: PersistGraphSnapshotOptions['snapshot'];
    readonly refWritePlan: RefWritePlan;
    readonly refCasProofRow: StoredRefCasProofIntent | null;
  },
): void {
  const refStore = tx.objectStore(REFS_STORE);
  const symbolicRefStore = tx.objectStore(SYMBOLIC_REFS_STORE);
  const manifestStore = tx.objectStore(INDEX_MANIFESTS_STORE);
  const intentStore = tx.objectStore(INTENTS_STORE);

  writeObjectRecords(tx, {
    namespaceKey: options.namespaceKey,
    documentScopeKey: options.documentScopeKey,
    records: options.snapshot.objectRecords,
  });

  const selectedRefNames =
    options.refWritePlan.kind === 'selected' ? new Set(options.refWritePlan.refNames) : null;
  for (const record of options.snapshot.refStore.records) {
    if (selectedRefNames !== null && !selectedRefNames.has(record.name)) continue;
    refStore.put(
      {
        schemaVersion: 1,
        namespaceKey: options.namespaceKey,
        documentScopeKey: options.documentScopeKey,
        record: cloneJson(record),
      } satisfies StoredRefRecord,
      refKey(options.namespaceKey, record.name),
    );
  }

  if (options.refWritePlan.kind === 'all' || options.refWritePlan.writeSymbolicHead) {
    const main = liveMainFromSnapshot(options.snapshot);
    symbolicRefStore.put(
      {
        schemaVersion: 1,
        namespaceKey: options.namespaceKey,
        documentScopeKey: options.documentScopeKey,
        ref: {
          name: VERSION_GRAPH_HEAD_REF,
          target: VERSION_GRAPH_MAIN_REF,
          revision: cloneJson(main.refVersion),
        },
      } satisfies StoredSymbolicRef,
      refKey(options.namespaceKey, VERSION_GRAPH_HEAD_REF),
    );
  }

  if (options.refWritePlan.kind === 'all' || options.refWritePlan.writeManifest) {
    manifestStore.put(
      {
        schemaVersion: 1,
        namespaceKey: options.namespaceKey,
        documentScopeKey: options.documentScopeKey,
        namespace: cloneJson(options.namespace),
        refStoreNextGeneratedId: options.snapshot.refStore.nextGeneratedId,
        refStoreLiveRefCount:
          options.snapshot.refStore.liveRefCount ??
          options.snapshot.refStore.records.filter((record) => record.state === 'live').length,
        updatedAt: new Date().toISOString(),
      } satisfies StoredIndexManifest,
      options.namespaceKey,
    );
  }
  intentStore.put(
    {
      schemaVersion: 1,
      namespaceKey: options.namespaceKey,
      documentScopeKey: options.documentScopeKey,
      operation: 'graph-snapshot-write',
      recordedAt: new Date().toISOString(),
    } satisfies StoredIntent,
    `${options.namespaceKey}\u0000${Date.now()}\u0000${Math.random().toString(16).slice(2)}`,
  );
  if (options.refCasProofRow) {
    intentStore.put(
      cloneJson(options.refCasProofRow),
      mergeApplyRefCasProofStorageKey(options.namespace, options.refCasProofRow.lookup),
    );
  }
}
