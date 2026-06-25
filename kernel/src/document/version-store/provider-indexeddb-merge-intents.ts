import {
  type BeginMergeApplyIntentInput,
  type CompleteMergeApplyIntentInput,
  type MergeApplyIntentBeginResult,
  type MergeApplyIntentCompleteResult,
  type MergeApplyIntentId,
  type MergeApplyIntentIdempotencyKey,
  type MergeApplyRefCasProof,
  type MergeApplyRefCasProofLookup,
  type MergeApplyRefCasProofReadResult,
  type MergeApplyIntentReadResult,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
  cloneIntent,
  intentsEquivalent,
  isMergeApplyIntentRecord,
  mergeApplyRefCasProofStorageKey,
  mergeApplyIntentTerminalsEqual,
  mergeApplyIntentStorageKey,
  objectDigestsEqual,
} from './merge-apply-intent-store';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from './object-store';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import { INTENTS_STORE } from './provider-indexeddb-schema';
import { cloneJson, idbRequest, idbTransactionDone } from './provider-indexeddb/internal';

type StoredMergeApplyIntent = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly operation: 'merge-apply-intent';
  readonly record: MergeApplyIntentRecord;
};

type StoredMergeApplyRefCasProof = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly operation: 'merge-ref-cas-proof';
  readonly lookup: MergeApplyRefCasProofLookup;
  readonly proof: MergeApplyRefCasProof;
  readonly recordedAt: string;
};

export class IndexedDbMergeApplyIntentStore implements MergeApplyIntentStore {
  readonly namespace: VersionGraphNamespace;

  private readonly documentScopeKey: string;
  private readonly namespaceKey: string;
  private readonly getDb: () => Promise<IDBDatabase>;

  constructor(options: {
    readonly namespace: VersionGraphNamespace;
    readonly documentScope: VersionDocumentScope;
    readonly getDb: () => Promise<IDBDatabase>;
  }) {
    this.namespace = normalizeVersionGraphNamespace(options.namespace);
    this.namespaceKey = versionGraphNamespaceKey(this.namespace);
    this.documentScopeKey = versionDocumentScopeKey(
      normalizeVersionDocumentScope(options.documentScope),
    );
    this.getDb = options.getDb;
  }

  async beginIntent(input: BeginMergeApplyIntentInput): Promise<MergeApplyIntentBeginResult> {
    const record = this.recordFromInput(input);
    const key = mergeApplyIntentStorageKey(this.namespace, record.idempotencyKey);
    try {
      const db = await this.getDb();
      const tx = db.transaction(INTENTS_STORE, 'readwrite');
      const store = tx.objectStore(INTENTS_STORE);
      const existingRow = await idbRequest<unknown | undefined>(store.get(key));
      const existing = decodeStoredMergeApplyIntent(
        existingRow,
        this.namespaceKey,
        this.documentScopeKey,
      );
      if (existing) {
        await idbTransactionDone(tx);
        return intentsEquivalent(existing, record)
          ? { status: 'existing', record: existing, diagnostics: [] }
          : {
              status: 'conflict',
              record: existing,
              diagnostics: [
                {
                  code: 'VERSION_INTENT_CONFLICT',
                  message: 'Merge apply idempotency key is already bound to a different intent.',
                  recoverability: 'none',
                },
              ],
            };
      }

      store.put(storedIntent(record), key);
      await idbTransactionDone(tx);
      return { status: 'created', record, diagnostics: [] };
    } catch {
      return {
        status: 'failed',
        record: null,
        diagnostics: [
          {
            code: 'VERSION_PROVIDER_FAILED',
            message: 'IndexedDB merge apply intent write failed.',
            recoverability: 'retry',
          },
        ],
      };
    }
  }

  async readByIntentId(intentId: MergeApplyIntentId): Promise<MergeApplyIntentReadResult> {
    try {
      const record = await this.findByIntentId(intentId);
      return record
        ? { status: 'found', record, diagnostics: [] }
        : missingRead('Merge apply intent was not found by intent id.');
    } catch {
      return failedRead('IndexedDB merge apply intent read failed.');
    }
  }

