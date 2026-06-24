import {
  type AppliedSyncUpdateIdentityCompleteResult,
  type AppliedSyncUpdateIdentityKey,
  type AppliedSyncUpdateIdentityReadResult,
  type AppliedSyncUpdateIdentityRecord,
  type AppliedSyncUpdateIdentityReserveResult,
  type AppliedSyncUpdateIdentityStore,
  type CompleteAppliedSyncUpdateIdentityInput,
  type ReserveAppliedSyncUpdateIdentityInput,
  appliedSyncUpdateIdentityKeyMaterialForOperationContext,
  appliedSyncUpdateIdentityReservationsEquivalent,
  appliedSyncUpdateIdentityStorageKey,
  appliedSyncUpdateIdentityTerminalsEqual,
  cloneAppliedSyncUpdateIdentityRecord,
  isAppliedSyncUpdateIdentityRecord,
} from './applied-sync-update-identity-store';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import { INTENTS_STORE } from './provider-indexeddb-schema';
import { cloneJson, idbRequest, idbTransactionDone } from './provider-indexeddb/internal';

type StoredAppliedSyncUpdateIdentity = {
  readonly schemaVersion: 1;
  readonly documentScopeKey: string;
  readonly operation: 'applied-sync-update-identity';
  readonly record: AppliedSyncUpdateIdentityRecord;
};

export class IndexedDbAppliedSyncUpdateIdentityStore implements AppliedSyncUpdateIdentityStore {
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

  async reserveIdentity(
    input: ReserveAppliedSyncUpdateIdentityInput,
  ): Promise<AppliedSyncUpdateIdentityReserveResult> {
    let record: AppliedSyncUpdateIdentityRecord;
    try {
      record = await this.recordFromInput(input);
    } catch {
      return {
        status: 'failed',
        record: null,
        diagnostics: [
          {
            code: 'VERSION_INVALID_OPTIONS',
            message: 'Applied sync update reservation has invalid identity context.',
            recoverability: 'none',
          },
        ],
      };
    }

    try {
      const existing = await this.findByIdentityKey(record.identityKey);
      if (existing) {
        if (existing.payloadHash !== record.payloadHash) {
          return conflictReserve(
            existing,
            'Applied sync update identity is already bound to a different payload hash.',
          );
        }
        if (!appliedSyncUpdateIdentityReservationsEquivalent(existing, record)) {
          return conflictReserve(
            existing,
            'Applied sync update identity key is already bound to a different identity.',
          );
        }
        return {
          status: existing.state === 'applied' ? 'duplicate' : 'existing',
          record: existing,
          diagnostics: [],
        };
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
            message: 'IndexedDB applied sync update identity write failed.',
            recoverability: 'retry',
          },
        ],
      };
    }
  }

  async readByIdentityKey(
    identityKey: AppliedSyncUpdateIdentityKey,
  ): Promise<AppliedSyncUpdateIdentityReadResult> {
    try {
      const record = await this.findByIdentityKey(identityKey);
      return record
        ? { status: 'found', record, diagnostics: [] }
        : missingRead('Applied sync update identity was not found.');
    } catch {
      return failedRead('IndexedDB applied sync update identity read failed.');
    }
  }

  async completeIdentity(
    input: CompleteAppliedSyncUpdateIdentityInput,
  ): Promise<AppliedSyncUpdateIdentityCompleteResult> {
    try {
      const existing = await this.findByIdentityKey(input.identityKey);
      if (!existing) {
        return {
          status: 'missing',
          record: null,
          diagnostics: [
            {
              code: 'VERSION_APPLIED_SYNC_UPDATE_NOT_FOUND',
              message: 'Applied sync update identity was not found.',
              recoverability: 'repair',
            },
          ],
        };
      }
      if (existing.payloadHash !== input.payloadHash) {
        return conflictComplete(
          existing,
          'Applied sync update completion did not match the stored payload hash.',
        );
      }
      if (existing.terminal) {
        if (appliedSyncUpdateIdentityTerminalsEqual(existing.terminal, input.terminal)) {
          return { status: 'completed', record: existing, diagnostics: [] };
        }
        if (existing.state !== 'retryable') {
          return conflictComplete(
            existing,
            'Applied sync update identity is already finalized with different terminal metadata.',
          );
        }
      }

      const completed: AppliedSyncUpdateIdentityRecord = {
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
            message: 'IndexedDB applied sync update identity completion failed.',
            recoverability: 'retry',
          },
        ],
      };
    }
  }

  private async findByIdentityKey(
    identityKey: AppliedSyncUpdateIdentityKey,
  ): Promise<AppliedSyncUpdateIdentityRecord | null> {
    const db = await this.getDb();
    const row = await idbRequest<unknown | undefined>(
      db
        .transaction(INTENTS_STORE, 'readonly')
        .objectStore(INTENTS_STORE)
        .get(appliedSyncUpdateIdentityStorageKey(this.documentScope, identityKey)),
    );
    return decodeStoredAppliedSyncUpdateIdentity(row, this.documentScopeKey, identityKey);
  }

  private async putRecord(record: AppliedSyncUpdateIdentityRecord): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(INTENTS_STORE, 'readwrite');
    const done = idbTransactionDone(tx);
    await idbRequest(
      tx
        .objectStore(INTENTS_STORE)
        .put(
          storedAppliedSyncUpdateIdentity(record),
          appliedSyncUpdateIdentityStorageKey(this.documentScope, record.identityKey),
        ),
    );
    await done;
  }

  private async recordFromInput(
    input: ReserveAppliedSyncUpdateIdentityInput,
  ): Promise<AppliedSyncUpdateIdentityRecord> {
    const collaboration = input.operationContext.collaboration;
    if (!collaboration) {
      throw new Error('missing collaboration context');
    }
    const keyMaterial = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
      input.operationContext,
    );
    if (input.identityKey !== keyMaterial.identityKey) {
      throw new Error('Applied sync update identity key does not match operation context.');
    }
    return cloneAppliedSyncUpdateIdentityRecord({
      schemaVersion: 1,
      recordKind: 'appliedSyncUpdateIdentity',
      identityKey: input.identityKey,
      documentScopeKey: this.documentScopeKey,
      identity: keyMaterial.identity,
      payloadHash: collaboration.payloadHash,
      operationContext: input.operationContext,
      state: 'reserved',
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }
}

