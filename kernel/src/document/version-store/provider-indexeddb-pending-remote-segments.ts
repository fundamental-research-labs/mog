import {
  type CompletePendingRemoteSegmentInput,
  type PendingRemoteSegmentCompleteResult,
  type PendingRemoteSegmentId,
  type PendingRemoteSegmentIdempotencyKey,
  type PendingRemoteSegmentReadResult,
  type PendingRemoteSegmentRecord,
  type PendingRemoteSegmentReserveResult,
  type PendingRemoteSegmentStoreDiagnostic,
  type PendingRemoteSegmentStore,
  type ReservePendingRemoteSegmentInput,
  clonePendingRemoteSegmentRecord,
  isPendingRemoteSegmentRecord,
  pendingRemoteSegmentIdentityForOperationContext,
  pendingRemoteSegmentStorageKey,
  pendingRemoteSegmentTerminalsEqual,
  pendingRemoteSegmentsEquivalent,
} from './pending-remote-segment-store';
import { objectDigestsEqual } from './merge-apply-intent-store';
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
import { cloneJson, idbRequest, idbTransactionDone } from './provider-indexeddb-internal';

type StoredPendingRemoteSegment = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly operation: 'pending-remote-segment';
  readonly record: PendingRemoteSegmentRecord;
};

export class IndexedDbPendingRemoteSegmentStore implements PendingRemoteSegmentStore {
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

  async reserveSegment(
    input: ReservePendingRemoteSegmentInput,
  ): Promise<PendingRemoteSegmentReserveResult> {
    let record: PendingRemoteSegmentRecord;
    try {
      record = this.recordFromInput(input);
    } catch {
      return {
        status: 'failed',
        record: null,
        diagnostics: [
          {
            code: 'VERSION_INVALID_OPTIONS',
            message: 'Pending remote segment reservation has invalid sync context.',
            recoverability: 'none',
          },
        ],
      };
    }

    try {
      const existingByKey = await this.findByIdempotencyKey(record.idempotencyKey);
      if (existingByKey) {
        return pendingRemoteSegmentsEquivalent(existingByKey, record)
          ? { status: 'existing', record: existingByKey, diagnostics: [] }
          : conflictReserve(
              existingByKey,
              'Pending remote idempotency key is already bound to a different segment.',
            );
      }

      const existingBySegmentId = await this.findBySegmentId(record.pendingRemoteSegmentId);
      if (existingBySegmentId) {
        return pendingRemoteSegmentsEquivalent(existingBySegmentId, record)
          ? { status: 'existing', record: existingBySegmentId, diagnostics: [] }
          : conflictReserve(
              existingBySegmentId,
              'Pending remote segment id is already bound to a different reservation.',
            );
      }

      await this.putRecord(record);
      return { status: 'created', record, diagnostics: [] };
    } catch {
      return {
        status: 'failed',
        record: null,
        diagnostics: [
          {
            code: 'VERSION_PROVIDER_FAILED',
            message: 'IndexedDB pending remote segment write failed.',
            recoverability: 'retry',
          },
        ],
      };
    }
  }

  async readBySegmentId(
    segmentId: PendingRemoteSegmentId,
  ): Promise<PendingRemoteSegmentReadResult> {
    try {
      const record = await this.findBySegmentId(segmentId);
      return record
        ? { status: 'found', record, diagnostics: [] }
        : missingRead('Pending remote segment was not found by segment id.');
    } catch {
      return failedRead('IndexedDB pending remote segment read failed.');
    }
  }

  async readByIdempotencyKey(
    idempotencyKey: PendingRemoteSegmentIdempotencyKey,
  ): Promise<PendingRemoteSegmentReadResult> {
    try {
      const record = await this.findByIdempotencyKey(idempotencyKey);
      return record
        ? { status: 'found', record, diagnostics: [] }
        : missingRead('Pending remote segment was not found by idempotency key.');
    } catch {
      return failedRead('IndexedDB pending remote segment read failed.');
    }
  }

