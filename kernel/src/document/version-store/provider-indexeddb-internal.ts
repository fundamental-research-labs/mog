import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStoreFromSnapshot,
  type InMemoryVersionGraphStore,
  type InMemoryVersionGraphStoreSnapshot,
  type VersionGraphRef,
  type VersionGraphStoreDiagnostic,
  type VersionGraphStoreDiagnosticCode,
  type VersionGraphSymbolicRef,
  type VersionGraphWriteResult,
} from './graph-store';
import {
  cloneVersionStoreCapabilities,
  type VersionAccessContext,
  type VersionDiagnosticMessageId,
  type VersionGraphInitializeResult,
  type VersionGraphRegistry,
  type VersionGraphRegistryReadResult,
  type VersionStoreCapabilities,
  type VersionStoreDiagnostic,
  type VersionStoreDiagnosticCode,
  type VersionStoreFailure,
  type VersionStoreLifecycleState,
  type VersionStoreMutationGuarantee,
  type VersionStoreOperation,
} from './provider';
import {
  VERSION_GRAPH_REGISTRY_SCHEMA_VERSION,
  cloneVersionGraphRegistry,
  createVersionGraphRegistry,
  normalizeVersionDocumentScope,
  normalizeVersionStoreString,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from './object-store';
import {
  objectDigestFromWorkbookCommitId,
  parseWorkbookCommitId,
  workbookCommitIdFromObjectDigest,
  type WorkbookCommitId,
} from './object-digest';
import { refVersionsEqual, type LiveRefRecord, type RefRecord, type RefVersion } from './ref-store';
import type { InMemoryRefStoreSnapshot } from './ref-store-snapshot';
import type { WorkbookCommitPayload } from './commit-store';
import {
  COMMIT_INDEXES_STORE,
  INDEX_MANIFESTS_STORE,
  INTENTS_STORE,
  OBJECTS_STORE,
  PARENT_INDEXES_STORE,
  REFS_STORE,
  REGISTRIES_STORE,
  SYMBOLIC_REFS_STORE,
  VERSION_STORE_INDEXEDDB_STORES,
} from './provider-indexeddb-schema';

export type RegistryRecordRead =
  | { readonly status: 'absent' }
  | { readonly status: 'valid'; readonly registry: VersionGraphRegistry }
  | { readonly status: 'corrupt' }
  | { readonly status: 'unsupported' };

export type StoredRegistryEnvelope = {
  readonly schemaVersion: 1;
  readonly registry: VersionGraphRegistry;
};

export type StoredObjectRecord = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly record: VersionObjectRecord<unknown>;
};

export type StoredRefRecord = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly record: RefRecord;
};

type StoredSymbolicRef = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly ref: VersionGraphSymbolicRef;
};

type StoredCommitIndex = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly commitId: WorkbookCommitId;
  readonly parentCommitIds: readonly WorkbookCommitId[];
  readonly createdAt: string;
  readonly author: WorkbookCommitPayload['author'];
  readonly objectDigest: ReturnType<typeof objectDigestFromWorkbookCommitId>;
};

type StoredParentIndex = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly parentLookupKey: string;
  readonly parentCommitId: WorkbookCommitId;
  readonly childCommitId: WorkbookCommitId;
};

type StoredIndexManifest = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly namespace: VersionGraphNamespace;
  readonly refStoreNextGeneratedId: InMemoryRefStoreSnapshot['nextGeneratedId'];
  readonly updatedAt: string;
};

type StoredIntent = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly operation: 'graph-snapshot-write';
  readonly recordedAt: string;
};

export class RefCasConflictError extends Error {
  readonly expectedHead: WorkbookCommitId;
  readonly expectedRefVersion: RefVersion;
  readonly actualHead: WorkbookCommitId;
  readonly actualRefVersion: RefVersion;

  constructor(input: {
    readonly expectedHead: WorkbookCommitId;
    readonly expectedRefVersion: RefVersion;
    readonly actualHead: WorkbookCommitId;
    readonly actualRefVersion: RefVersion;
  }) {
    super('IndexedDB version graph ref CAS conflict.');
    this.name = 'RefCasConflictError';
    this.expectedHead = input.expectedHead;
    this.expectedRefVersion = input.expectedRefVersion;
    this.actualHead = input.actualHead;
    this.actualRefVersion = input.actualRefVersion;
  }
}

