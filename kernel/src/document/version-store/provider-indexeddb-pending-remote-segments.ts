import {
  type CompletePendingRemoteSegmentInput,
  type PendingRemoteSegmentCompleteResult,
  type PendingRemoteSegmentId,
  type PendingRemoteSegmentIdempotencyKey,
  type PendingRemoteSegmentListResult,
  type PendingRemoteSegmentReadResult,
  type PendingRemoteSegmentRecord,
  type PendingRemoteSegmentReserveResult,
  type PendingRemoteSegmentState,
  type PendingRemoteSegmentStore,
  type ReservePendingRemoteSegmentInput,
  pendingRemoteSegmentReservationRecord,
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
import { cloneJson, idbRequest, idbTransactionDone } from './provider-indexeddb/internal';
import {
  decodeStoredPendingRemoteSegment,
  storedPendingRemoteSegment,
} from './provider-indexeddb-pending-remote-segments-codec';
import {
  findBySegmentIdInStore,
  findByStateInStore,
} from './provider-indexeddb-pending-remote-segments-queries';
import {
  conflictComplete,
  conflictReserve,
  failedComplete,
  failedList,
  failedRead,
  failedReserve,
  invalidReservation,
  missingComplete,
  missingRead,
} from './provider-indexeddb-pending-remote-segments-results';

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
      record = await this.recordFromInput(input);
    } catch {
      return invalidReservation('Pending remote segment reservation has invalid sync context.');
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
      return failedReserve('IndexedDB pending remote segment write failed.');
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

  async listByState(state: PendingRemoteSegmentState): Promise<PendingRemoteSegmentListResult> {
    try {
      const records = await this.findByState(state);
      return { status: 'success', records, diagnostics: [] };
    } catch {
      return failedList('IndexedDB pending remote segment list failed.');
    }
  }

  async completeSegment(
    input: CompletePendingRemoteSegmentInput,
  ): Promise<PendingRemoteSegmentCompleteResult> {
    try {
      const existing = await this.findBySegmentId(input.pendingRemoteSegmentId);
      if (!existing) {
        return missingComplete('Pending remote segment was not found.');
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
      return failedComplete('IndexedDB pending remote segment completion failed.');
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

  private async findByState(
    state: PendingRemoteSegmentState,
  ): Promise<readonly PendingRemoteSegmentRecord[]> {
    const db = await this.getDb();
    const tx = db.transaction(INTENTS_STORE, 'readonly');
    const done = idbTransactionDone(tx);
    const records = await findByStateInStore(
      tx.objectStore(INTENTS_STORE),
      this.namespaceKey,
      this.documentScopeKey,
      state,
    );
    await done;
    return records;
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

  private recordFromInput(
    input: ReservePendingRemoteSegmentInput,
  ): Promise<PendingRemoteSegmentRecord> {
    return pendingRemoteSegmentReservationRecord({
      namespaceKey: this.namespaceKey,
      documentScopeKey: this.documentScopeKey,
      input,
    });
  }
}
