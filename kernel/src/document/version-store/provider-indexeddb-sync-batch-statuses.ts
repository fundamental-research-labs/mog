import {
  type CompleteSyncBatchStatusInput,
  type ReserveSyncBatchStatusInput,
  type SyncBatchStatusCompleteResult,
  type SyncBatchStatusId,
  type SyncBatchStatusReadResult,
  type SyncBatchStatusRecord,
  type SyncBatchStatusReserveResult,
  type SyncBatchStatusStore,
  type SyncBatchStatusStoreDiagnostic,
  cloneSyncBatchStatusRecord,
  isSyncBatchStatusRecord,
  syncBatchStatusIdentityForOperationContext,
  syncBatchStatusReservationsEquivalent,
  syncBatchStatusStorageKey,
  syncBatchStatusTerminalsEqual,
} from './sync-batch-status-store';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import { INTENTS_STORE } from './provider-indexeddb-schema';
import { cloneJson, idbRequest, idbTransactionDone } from './provider-indexeddb-internal';

type StoredSyncBatchStatus = {
  readonly schemaVersion: 1;
  readonly documentScopeKey: string;
  readonly operation: 'sync-batch-status';
  readonly record: SyncBatchStatusRecord;
};

export class IndexedDbSyncBatchStatusStore implements SyncBatchStatusStore {
  readonly documentScope: VersionDocumentScope;

  private readonly documentScopeKey: string;
  private readonly getDb: () => Promise<IDBDatabase>;

  constructor(options: {
    readonly documentScope: VersionDocumentScope;
    readonly getDb: () => Promise<IDBDatabase>;
  }) {
    this.documentScope = normalizeVersionDocumentScope(options.documentScope);
    this.documentScopeKey = versionDocumentScopeKey(this.documentScope);
    this.getDb = options.getDb;
  }

  async reserveBatchStatus(
    input: ReserveSyncBatchStatusInput,
  ): Promise<SyncBatchStatusReserveResult> {
    let record: SyncBatchStatusRecord;
    try {
      record = this.recordFromInput(input);
    } catch {
      return {
        status: 'failed',
        record: null,
        diagnostics: [
          {
            code: 'VERSION_INVALID_OPTIONS',
            message: 'Sync batch status reservation has invalid sync batch identity.',
            recoverability: 'none',
          },
        ],
      };
    }

    try {
      const existing = await this.findByBatchStatusId(record.batchStatusId);
      if (existing) {
        return syncBatchStatusReservationsEquivalent(existing, record)
          ? {
              status: existing.state === 'complete' ? 'duplicate' : 'existing',
              record: existing,
              diagnostics: [],
            }
          : conflictReserve(
              existing,
              'Sync batch status id is already bound to a different batch identity.',
            );
      }

      await this.putRecord(record);
      return { status: 'reserved', record, diagnostics: [] };
    } catch {
      return {
        status: 'failed',
        record: null,
        diagnostics: [
          {
            code: 'VERSION_PROVIDER_FAILED',
            message: 'IndexedDB sync batch status write failed.',
            recoverability: 'retry',
          },
        ],
      };
    }
  }

  async readByBatchStatusId(
    batchStatusId: SyncBatchStatusId,
  ): Promise<SyncBatchStatusReadResult> {
    try {
      const record = await this.findByBatchStatusId(batchStatusId);
      return record
        ? { status: 'found', record, diagnostics: [] }
        : missingRead('Sync batch status was not found.');
    } catch {
      return failedRead('IndexedDB sync batch status read failed.');
    }
  }

  async completeBatchStatus(
    input: CompleteSyncBatchStatusInput,
  ): Promise<SyncBatchStatusCompleteResult> {
    try {
      const existing = await this.findByBatchStatusId(input.batchStatusId);
      if (!existing) {
        return {
          status: 'missing',
          record: null,
          diagnostics: [
            {
              code: 'VERSION_SYNC_BATCH_STATUS_NOT_FOUND',
              message: 'Sync batch status was not found.',
              recoverability: 'repair',
            },
          ],
        };
      }
      if (syncBatchCompletionIdentityConflicts(existing, input)) {
        return conflictComplete(
          existing,
          'Sync batch status completion did not match the stored batch identity.',
        );
      }
      if (existing.terminal) {
        return syncBatchStatusTerminalsEqual(existing.terminal, input.terminal)
          ? { status: 'completed', record: existing, diagnostics: [] }
          : conflictComplete(
              existing,
              'Sync batch status is already finalized with different terminal metadata.',
            );
      }

      const completed: SyncBatchStatusRecord = {
        ...existing,
        state: input.terminal.status,
        updatedAt: input.completedAt,
        terminal: cloneJson(input.terminal),
      };
      await this.putRecord(completed);
      return { status: 'completed', record: completed, diagnostics: [] };
    } catch {
      return {
        status: 'failed',
        record: null,
        diagnostics: [
          {
            code: 'VERSION_PROVIDER_FAILED',
            message: 'IndexedDB sync batch status completion failed.',
            recoverability: 'retry',
          },
        ],
      };
    }
  }

