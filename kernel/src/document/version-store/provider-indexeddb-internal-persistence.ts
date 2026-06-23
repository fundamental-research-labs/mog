import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from './graph-store';
import type { InMemoryVersionGraphStoreSnapshot } from './graph-store';
import {
  computeMergeApplyRefCasProof,
  mergeApplyRefCasProofStorageKey,
  type MergeApplyIntentApplyKind,
  type MergeApplyRefCasProofLookup,
} from './merge-apply-intent-store';
import { workbookCommitIdFromObjectDigest, type WorkbookCommitId } from './object-digest';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from './object-store';
import {
  COMMIT_INDEXES_STORE,
  INDEX_MANIFESTS_STORE,
  INTENTS_STORE,
  OBJECTS_STORE,
  PARENT_INDEXES_STORE,
  REFS_STORE,
  SYMBOLIC_REFS_STORE,
  VERSION_STORE_INDEXEDDB_STORES,
} from './provider-indexeddb-schema';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import { refVersionsEqual, type LiveRefRecord, type RefRecord, type RefVersion } from './ref-store';
import type { WorkbookCommitPayload } from './commit-store';
import { idbRequest, idbTransactionDone, readAllByIndex } from './provider-indexeddb-internal-idb';
import { cloneJson } from './provider-indexeddb-internal-json';
import {
  commitIndexKey,
  objectKey,
  parentIndexKey,
  parentLookupKey,
  refKey,
} from './provider-indexeddb-internal-keys';
import type {
  StoredCommitIndex,
  StoredIndexManifest,
  StoredIntent,
  StoredObjectRecord,
  StoredParentIndex,
  StoredRefCasProofIntent,
  StoredRefRecord,
  StoredSymbolicRef,
} from './provider-indexeddb-internal-records';
import { liveMainFromSnapshot } from './provider-indexeddb-internal-snapshots';

export class RefCasConflictError extends Error {
  readonly expectedHead?: WorkbookCommitId;
  readonly expectedRefVersion: RefVersion;
  readonly actualHead?: WorkbookCommitId;
  readonly actualRefVersion?: RefVersion;
  readonly actualRefState: 'missing' | RefRecord['state'];

  constructor(input: {
    readonly expectedHead?: WorkbookCommitId;
    readonly expectedRefVersion: RefVersion;
    readonly actualHead?: WorkbookCommitId;
    readonly actualRefVersion?: RefVersion;
    readonly actualRefState: 'missing' | RefRecord['state'];
  }) {
    super('IndexedDB version graph ref CAS conflict.');
    this.name = 'RefCasConflictError';
    this.expectedHead = input.expectedHead;
    this.expectedRefVersion = input.expectedRefVersion;
    this.actualHead = input.actualHead;
    this.actualRefVersion = input.actualRefVersion;
    this.actualRefState = input.actualRefState;
  }
}

export class RefAlreadyExistsError extends Error {
  readonly refName: string;

  constructor(refName: string) {
    super('IndexedDB version graph ref already exists.');
    this.name = 'RefAlreadyExistsError';
    this.refName = refName;
  }
}

export class RefStoreManifestConflictError extends Error {
  readonly expectedRefStoreNextGeneratedId?: number;
  readonly actualRefStoreNextGeneratedId?: number | null;
  readonly expectedRefStoreLiveRefCount?: number;
  readonly actualRefStoreLiveRefCount?: number | null;

  constructor(input: {
    readonly expectedRefStoreNextGeneratedId?: number;
    readonly actualRefStoreNextGeneratedId?: number | null;
    readonly expectedRefStoreLiveRefCount?: number;
    readonly actualRefStoreLiveRefCount?: number | null;
  }) {
    super('IndexedDB version graph ref manifest CAS conflict.');
    this.name = 'RefStoreManifestConflictError';
    Object.assign(this, input);
  }
}