  async readByIdempotencyKey(
    idempotencyKey: MergeApplyIntentIdempotencyKey,
  ): Promise<MergeApplyIntentReadResult> {
    try {
      const db = await this.getDb();
      const row = await idbRequest<unknown | undefined>(
        db
          .transaction(INTENTS_STORE, 'readonly')
          .objectStore(INTENTS_STORE)
          .get(mergeApplyIntentStorageKey(this.namespace, idempotencyKey)),
      );
      const record = decodeStoredMergeApplyIntent(row, this.namespaceKey, this.documentScopeKey);
      return record
        ? { status: 'found', record, diagnostics: [] }
        : missingRead('Merge apply intent was not found by idempotency key.');
    } catch {
      return failedRead('IndexedDB merge apply intent read failed.');
    }
  }

  async readRefCasProof(
    input: MergeApplyRefCasProofLookup,
  ): Promise<MergeApplyRefCasProofReadResult> {
    try {
      const db = await this.getDb();
      const row = await idbRequest<unknown | undefined>(
        db
          .transaction(INTENTS_STORE, 'readonly')
          .objectStore(INTENTS_STORE)
          .get(mergeApplyRefCasProofStorageKey(this.namespace, input)),
      );
      const proof = decodeStoredMergeApplyRefCasProof(
        row,
        this.namespaceKey,
        this.documentScopeKey,
        input,
      );
      return proof
        ? { status: 'found', proof, diagnostics: [] }
        : {
            status: 'missing',
            proof: null,
            diagnostics: [
              {
                code: 'VERSION_INTENT_NOT_FOUND',
                message: 'IndexedDB merge apply ref CAS proof was not found.',
                recoverability: 'repair',
              },
            ],
          };
    } catch {
      return {
        status: 'failed',
        proof: null,
        diagnostics: [
          {
            code: 'VERSION_PROVIDER_FAILED',
            message: 'IndexedDB merge apply ref CAS proof read failed.',
            recoverability: 'retry',
          },
        ],
      };
    }
  }

  async completeIntent(
    input: CompleteMergeApplyIntentInput,
  ): Promise<MergeApplyIntentCompleteResult> {
    try {
      const db = await this.getDb();
      const tx = db.transaction(INTENTS_STORE, 'readwrite');
      const store = tx.objectStore(INTENTS_STORE);
      const done = idbTransactionDone(tx);
      const existing = await findByIntentIdInStore(
        store,
        this.namespaceKey,
        this.documentScopeKey,
        input.intentId,
      );
      if (!existing) {
        await done;
        return {
          status: 'missing',
          record: null,
          diagnostics: [
            {
              code: 'VERSION_INTENT_NOT_FOUND',
              message: 'Merge apply intent was not found.',
              recoverability: 'repair',
            },
          ],
        };
      }
      if (!objectDigestsEqual(existing.resolvedAttemptDigest, input.resolvedAttemptDigest)) {
        await done;
        return {
          status: 'conflict',
          record: existing,
          diagnostics: [
            {
              code: 'VERSION_INTENT_CONFLICT',
              message: 'Merge apply completion did not match the stored resolved attempt digest.',
              recoverability: 'none',
            },
          ],
        };
      }
      if (existing.terminal) {
        await done;
        return mergeApplyIntentTerminalsEqual(existing.terminal, input.terminal)
          ? { status: 'completed', record: existing, diagnostics: [] }
          : {
              status: 'conflict',
              record: existing,
              diagnostics: [
                {
                  code: 'VERSION_INTENT_CONFLICT',
                  message:
                    'Merge apply intent is already finalized with a different terminal result.',
                  recoverability: 'none',
                },
              ],
            };
      }

      const completed: MergeApplyIntentRecord = {
        ...existing,
        state: 'finalized',
        updatedAt: input.completedAt,
        terminal: cloneJson(input.terminal),
      };
      await idbRequest(
        store.put(
          storedIntent(completed),
          mergeApplyIntentStorageKey(this.namespace, completed.idempotencyKey),
        ),
      );
      await done;
      return { status: 'completed', record: completed, diagnostics: [] };
    } catch {
      return {
        status: 'failed',
        record: null,
        diagnostics: [
          {
            code: 'VERSION_PROVIDER_FAILED',
            message: 'IndexedDB merge apply intent completion failed.',
            recoverability: 'retry',
          },
        ],
      };
    }
  }