  private async findByBatchStatusId(
    batchStatusId: SyncBatchStatusId,
  ): Promise<SyncBatchStatusRecord | null> {
    const db = await this.getDb();
    const row = await idbRequest<unknown | undefined>(
      db
        .transaction(INTENTS_STORE, 'readonly')
        .objectStore(INTENTS_STORE)
        .get(syncBatchStatusStorageKey(this.documentScope, batchStatusId)),
    );
    return decodeStoredSyncBatchStatus(row, this.documentScopeKey);
  }

  private async putRecord(record: SyncBatchStatusRecord): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(INTENTS_STORE, 'readwrite');
    const done = idbTransactionDone(tx);
    await idbRequest(
      tx
        .objectStore(INTENTS_STORE)
        .put(
          storedSyncBatchStatus(record),
          syncBatchStatusStorageKey(this.documentScope, record.batchStatusId),
        ),
    );
    await done;
  }

  private recordFromInput(input: ReserveSyncBatchStatusInput): SyncBatchStatusRecord {
    const collaboration = input.operationContext.collaboration;
    if (!collaboration) {
      throw new Error('missing collaboration context');
    }
    return cloneSyncBatchStatusRecord({
      schemaVersion: 1,
      recordKind: 'syncBatchStatus',
      batchStatusId: input.batchStatusId,
      documentScopeKey: this.documentScopeKey,
      sourceKind: collaboration.sourceKind,
      identity: syncBatchStatusIdentityForOperationContext(input.operationContext, input),
      operationContext: input.operationContext,
      state: 'pending',
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }
}

function storedSyncBatchStatus(record: SyncBatchStatusRecord): StoredSyncBatchStatus {
  return {
    schemaVersion: 1,
    documentScopeKey: record.documentScopeKey,
    operation: 'sync-batch-status',
    record: cloneJson(record),
  };
}

function decodeStoredSyncBatchStatus(
  value: unknown,
  documentScopeKey: string,
): SyncBatchStatusRecord | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.operation !== 'sync-batch-status'
  ) {
    return null;
  }
  if (value.documentScopeKey !== documentScopeKey) {
    return null;
  }
  return isSyncBatchStatusRecord(value.record) ? cloneJson(value.record) : null;
}

function syncBatchCompletionIdentityConflicts(
  record: SyncBatchStatusRecord,
  input: CompleteSyncBatchStatusInput,
): boolean {
  if (record.identity.payloadHash !== input.payloadHash) return true;
  if (
    input.orderedSubUpdatePayloadHashes !== undefined &&
    canonicalJsonStringify(record.identity.orderedSubUpdatePayloadHashes ?? []) !==
      canonicalJsonStringify(input.orderedSubUpdatePayloadHashes)
  ) {
    return true;
  }
  if (
    input.subUpdateCount !== undefined &&
    (record.identity.subUpdateCount ?? 0) !== input.subUpdateCount
  ) {
    return true;
  }
  return false;
}

function conflictReserve(
  record: SyncBatchStatusRecord,
  message: string,
): Extract<SyncBatchStatusReserveResult, { status: 'conflict' }> {
  return {
    status: 'conflict',
    record,
    diagnostics: [{ code: 'VERSION_SYNC_BATCH_STATUS_CONFLICT', message, recoverability: 'none' }],
  };
}

function conflictComplete(
  record: SyncBatchStatusRecord,
  message: string,
): {
  readonly status: 'conflict';
  readonly record: SyncBatchStatusRecord;
  readonly diagnostics: readonly SyncBatchStatusStoreDiagnostic[];
} {
  return {
    status: 'conflict',
    record,
    diagnostics: [{ code: 'VERSION_SYNC_BATCH_STATUS_CONFLICT', message, recoverability: 'none' }],
  };
}

function missingRead(message: string): SyncBatchStatusReadResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [
      { code: 'VERSION_SYNC_BATCH_STATUS_NOT_FOUND', message, recoverability: 'repair' },
    ],
  };
}

function failedRead(message: string): SyncBatchStatusReadResult {
  return {
    status: 'failed',
    record: null,
    diagnostics: [{ code: 'VERSION_PROVIDER_FAILED', message, recoverability: 'retry' }],
  };
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON number must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(',')}]`;
  if (!isRecord(value)) throw new Error('value must be canonical JSON');
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`)
    .join(',')}}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