export async function persistGraphSnapshot(options: {
  readonly db: IDBDatabase;
  readonly snapshot: InMemoryVersionGraphStoreSnapshot;
  readonly documentScope: VersionDocumentScope;
  readonly mode:
    | { readonly kind: 'initialize' }
    | {
        readonly kind: 'createBranch';
        readonly targetRefName: string;
        readonly expectedRefStoreNextGeneratedId: number;
      }
    | {
        readonly kind: 'commit';
        readonly targetRefName: string;
        readonly expectedHeadCommitId: WorkbookCommitId;
        readonly expectedRefVersion: RefVersion;
        readonly refCasProof?: {
          readonly applyKind: MergeApplyIntentApplyKind;
        };
      }
    | {
        readonly kind: 'deleteBranch';
        readonly targetRefName: string;
        readonly expectedHeadCommitId?: WorkbookCommitId;
        readonly expectedRefVersion: RefVersion;
        readonly expectedRefStoreLiveRefCount: number;
      };
}): Promise<void> {
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

export async function persistObjectRecords(options: {
  readonly db: IDBDatabase;
  readonly namespace: VersionGraphNamespace;
  readonly documentScope: VersionDocumentScope;
  readonly records: readonly VersionObjectRecord<unknown>[];
}): Promise<void> {
  const namespace = normalizeVersionGraphNamespace(options.namespace);
  const namespaceKey = versionGraphNamespaceKey(namespace);
  const documentScopeKey = versionDocumentScopeKey(
    normalizeVersionDocumentScope(options.documentScope),
  );
  const namespaceDocumentScopeKey = versionDocumentScopeKey(
    normalizeVersionDocumentScope({
      ...(namespace.workspaceId === undefined ? {} : { workspaceId: namespace.workspaceId }),
      documentId: namespace.documentId,
      ...(namespace.principalScope === undefined
        ? {}
        : { principalScope: namespace.principalScope }),
    }),
  );
  if (namespaceDocumentScopeKey !== documentScopeKey) {
    throw new Error(
      'IndexedDB object batch namespace does not match the requested document scope.',
    );
  }

  const tx = options.db.transaction(
    [OBJECTS_STORE, COMMIT_INDEXES_STORE, PARENT_INDEXES_STORE],
    'readwrite',
  );
  writeObjectRecords(tx, {
    namespaceKey,
    documentScopeKey,
    records: options.records,
  });
  await idbTransactionDone(tx);
}

type PersistGraphSnapshotMode = Parameters<typeof persistGraphSnapshot>[0]['mode'];

type RefWritePlan =
  | { readonly kind: 'all' }
  | {
      readonly kind: 'selected';
      readonly refNames: readonly string[];
      readonly writeSymbolicHead: boolean;
      readonly writeManifest: boolean;
    };

function refWritePlanForMode(mode: PersistGraphSnapshotMode): RefWritePlan {
  if (mode.kind === 'initialize') return { kind: 'all' };
  return {
    kind: 'selected',
    refNames: Object.freeze([mode.targetRefName]),
    writeSymbolicHead: mode.targetRefName === 'main',
    writeManifest: mode.kind === 'createBranch' || mode.kind === 'deleteBranch',
  };
}

async function refCasProofRowForMode(input: {
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly snapshot: InMemoryVersionGraphStoreSnapshot;
  readonly mode: PersistGraphSnapshotMode;
}): Promise<StoredRefCasProofIntent | null> {
  const mode = input.mode;
  if (mode.kind !== 'commit' || !mode.refCasProof) return null;
  const ref = input.snapshot.refStore.records.find(
    (candidate): candidate is LiveRefRecord =>
      candidate.state === 'live' && candidate.name === mode.targetRefName,
  );
  if (!ref) throw new Error('IndexedDB ref CAS proof target ref is missing from snapshot.');
  const lookup: MergeApplyRefCasProofLookup = {
    applyKind: mode.refCasProof.applyKind,
    targetRef: graphRefNameFromStorageRefName(mode.targetRefName),
    headBefore: mode.expectedHeadCommitId,
    headAfter: ref.targetCommitId,
  };
  return {
    schemaVersion: 1,
    namespaceKey: input.namespaceKey,
    documentScopeKey: input.documentScopeKey,
    operation: 'merge-ref-cas-proof',
    lookup,
    proof: await computeMergeApplyRefCasProof(lookup),
    recordedAt: new Date().toISOString(),
  };
}

function graphRefNameFromStorageRefName(name: string): MergeApplyRefCasProofLookup['targetRef'] {
  if (name === 'main') return VERSION_GRAPH_MAIN_REF;
  return `refs/heads/${name}` as MergeApplyRefCasProofLookup['targetRef'];
}

function writeSnapshotStores(
  tx: IDBTransaction,
  options: {
    readonly namespace: VersionGraphNamespace;
    readonly namespaceKey: string;
    readonly documentScopeKey: string;
    readonly snapshot: InMemoryVersionGraphStoreSnapshot;
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

function writeObjectRecords(
  tx: IDBTransaction,
  options: {
    readonly namespaceKey: string;
    readonly documentScopeKey: string;
    readonly records: readonly VersionObjectRecord<unknown>[];
  },
): void {
  const objectStore = tx.objectStore(OBJECTS_STORE);
  const commitIndexStore = tx.objectStore(COMMIT_INDEXES_STORE);
  const parentIndexStore = tx.objectStore(PARENT_INDEXES_STORE);

  for (const record of options.records) {
    objectStore.put(
      {
        schemaVersion: 1,
        namespaceKey: options.namespaceKey,
        documentScopeKey: options.documentScopeKey,
        record: cloneJson(record),
      } satisfies StoredObjectRecord,
      objectKey(options.namespaceKey, record),
    );
    if (record.preimage.objectType !== 'workbook.commit.v1') continue;

    const commitId = workbookCommitIdFromObjectDigest(record.digest);
    const payload = record.preimage.payload as WorkbookCommitPayload;
    commitIndexStore.put(
      {
        schemaVersion: 1,
        namespaceKey: options.namespaceKey,
        documentScopeKey: options.documentScopeKey,
        commitId,
        parentCommitIds: [...payload.parentCommitIds],
        createdAt: payload.createdAt,
        author: cloneJson(payload.author),
        objectDigest: cloneJson(record.digest),
      } satisfies StoredCommitIndex,
      commitIndexKey(options.namespaceKey, commitId),
    );
    for (const parentCommitId of payload.parentCommitIds) {
      parentIndexStore.put(
        {
          schemaVersion: 1,
          namespaceKey: options.namespaceKey,
          documentScopeKey: options.documentScopeKey,
          parentLookupKey: parentLookupKey(options.namespaceKey, parentCommitId),
          parentCommitId,
          childCommitId: commitId,
        } satisfies StoredParentIndex,
        parentIndexKey(options.namespaceKey, parentCommitId, commitId),
      );
    }
  }
}