export async function loadGraphSnapshot(
  db: IDBDatabase,
  namespace: VersionGraphNamespace,
): Promise<InMemoryVersionGraphStore> {
  const normalized = normalizeVersionGraphNamespace(namespace);
  const namespaceKey = versionGraphNamespaceKey(normalized);
  const tx = db.transaction([OBJECTS_STORE, REFS_STORE, INDEX_MANIFESTS_STORE], 'readonly');
  const objects = await readAllByIndex<StoredObjectRecord>(
    tx.objectStore(OBJECTS_STORE),
    'namespaceKey',
    namespaceKey,
  );
  const refs = await readAllByIndex<StoredRefRecord>(
    tx.objectStore(REFS_STORE),
    'namespaceKey',
    namespaceKey,
  );
  const manifest = await idbRequest<StoredIndexManifest | undefined>(
    tx.objectStore(INDEX_MANIFESTS_STORE).get(namespaceKey),
  );
  await idbTransactionDone(tx);

  return createInMemoryVersionGraphStoreFromSnapshot({
    namespace: normalized,
    objectRecords: objects.map((entry) => cloneJson(entry.record)),
    refStore: {
      records: refs.map((entry) => cloneJson(entry.record)),
      nextGeneratedId: manifest?.refStoreNextGeneratedId ?? 0,
    },
  });
}

export async function persistGraphSnapshot(options: {
  readonly db: IDBDatabase;
  readonly snapshot: InMemoryVersionGraphStoreSnapshot;
  readonly documentScope: VersionDocumentScope;
  readonly mode:
    | { readonly kind: 'initialize' }
    | {
        readonly kind: 'commit';
        readonly expectedHeadCommitId: WorkbookCommitId;
        readonly expectedMainRefVersion: RefVersion;
      };
}): Promise<void> {
  const namespace = normalizeVersionGraphNamespace(options.snapshot.namespace);
  const namespaceKey = versionGraphNamespaceKey(namespace);
  const documentScopeKey = versionDocumentScopeKey(
    normalizeVersionDocumentScope(options.documentScope),
  );
  const tx = options.db.transaction(VERSION_STORE_INDEXEDDB_STORES, 'readwrite');

  if (options.mode.kind === 'commit') {
    const currentRef = await idbRequest<StoredRefRecord | undefined>(
      tx.objectStore(REFS_STORE).get(refKey(namespaceKey, 'main')),
    );
    const actual = currentRef?.record;
    if (
      !actual ||
      actual.state !== 'live' ||
      actual.targetCommitId !== options.mode.expectedHeadCommitId ||
      !refVersionsEqual(actual.refVersion, options.mode.expectedMainRefVersion)
    ) {
      tx.abort();
      throw new RefCasConflictError({
        expectedHead: options.mode.expectedHeadCommitId,
        expectedRefVersion: options.mode.expectedMainRefVersion,
        actualHead:
          actual?.state === 'live' ? actual.targetCommitId : options.mode.expectedHeadCommitId,
        actualRefVersion:
          actual?.state === 'live' ? actual.refVersion : { kind: 'counter', value: '-1' },
      });
    }
  }

  writeSnapshotStores(tx, {
    namespace,
    namespaceKey,
    documentScopeKey,
    snapshot: options.snapshot,
  });
  await idbTransactionDone(tx);
}