  async completeSegment(
    input: CompletePendingRemoteSegmentInput,
  ): Promise<PendingRemoteSegmentCompleteResult> {
    try {
      const existing = await this.findBySegmentId(input.pendingRemoteSegmentId);
      if (!existing) {
        return {
          status: 'missing',
          record: null,
          diagnostics: [
            {
              code: 'VERSION_PENDING_REMOTE_NOT_FOUND',
              message: 'Pending remote segment was not found.',
              recoverability: 'repair',
            },
          ],
        };
      }
      if (!objectDigestsEqual(existing.mutationSegmentDigest, input.mutationSegmentDigest)) {
        return conflictComplete(
          existing,
          'Pending remote completion did not match the stored mutation segment digest.',
        );
      }
      if (existing.terminal) {
        return pendingRemoteSegmentTerminalsEqual(existing.terminal, input.terminal)
          ? { status: 'completed', record: existing, diagnostics: [] }
          : conflictComplete(
              existing,
              'Pending remote segment is already finalized with different terminal metadata.',
            );
      }

      const completed: PendingRemoteSegmentRecord = {
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
            message: 'IndexedDB pending remote segment completion failed.',
            recoverability: 'retry',
          },
        ],
      };
    }
  }

  private async findByIdempotencyKey(
    idempotencyKey: PendingRemoteSegmentIdempotencyKey,
  ): Promise<PendingRemoteSegmentRecord | null> {
    const db = await this.getDb();
    const row = await idbRequest<unknown | undefined>(
      db
        .transaction(INTENTS_STORE, 'readonly')
        .objectStore(INTENTS_STORE)
        .get(pendingRemoteSegmentStorageKey(this.namespace, idempotencyKey)),
    );
    return decodeStoredPendingRemoteSegment(row, this.namespaceKey, this.documentScopeKey);
  }

  private async findBySegmentId(
    segmentId: PendingRemoteSegmentId,
  ): Promise<PendingRemoteSegmentRecord | null> {
    const db = await this.getDb();
    const tx = db.transaction(INTENTS_STORE, 'readonly');
    const done = idbTransactionDone(tx);
    const record = await findBySegmentIdInStore(
      tx.objectStore(INTENTS_STORE),
      this.namespaceKey,
      this.documentScopeKey,
      segmentId,
    );
    await done;
    return record;
  }

  private async putRecord(record: PendingRemoteSegmentRecord): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(INTENTS_STORE, 'readwrite');
    const done = idbTransactionDone(tx);
    await idbRequest(
      tx
        .objectStore(INTENTS_STORE)
        .put(
          storedPendingRemoteSegment(record),
          pendingRemoteSegmentStorageKey(this.namespace, record.idempotencyKey),
        ),
    );
    await done;
  }

  private recordFromInput(input: ReservePendingRemoteSegmentInput): PendingRemoteSegmentRecord {
    return clonePendingRemoteSegmentRecord({
      ...input,
      schemaVersion: 1,
      recordKind: 'pendingRemoteSegment',
      namespaceKey: this.namespaceKey,
      documentScopeKey: this.documentScopeKey,
      syncIdentity: pendingRemoteSegmentIdentityForOperationContext(input.operationContext),
      state: 'pending',
      updatedAt: input.createdAt,
    });
  }
}

function storedPendingRemoteSegment(
  record: PendingRemoteSegmentRecord,
): StoredPendingRemoteSegment {
  return {
    schemaVersion: 1,
    namespaceKey: record.namespaceKey,
    documentScopeKey: record.documentScopeKey,
    operation: 'pending-remote-segment',
    record: cloneJson(record),
  };
}

function decodeStoredPendingRemoteSegment(
  value: unknown,
  namespaceKey: string,
  documentScopeKey: string,
): PendingRemoteSegmentRecord | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.operation !== 'pending-remote-segment'
  ) {
    return null;
  }
  if (value.namespaceKey !== namespaceKey || value.documentScopeKey !== documentScopeKey) {
    return null;
  }
  return isPendingRemoteSegmentRecord(value.record) ? cloneJson(value.record) : null;
}

function findBySegmentIdInStore(
  store: IDBObjectStore,
  namespaceKey: string,
  documentScopeKey: string,
  segmentId: PendingRemoteSegmentId,
): Promise<PendingRemoteSegmentRecord | null> {
  return new Promise<PendingRemoteSegmentRecord | null>((resolve, reject) => {
    const request = store.index('namespaceKey').openCursor(IDBKeyRange.only(namespaceKey));
    request.onerror = () =>
      reject(request.error ?? new Error('pending remote segment cursor failed'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(null);
        return;
      }
      const candidate = decodeStoredPendingRemoteSegment(
        cursor.value,
        namespaceKey,
        documentScopeKey,
      );
      if (candidate?.pendingRemoteSegmentId === segmentId) {
        resolve(candidate);
        return;
      }
      cursor.continue();
    };
  });
}

function conflictReserve(
  record: PendingRemoteSegmentRecord,
  message: string,
): Extract<PendingRemoteSegmentReserveResult, { status: 'conflict' }> {
  return {
    status: 'conflict',
    record,
    diagnostics: [{ code: 'VERSION_PENDING_REMOTE_CONFLICT', message, recoverability: 'none' }],
  };
}

function conflictComplete(
  record: PendingRemoteSegmentRecord,
  message: string,
): {
  readonly status: 'conflict';
  readonly record: PendingRemoteSegmentRecord;
  readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
} {
  return {
    status: 'conflict',
    record,
    diagnostics: [{ code: 'VERSION_PENDING_REMOTE_CONFLICT', message, recoverability: 'none' }],
  };
}

function missingRead(message: string): PendingRemoteSegmentReadResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [{ code: 'VERSION_PENDING_REMOTE_NOT_FOUND', message, recoverability: 'repair' }],
  };
}

function failedRead(message: string): PendingRemoteSegmentReadResult {
  return {
    status: 'failed',
    record: null,
    diagnostics: [{ code: 'VERSION_PROVIDER_FAILED', message, recoverability: 'retry' }],
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
