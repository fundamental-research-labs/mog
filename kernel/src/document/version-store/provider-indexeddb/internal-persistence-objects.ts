import type { WorkbookCommitPayload } from '../commit-store';
import { workbookCommitIdFromObjectDigest } from '../object-digest';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
  COMMIT_INDEXES_STORE,
  OBJECTS_STORE,
  PARENT_INDEXES_STORE,
} from '../provider-indexeddb-schema';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from '../registry';
import { idbTransactionDone } from './internal-idb';
import { cloneJson } from './internal-json';
import { commitIndexKey, objectKey, parentIndexKey, parentLookupKey } from './internal-keys';
import type { StoredCommitIndex, StoredObjectRecord, StoredParentIndex } from './internal-records';

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

export function writeObjectRecords(
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