function writeSnapshotStores(
  tx: IDBTransaction,
  options: {
    readonly namespace: VersionGraphNamespace;
    readonly namespaceKey: string;
    readonly documentScopeKey: string;
    readonly snapshot: InMemoryVersionGraphStoreSnapshot;
  },
): void {
  const objectStore = tx.objectStore(OBJECTS_STORE);
  const commitIndexStore = tx.objectStore(COMMIT_INDEXES_STORE);
  const parentIndexStore = tx.objectStore(PARENT_INDEXES_STORE);
  const refStore = tx.objectStore(REFS_STORE);
  const symbolicRefStore = tx.objectStore(SYMBOLIC_REFS_STORE);
  const manifestStore = tx.objectStore(INDEX_MANIFESTS_STORE);
  const intentStore = tx.objectStore(INTENTS_STORE);

  for (const record of options.snapshot.objectRecords) {
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

  for (const record of options.snapshot.refStore.records) {
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

  manifestStore.put(
    {
      schemaVersion: 1,
      namespaceKey: options.namespaceKey,
      documentScopeKey: options.documentScopeKey,
      namespace: cloneJson(options.namespace),
      refStoreNextGeneratedId: options.snapshot.refStore.nextGeneratedId,
      updatedAt: new Date().toISOString(),
    } satisfies StoredIndexManifest,
    options.namespaceKey,
  );
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
}

export async function decodeRegistryEnvelope(
  value: unknown,
  expectedScope: VersionDocumentScope,
): Promise<Exclude<RegistryRecordRead, { status: 'absent' }>> {
  if (!isPlainRecord(value)) return { status: 'corrupt' };
  if (value.schemaVersion !== 1) {
    return typeof value.schemaVersion === 'number'
      ? { status: 'unsupported' }
      : { status: 'corrupt' };
  }
  if (!hasOnlyKeys(value, ['schemaVersion', 'registry'])) return { status: 'corrupt' };

  const registry = value.registry;
  if (!isPlainRecord(registry)) return { status: 'corrupt' };
  if (registry.schemaVersion !== VERSION_GRAPH_REGISTRY_SCHEMA_VERSION) {
    return typeof registry.schemaVersion === 'number'
      ? { status: 'unsupported' }
      : { status: 'corrupt' };
  }
  if (
    !hasOnlyKeys(registry, [
      'schemaVersion',
      'workspaceId',
      'documentId',
      'principalScope',
      'currentGraphId',
      'headRefName',
      'rootCommitId',
      'registryRevision',
      'registryChecksum',
      'createdAt',
    ])
  ) {
    return { status: 'corrupt' };
  }

  try {
    const documentScope = normalizeVersionDocumentScope({
      ...(registry.workspaceId === undefined
        ? {}
        : { workspaceId: registry.workspaceId as string }),
      documentId: registry.documentId as string,
      ...(registry.principalScope === undefined
        ? {}
        : { principalScope: registry.principalScope as string }),
    });
    if (versionDocumentScopeKey(documentScope) !== versionDocumentScopeKey(expectedScope)) {
      return { status: 'corrupt' };
    }
    const expected = await createVersionGraphRegistry({
      documentScope,
      graphId: normalizeVersionStoreString(registry.currentGraphId, 'registry.currentGraphId'),
      rootCommitId: parseWorkbookCommitId(registry.rootCommitId),
      createdAt: normalizeVersionStoreString(registry.createdAt, 'registry.createdAt'),
    });
    const candidate = cloneVersionGraphRegistry(registry as unknown as VersionGraphRegistry);
    return registriesEqual(candidate, expected)
      ? { status: 'valid', registry: candidate }
      : { status: 'corrupt' };
  } catch {
    return { status: 'corrupt' };
  }
}

export function registryEnvelope(registry: VersionGraphRegistry): StoredRegistryEnvelope {
  return { schemaVersion: 1, registry: cloneVersionGraphRegistry(registry) };
}

function registriesEqual(left: VersionGraphRegistry, right: VersionGraphRegistry): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.workspaceId === right.workspaceId &&
    left.documentId === right.documentId &&
    left.principalScope === right.principalScope &&
    left.currentGraphId === right.currentGraphId &&
    left.headRefName === right.headRefName &&
    left.rootCommitId === right.rootCommitId &&
    left.registryRevision.kind === right.registryRevision.kind &&
    left.registryRevision.value === right.registryRevision.value &&
    left.registryChecksum.algorithm === right.registryChecksum.algorithm &&
    left.registryChecksum.digest === right.registryChecksum.digest &&
    left.createdAt === right.createdAt
  );
}

export function liveMainFromSnapshot(snapshot: InMemoryVersionGraphStoreSnapshot): LiveRefRecord {
  const main = snapshot.refStore.records.find(
    (record): record is LiveRefRecord => record.state === 'live' && record.name === 'main',
  );
  if (!main) throw new Error('IndexedDB version graph snapshot is missing the live main ref.');
  return main;
}