function storedAppliedSyncUpdateIdentity(
  record: AppliedSyncUpdateIdentityRecord,
): StoredAppliedSyncUpdateIdentity {
  return {
    schemaVersion: 1,
    documentScopeKey: record.documentScopeKey,
    operation: 'applied-sync-update-identity',
    record: cloneJson(record),
  };
}

function decodeStoredAppliedSyncUpdateIdentity(
  value: unknown,
  documentScopeKey: string,
  identityKey: AppliedSyncUpdateIdentityKey,
): AppliedSyncUpdateIdentityRecord | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.operation !== 'applied-sync-update-identity'
  ) {
    return null;
  }
  if (value.documentScopeKey !== documentScopeKey) {
    return null;
  }
  const record = value.record;
  if (!isAppliedSyncUpdateIdentityRecord(record)) {
    return null;
  }
  if (record.documentScopeKey !== documentScopeKey || record.identityKey !== identityKey) {
    return null;
  }
  return cloneJson(record);
}

function conflictReserve(
  record: AppliedSyncUpdateIdentityRecord,
  message: string,
): Extract<AppliedSyncUpdateIdentityReserveResult, { status: 'conflict' }> {
  return {
    status: 'conflict',
    record,
    diagnostics: [
      { code: 'VERSION_APPLIED_SYNC_UPDATE_CONFLICT', message, recoverability: 'none' },
    ],
  };
}

function conflictComplete(
  record: AppliedSyncUpdateIdentityRecord,
  message: string,
): {
  readonly status: 'conflict';
  readonly record: AppliedSyncUpdateIdentityRecord;
  readonly diagnostics: readonly {
    readonly code: 'VERSION_APPLIED_SYNC_UPDATE_CONFLICT';
    readonly message: string;
    readonly recoverability: 'none';
  }[];
} {
  return {
    status: 'conflict',
    record,
    diagnostics: [
      { code: 'VERSION_APPLIED_SYNC_UPDATE_CONFLICT', message, recoverability: 'none' },
    ],
  };
}

function missingRead(message: string): AppliedSyncUpdateIdentityReadResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [
      { code: 'VERSION_APPLIED_SYNC_UPDATE_NOT_FOUND', message, recoverability: 'repair' },
    ],
  };
}

function failedRead(message: string): AppliedSyncUpdateIdentityReadResult {
  return {
    status: 'failed',
    record: null,
    diagnostics: [{ code: 'VERSION_PROVIDER_FAILED', message, recoverability: 'retry' }],
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
