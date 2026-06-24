import type { InMemoryVersionGraphStoreSnapshot } from '../graph';
import type { VersionGraphInitializeResult, VersionGraphRegistry } from '../provider';
import {
  decodeRegistryEnvelope,
  errorMessage,
  failedStoreResult,
  idbRequest,
  idbTransactionDone,
  initializeSuccess,
  liveMainFromSnapshot,
  persistGraphSnapshot,
  registryEnvelope,
  registryRecordResult,
  rootCommitFromSnapshot,
  versionGraphRefFromLiveRef,
  versionStoreDiagnostic,
  type RegistryRecordRead,
  type StoredRegistryEnvelope,
} from './internal';
import { REGISTRIES_STORE } from '../provider-indexeddb-schema';
import type { VersionStoreFailure } from '../provider';
import { createVersionGraphRegistry, type VersionDocumentScope } from '../registry';

export async function readIndexedDbBackendRegistryRecord(options: {
  readonly db: IDBDatabase;
  readonly scopeKey: string;
  readonly documentScope: VersionDocumentScope;
}): Promise<RegistryRecordRead> {
  const value = await idbRequest<StoredRegistryEnvelope | undefined>(
    options.db
      .transaction(REGISTRIES_STORE, 'readonly')
      .objectStore(REGISTRIES_STORE)
      .get(options.scopeKey),
  );
  if (value === undefined) return { status: 'absent' };
  return await decodeIndexedDbBackendRegistryEnvelope(value, options.documentScope);
}

export async function persistInitializedIndexedDbBackendGraphSnapshot(options: {
  readonly db: IDBDatabase;
  readonly snapshot: InMemoryVersionGraphStoreSnapshot;
  readonly documentScope: VersionDocumentScope;
}): Promise<Extract<VersionGraphInitializeResult, { status: 'success' }> | VersionStoreFailure> {
  try {
    await persistGraphSnapshot({
      db: options.db,
      snapshot: options.snapshot,
      documentScope: options.documentScope,
      mode: { kind: 'initialize' },
    });
    const main = liveMainFromSnapshot(options.snapshot);
    const rootCommit = rootCommitFromSnapshot(options.snapshot, main.targetCommitId);
    return initializeSuccess(
      await createVersionGraphRegistry({
        documentScope: options.documentScope,
        graphId: options.snapshot.namespace.graphId,
        rootCommitId: rootCommit,
        createdAt: main.createdAt,
      }),
      versionGraphRefFromLiveRef(main),
    );
  } catch (error) {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
          operation: 'initializeGraph',
          documentScope: options.documentScope,
          namespace: options.snapshot.namespace,
          recoverability: 'retry',
          safeMessage: 'IndexedDB version graph bootstrap failed before registry publication.',
          details: { cause: errorMessage(error) },
        }),
      ],
      'registry-not-visible',
      true,
    );
  }
}

export async function publishIndexedDbBackendRegistryVisibleLast(options: {
  readonly db: IDBDatabase;
  readonly registry: VersionGraphRegistry;
  readonly scopeKey: string;
  readonly documentScope: VersionDocumentScope;
}): Promise<
  | { readonly status: 'published' }
  | { readonly status: 'same'; readonly registry: VersionGraphRegistry }
  | { readonly status: 'failed'; readonly failure: VersionStoreFailure }
> {
  const tx = options.db.transaction(REGISTRIES_STORE, 'readwrite');
  const store = tx.objectStore(REGISTRIES_STORE);
  const existing = await idbRequest<StoredRegistryEnvelope | undefined>(
    store.get(options.scopeKey),
  );
  if (existing === undefined) {
    store.put(registryEnvelope(options.registry), options.scopeKey);
    await idbTransactionDone(tx);
    return { status: 'published' };
  }
  await idbTransactionDone(tx);

  const decoded = await decodeIndexedDbBackendRegistryEnvelope(existing, options.documentScope);
  if (decoded.status === 'valid') {
    if (
      decoded.registry.currentGraphId === options.registry.currentGraphId &&
      decoded.registry.rootCommitId === options.registry.rootCommitId
    ) {
      return { status: 'same', registry: decoded.registry };
    }
    return {
      status: 'failed',
      failure: failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_GRAPH_CONFLICT', {
            operation: 'initializeGraph',
            documentScope: options.documentScope,
            commitId: decoded.registry.rootCommitId,
            recoverability: 'retry',
            safeMessage: 'A version graph registry already exists for this document.',
          }),
        ],
        'registry-not-visible',
        true,
      ),
    };
  }

  return {
    status: 'failed',
    failure: failedStoreResult(
      registryRecordResult(decoded.status, 'initializeGraph', options.documentScope).diagnostics,
      'registry-not-visible',
    ),
  };
}

async function decodeIndexedDbBackendRegistryEnvelope(
  value: StoredRegistryEnvelope,
  documentScope: VersionDocumentScope,
): Promise<Exclude<RegistryRecordRead, { readonly status: 'absent' }>> {
  return await decodeRegistryEnvelope(value, documentScope);
}