export function rootCommitFromSnapshot(
  snapshot: InMemoryVersionGraphStoreSnapshot,
  commitId: WorkbookCommitId,
): WorkbookCommitId {
  const digest = objectDigestFromWorkbookCommitId(commitId);
  const record = snapshot.objectRecords.find(
    (candidate) =>
      candidate.digest.algorithm === digest.algorithm &&
      candidate.digest.digest === digest.digest &&
      candidate.preimage.objectType === 'workbook.commit.v1',
  );
  if (!record)
    throw new Error('IndexedDB version graph snapshot is missing the root commit object.');
  return workbookCommitIdFromObjectDigest(record.digest);
}

export function versionGraphRefFromLiveRef(ref: LiveRefRecord): VersionGraphRef {
  return {
    name: VERSION_GRAPH_MAIN_REF,
    commitId: ref.targetCommitId,
    revision: cloneJson(ref.refVersion),
    updatedAt: ref.updatedAt,
  };
}

export function initializeSuccess(
  registry: VersionGraphRegistry,
  main: VersionGraphRef,
): Extract<VersionGraphInitializeResult, { status: 'success' }> {
  return {
    status: 'success',
    registry: cloneVersionGraphRegistry(registry),
    rootCommit: {
      id: registry.rootCommitId,
      refName: VERSION_GRAPH_MAIN_REF,
      resolvedFrom: VERSION_GRAPH_HEAD_REF,
      refRevision: cloneJson(main.revision),
    },
    initialHead: { ...main, revision: cloneJson(main.revision) },
    symbolicHead: {
      name: VERSION_GRAPH_HEAD_REF,
      target: VERSION_GRAPH_MAIN_REF,
      revision: cloneJson(main.revision),
    },
    diagnostics: [],
  };
}

export function failedStoreResult(
  diagnostics: readonly VersionStoreDiagnostic[],
  mutationGuarantee: VersionStoreFailure['mutationGuarantee'],
  retryable = false,
): VersionStoreFailure {
  return {
    status: 'failed',
    diagnostics: Object.freeze([...diagnostics]),
    mutationGuarantee,
    retryable,
  };
}

export function failedGraphWrite(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  mutationGuarantee: Extract<VersionGraphWriteResult, { status: 'failed' }>['mutationGuarantee'],
): Extract<VersionGraphWriteResult, { status: 'failed' }> {
  return { status: 'failed', diagnostics, mutationGuarantee };
}

export function mapGraphDiagnostics(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  operation: VersionStoreOperation,
): readonly VersionStoreDiagnostic[] {
  return diagnostics.map((item) =>
    versionStoreDiagnostic(item.code, {
      operation,
      namespace: item.namespace,
      refName: item.refName,
      commitId: item.commitId,
      safeMessage: item.message,
      sourceDiagnostics: [item],
      details: item.details,
    }),
  );
}

export function registryRecordResult(
  kind: 'corrupt' | 'unsupported',
  operation: VersionStoreOperation,
  documentScope: VersionDocumentScope,
): Extract<VersionGraphRegistryReadResult, { status: 'corrupt' | 'unsupported' }> {
  const code = kind === 'corrupt' ? 'VERSION_CORRUPT_REGISTRY' : 'VERSION_UNSUPPORTED_REGISTRY';
  return {
    status: kind,
    registry: null,
    diagnostics: [
      versionStoreDiagnostic(code, {
        operation,
        documentScope,
        recoverability: kind === 'corrupt' ? 'repair' : 'unsupported',
        safeMessage:
          kind === 'corrupt'
            ? 'Version graph registry is corrupt and cannot be opened normally.'
            : 'Version graph registry schema is not supported by this provider.',
      }),
    ],
    mutationGuarantee: 'no-write-attempted',
  };
}