  private async findByIntentId(
    intentId: MergeApplyIntentId,
  ): Promise<MergeApplyIntentRecord | null> {
    const db = await this.getDb();
    const tx = db.transaction(INTENTS_STORE, 'readonly');
    const record = await findByIntentIdInStore(
      tx.objectStore(INTENTS_STORE),
      this.namespaceKey,
      this.documentScopeKey,
      intentId,
    );
    await idbTransactionDone(tx);
    return record;
  }

  private recordFromInput(input: BeginMergeApplyIntentInput): MergeApplyIntentRecord {
    return cloneIntent({
      schemaVersion: 1,
      recordKind: 'mergeApplyIntent',
      namespaceKey: this.namespaceKey,
      documentScopeKey: this.documentScopeKey,
      state: 'staging',
      updatedAt: input.createdAt,
      ...input,
    });
  }
}

function findByIntentIdInStore(
  store: IDBObjectStore,
  namespaceKey: string,
  documentScopeKey: string,
  intentId: MergeApplyIntentId,
): Promise<MergeApplyIntentRecord | null> {
  return new Promise<MergeApplyIntentRecord | null>((resolve, reject) => {
    const request = store.index('namespaceKey').openCursor(IDBKeyRange.only(namespaceKey));
    request.onerror = () => reject(request.error ?? new Error('merge apply intent cursor failed'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(null);
        return;
      }
      const candidate = decodeStoredMergeApplyIntent(cursor.value, namespaceKey, documentScopeKey);
      if (candidate?.intentId === intentId) {
        resolve(candidate);
        return;
      }
      cursor.continue();
    };
  });
}

function storedIntent(record: MergeApplyIntentRecord): StoredMergeApplyIntent {
  return {
    schemaVersion: 1,
    namespaceKey: record.namespaceKey,
    documentScopeKey: record.documentScopeKey,
    operation: 'merge-apply-intent',
    record: cloneJson(record),
  };
}

function decodeStoredMergeApplyIntent(
  value: unknown,
  namespaceKey: string,
  documentScopeKey: string,
): MergeApplyIntentRecord | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.operation !== 'merge-apply-intent') {
    return null;
  }
  if (value.namespaceKey !== namespaceKey || value.documentScopeKey !== documentScopeKey)
    return null;
  return isMergeApplyIntentRecord(value.record) ? cloneJson(value.record) : null;
}

function decodeStoredMergeApplyRefCasProof(
  value: unknown,
  namespaceKey: string,
  documentScopeKey: string,
  expectedLookup: MergeApplyRefCasProofLookup,
): MergeApplyRefCasProof | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.operation !== 'merge-ref-cas-proof') {
    return null;
  }
  const row = value as StoredMergeApplyRefCasProof;
  if (row.namespaceKey !== namespaceKey || row.documentScopeKey !== documentScopeKey) return null;
  if (
    !isRecord(row.lookup) ||
    row.lookup.applyKind !== expectedLookup.applyKind ||
    row.lookup.targetRef !== expectedLookup.targetRef ||
    row.lookup.headBefore !== expectedLookup.headBefore ||
    row.lookup.headAfter !== expectedLookup.headAfter
  ) {
    return null;
  }
  return isMergeApplyRefCasProof(row.proof) ? cloneJson(row.proof) : null;
}

function isMergeApplyRefCasProof(value: unknown): value is MergeApplyRefCasProof {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (
    value.applyKind !== 'fastForward' &&
    value.applyKind !== 'alreadyMerged' &&
    value.applyKind !== 'mergeCommit'
  ) {
    return false;
  }
  return (
    isObjectDigest(value.commitMetadataDigest) &&
    isObjectDigest(value.refUpdateMetadataDigest) &&
    isObjectDigest(value.refLogEventDigest)
  );
}

function isObjectDigest(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.algorithm === 'sha256' &&
    typeof value.digest === 'string' &&
    /^[0-9a-f]{64}$/.test(value.digest)
  );
}

function missingRead(message: string): MergeApplyIntentReadResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [{ code: 'VERSION_INTENT_NOT_FOUND', message, recoverability: 'repair' }],
  };
}

function failedRead(message: string): MergeApplyIntentReadResult {
  return {
    status: 'failed',
    record: null,
    diagnostics: [{ code: 'VERSION_PROVIDER_FAILED', message, recoverability: 'retry' }],
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