export function versionStoreDiagnostic(
  code: VersionStoreDiagnosticCode,
  options: {
    readonly operation: VersionStoreOperation;
    readonly documentScope?: VersionDocumentScope;
    readonly namespace?: VersionGraphNamespace;
    readonly refName?: typeof VERSION_GRAPH_MAIN_REF | typeof VERSION_GRAPH_HEAD_REF;
    readonly commitId?: WorkbookCommitId;
    readonly safeMessage: string;
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly mutationGuarantee?: VersionStoreMutationGuarantee;
    readonly lifecycleState?: VersionStoreLifecycleState;
    readonly details?: Readonly<Record<string, string | number | boolean | null>>;
    readonly sourceDiagnostics?: readonly VersionGraphStoreDiagnostic[];
  },
): VersionStoreDiagnostic {
  return Object.freeze({
    code,
    issueCode: code,
    severity:
      code === 'VERSION_PROVIDER_FAILED' || code === 'VERSION_OBJECT_STORE_FAILURE'
        ? 'fatal'
        : 'error',
    recoverability: options.recoverability ?? recoverabilityForCode(code),
    messageTemplateId: messageTemplateIdForCode(code),
    safeMessage: options.safeMessage,
    message: options.safeMessage,
    operation: options.operation,
    redacted: true,
    ...(options.documentScope
      ? { documentScope: normalizeVersionDocumentScope(options.documentScope) }
      : {}),
    ...(options.namespace ? { namespace: normalizeVersionGraphNamespace(options.namespace) } : {}),
    ...(options.refName ? { refName: options.refName } : {}),
    ...(options.commitId ? { commitId: options.commitId } : {}),
    ...(options.mutationGuarantee ? { mutationGuarantee: options.mutationGuarantee } : {}),
    ...(options.lifecycleState ? { lifecycleState: options.lifecycleState } : {}),
    ...(options.details ? { details: options.details } : {}),
    ...(options.sourceDiagnostics ? { sourceDiagnostics: options.sourceDiagnostics } : {}),
  });
}

function messageTemplateIdForCode(code: VersionStoreDiagnosticCode): VersionDiagnosticMessageId {
  const ids: Partial<Record<VersionStoreDiagnosticCode, VersionDiagnosticMessageId>> = {
    VERSION_STORE_UNAVAILABLE: 'version.store.unavailable',
    VERSION_PROVIDER_FAILED: 'version.provider.failed',
    VERSION_STORE_READ_ONLY: 'version.store.read-only',
    VERSION_GRAPH_UNINITIALIZED: 'version.graph.uninitialized',
    VERSION_GRAPH_CONFLICT: 'version.graph.conflict',
    VERSION_UNSUPPORTED_REGISTRY: 'version.registry.unsupported',
    VERSION_CORRUPT_REGISTRY: 'version.registry.corrupt',
    VERSION_WRONG_NAMESPACE: 'version.integrity.wrong-namespace',
    VERSION_MISSING_OBJECT: 'version.integrity.missing-object',
    VERSION_MISSING_PARENT: 'version.integrity.missing-parent',
    VERSION_MISSING_CHANGE_SET: 'version.integrity.missing-change-set',
    VERSION_MISSING_DEPENDENCY: 'version.integrity.missing-change-set',
    VERSION_REF_CONFLICT: 'version.ref.conflict',
    VERSION_DANGLING_REF: 'version.ref.dangling',
    VERSION_INVALID_OPTIONS: 'version.options.invalid',
    VERSION_INVALID_COMMIT_ID: 'version.options.invalid',
    VERSION_INVALID_COMMIT_PAYLOAD: 'version.options.invalid',
    VERSION_WRONG_DOCUMENT: 'version.options.invalid',
    VERSION_STALE_PAGE_CURSOR: 'version.page-cursor.stale',
    VERSION_UNSUPPORTED_PAGE_TOKEN: 'version.page-cursor.stale',
    VERSION_UNSUPPORTED_DURABLE_PERSISTENCE: 'version.unsupported',
    VERSION_UNSUPPORTED_PARENT_COMMIT: 'version.unsupported',
    VERSION_OBJECT_STORE_FAILURE: 'version.provider.failed',
  };
  return ids[code] ?? 'version.provider.failed';
}

function recoverabilityForCode(
  code: VersionStoreDiagnosticCode,
): VersionStoreDiagnostic['recoverability'] {
  if (
    code === 'VERSION_STORE_UNAVAILABLE' ||
    code === 'VERSION_GRAPH_CONFLICT' ||
    code === 'VERSION_REF_CONFLICT' ||
    code === 'VERSION_STALE_PAGE_CURSOR'
  )
    return 'retry';
  if (
    code === 'VERSION_UNSUPPORTED_DURABLE_PERSISTENCE' ||
    code === 'VERSION_UNSUPPORTED_REGISTRY' ||
    code === 'VERSION_UNSUPPORTED_PARENT_COMMIT' ||
    code === 'VERSION_UNSUPPORTED_PAGE_TOKEN'
  )
    return 'unsupported';
  if (
    code === 'VERSION_CORRUPT_REGISTRY' ||
    code === 'VERSION_DANGLING_REF' ||
    code === 'VERSION_MISSING_OBJECT' ||
    code === 'VERSION_MISSING_PARENT' ||
    code === 'VERSION_MISSING_CHANGE_SET' ||
    code === 'VERSION_OBJECT_STORE_FAILURE'
  )
    return 'repair';
  return 'none';
}

export function graphLoadDiagnostic(
  error: unknown,
  namespace: VersionGraphNamespace,
  operation: VersionGraphStoreDiagnostic['operation'],
): VersionGraphStoreDiagnostic {
  return graphDiagnostic(
    'VERSION_OBJECT_STORE_FAILURE',
    'IndexedDB graph snapshot could not be loaded.',
    {
      namespace,
      operation,
      details: { cause: errorMessage(error) },
    },
  );
}

export function graphDiagnostic(
  code: VersionGraphStoreDiagnosticCode,
  message: string,
  options: Omit<VersionGraphStoreDiagnostic, 'code' | 'severity' | 'message'> = {},
): VersionGraphStoreDiagnostic {
  return {
    code,
    severity:
      code === 'VERSION_OBJECT_STORE_FAILURE' ||
      code === 'VERSION_DANGLING_REF' ||
      code === 'VERSION_MISSING_OBJECT'
        ? 'corruption'
        : 'error',
    message,
    ...options,
  };
}

export function readOnlyCapabilities(
  capabilities: VersionStoreCapabilities,
): VersionStoreCapabilities {
  return cloneVersionStoreCapabilities({
    ...capabilities,
    readOnlyHistory: true,
    writes: {
      initializeGraph: false,
      putObjects: false,
      updateRefs: false,
      updateSymbolicRefs: false,
      commitGraphWrite: false,
      repairIndexes: false,
      quarantineCorruptRecords: false,
    },
    corruptionQuarantine: false,
  });
}

export function normalizeVersionAccessContext(
  accessContext: VersionAccessContext | undefined,
): VersionAccessContext {
  if (accessContext === undefined) return Object.freeze({});
  return Object.freeze({
    ...(accessContext.principalScope === undefined
      ? {}
      : {
          principalScope: normalizeVersionStoreString(
            accessContext.principalScope,
            'accessContext.principalScope',
          ),
        }),
    ...(accessContext.capabilityIds === undefined
      ? {}
      : {
          capabilityIds: Object.freeze(
            [...accessContext.capabilityIds].map((capabilityId, index) =>
              normalizeVersionStoreString(capabilityId, `accessContext.capabilityIds[${index}]`),
            ),
          ),
        }),
    ...(accessContext.diagnosticsAllowed === undefined
      ? {}
      : { diagnosticsAllowed: Boolean(accessContext.diagnosticsAllowed) }),
  });
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

export function idbTransactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function readAllByIndex<T>(store: IDBObjectStore, indexName: string, key: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    const request = store.index(indexName).openCursor(IDBKeyRange.only(key));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(out);
      out.push(cursor.value as T);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed.'));
  });
}

function objectKey(namespaceKey: string, record: VersionObjectRecord<unknown>): string {
  return `${namespaceKey}\u0000${record.digest.algorithm}\u0000${record.digest.digest}`;
}

function refKey(namespaceKey: string, name: string): string {
  return `${namespaceKey}\u0000${name}`;
}

function commitIndexKey(namespaceKey: string, commitId: WorkbookCommitId): string {
  return `${namespaceKey}\u0000${commitId}`;
}

function parentLookupKey(namespaceKey: string, parentCommitId: WorkbookCommitId): string {
  return `${namespaceKey}\u0000${parentCommitId}`;
}

function parentIndexKey(
  namespaceKey: string,
  parentCommitId: WorkbookCommitId,
  childCommitId: WorkbookCommitId,
): string {
  return `${namespaceKey}\u0000${parentCommitId}\u0000${childCommitId}`;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    prototype === Object.prototype ||
    prototype === null ||
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
