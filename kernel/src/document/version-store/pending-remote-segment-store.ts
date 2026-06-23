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
import {
  clonePendingRemoteSegmentRecord,
  comparePendingRemoteSegmentRecords,
  pendingRemoteSegmentReservationRecord,
  pendingRemoteSegmentStorageKey,
  pendingRemoteSegmentStorageKeyFromRecord,
  pendingRemoteSegmentTerminalsEqual,
  pendingRemoteSegmentsEquivalent,
} from './pending-remote-segment-codec';
import type {
  CompletePendingRemoteSegmentInput,
  PendingRemoteSegmentCompleteResult,
  PendingRemoteSegmentId,
  PendingRemoteSegmentIdempotencyKey,
  PendingRemoteSegmentListResult,
  PendingRemoteSegmentMemoryBackendSnapshot,
  PendingRemoteSegmentReadResult,
  PendingRemoteSegmentRecord,
  PendingRemoteSegmentReserveResult,
  PendingRemoteSegmentState,
  PendingRemoteSegmentStore,
  PendingRemoteSegmentStoreDiagnostic,
  PendingRemoteSegmentStoreProvider,
  ReservePendingRemoteSegmentInput,
} from './pending-remote-segment-types';

export {
  clonePendingRemoteSegmentRecord,
  comparePendingRemoteSegmentRecords,
  isPendingRemoteSegmentRecord,
  pendingRemoteSegmentReservationRecord,
  pendingRemoteSegmentStorageKey,
  pendingRemoteSegmentTerminalsEqual,
  pendingRemoteSegmentsEquivalent,
} from './pending-remote-segment-codec';
export {
  idempotencyKeyForPendingRemoteSegment,
  pendingRemoteSegmentIdForOperationContext,
  pendingRemoteSegmentIdentityForOperationContext,
  pendingRemoteSegmentKeyMaterialForOperationContext,
} from './pending-remote-segment-keys';
export {
  reservePersistedPendingRemoteSegment,
  validatePendingRemoteSegmentObjects,
} from './pending-remote-segment-validation';
export type {
  CompletePendingRemoteSegmentInput,
  PendingRemoteSegmentCompleteResult,
  PendingRemoteSegmentId,
  PendingRemoteSegmentIdempotencyKey,
  PendingRemoteSegmentKeyMaterial,
  PendingRemoteSegmentListResult,
  PendingRemoteSegmentMemoryBackendSnapshot,
  PendingRemoteSegmentObjectValidationResult,
  PendingRemoteSegmentOperationContext,
  PendingRemoteSegmentReadResult,
  PendingRemoteSegmentRecord,
  PendingRemoteSegmentReservationRecordOptions,
  PendingRemoteSegmentReserveResult,
  PendingRemoteSegmentState,
  PendingRemoteSegmentStore,
  PendingRemoteSegmentStoreDiagnostic,
  PendingRemoteSegmentStoreProvider,
  PendingRemoteSegmentSyncIdentity,
  PendingRemoteSegmentTerminal,
  ReservePendingRemoteSegmentInput,
  ReservePersistedPendingRemoteSegmentOptions,
} from './pending-remote-segment-types';

export class PendingRemoteSegmentMemoryBackend {
  private readonly recordsByKey = new Map<string, PendingRemoteSegmentRecord>();

  get(
    namespace: VersionGraphNamespace,
    idempotencyKey: PendingRemoteSegmentIdempotencyKey,
  ): PendingRemoteSegmentRecord | undefined {
    return clonePendingRemoteSegmentRecord(
      this.recordsByKey.get(pendingRemoteSegmentStorageKey(namespace, idempotencyKey)),
    );
  }

  findBySegmentId(
    namespace: VersionGraphNamespace,
    segmentId: PendingRemoteSegmentId,
  ): PendingRemoteSegmentRecord | undefined {
    const namespaceKey = versionGraphNamespaceKey(namespace);
    for (const record of this.recordsByKey.values()) {
      if (record.namespaceKey === namespaceKey && record.pendingRemoteSegmentId === segmentId) {
        return clonePendingRemoteSegmentRecord(record);
      }
    }
    return undefined;
  }

  listByState(
    namespace: VersionGraphNamespace,
    documentScopeKey: string,
    state: PendingRemoteSegmentState,
  ): readonly PendingRemoteSegmentRecord[] {
    const namespaceKey = versionGraphNamespaceKey(namespace);
    return [...this.recordsByKey.values()]
      .filter(
        (record) =>
          record.namespaceKey === namespaceKey &&
          record.documentScopeKey === documentScopeKey &&
          record.state === state,
      )
      .sort(comparePendingRemoteSegmentRecords)
      .map((record) => clonePendingRemoteSegmentRecord(record));
  }

  put(record: PendingRemoteSegmentRecord): void {
    this.recordsByKey.set(
      pendingRemoteSegmentStorageKeyFromRecord(record),
      clonePendingRemoteSegmentRecord(record),
    );
  }

  exportSnapshot(): PendingRemoteSegmentMemoryBackendSnapshot {
    return {
      records: [...this.recordsByKey.values()].map((record) =>
        clonePendingRemoteSegmentRecord(record),
      ),
    };
  }

  static fromSnapshot(
    snapshot: PendingRemoteSegmentMemoryBackendSnapshot,
  ): PendingRemoteSegmentMemoryBackend {
    const backend = new PendingRemoteSegmentMemoryBackend();
    for (const record of snapshot.records) backend.put(record);
    return backend;
  }
}

export class InMemoryPendingRemoteSegmentStore implements PendingRemoteSegmentStore {
  readonly namespace: VersionGraphNamespace;

  private readonly backend: PendingRemoteSegmentMemoryBackend;
  private readonly documentScopeKey: string;
  private readonly namespaceKey: string;

  constructor(options: {
    readonly namespace: VersionGraphNamespace;
    readonly documentScope: VersionDocumentScope;
    readonly backend: PendingRemoteSegmentMemoryBackend;
  }) {
    this.namespace = normalizeVersionGraphNamespace(options.namespace);
    this.namespaceKey = versionGraphNamespaceKey(this.namespace);
    this.documentScopeKey = versionDocumentScopeKey(
      normalizeVersionDocumentScope(options.documentScope),
    );
    this.backend = options.backend;
  }

  async reserveSegment(
    input: ReservePendingRemoteSegmentInput,
  ): Promise<PendingRemoteSegmentReserveResult> {
    let record: PendingRemoteSegmentRecord;
    try {
      record = await this.recordFromInput(input);
    } catch {
      return failedReserve('Pending remote segment reservation has invalid sync context.');
    }

    const existingByKey = this.backend.get(this.namespace, input.idempotencyKey);
    if (existingByKey) {
      return pendingRemoteSegmentsEquivalent(existingByKey, record)
        ? { status: 'existing', record: existingByKey, diagnostics: [] }
        : conflictReserve(
            existingByKey,
            'Pending remote idempotency key is already bound to a different segment.',
          );
    }

    const existingBySegmentId = this.backend.findBySegmentId(
      this.namespace,
      input.pendingRemoteSegmentId,
    );
    if (existingBySegmentId) {
      return pendingRemoteSegmentsEquivalent(existingBySegmentId, record)
        ? { status: 'existing', record: existingBySegmentId, diagnostics: [] }
        : conflictReserve(
            existingBySegmentId,
            'Pending remote segment id is already bound to a different reservation.',
          );
    }

    this.backend.put(record);
    return { status: 'created', record, diagnostics: [] };
  }

  async readBySegmentId(
    segmentId: PendingRemoteSegmentId,
  ): Promise<PendingRemoteSegmentReadResult> {
    const record = this.backend.findBySegmentId(this.namespace, segmentId);
    return record
      ? { status: 'found', record, diagnostics: [] }
      : missingRead('Pending remote segment was not found by segment id.');
  }

  async readByIdempotencyKey(
    idempotencyKey: PendingRemoteSegmentIdempotencyKey,
  ): Promise<PendingRemoteSegmentReadResult> {
    const record = this.backend.get(this.namespace, idempotencyKey);
    return record
      ? { status: 'found', record, diagnostics: [] }
      : missingRead('Pending remote segment was not found by idempotency key.');
  }

  async listByState(state: PendingRemoteSegmentState): Promise<PendingRemoteSegmentListResult> {
    return {
      status: 'success',
      records: this.backend.listByState(this.namespace, this.documentScopeKey, state),
      diagnostics: [],
    };
  }

  async completeSegment(
    input: CompletePendingRemoteSegmentInput,
  ): Promise<PendingRemoteSegmentCompleteResult> {
    const existing = this.backend.findBySegmentId(this.namespace, input.pendingRemoteSegmentId);
    if (!existing) {
      return {
        status: 'missing',
        record: null,
        diagnostics: [
          diagnostic(
            'VERSION_PENDING_REMOTE_NOT_FOUND',
            'Pending remote segment was not found.',
            'repair',
          ),
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
    this.backend.put(completed);
    return { status: 'completed', record: completed, diagnostics: [] };
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

export function hasPendingRemoteSegmentStoreProvider(
  value: unknown,
): value is PendingRemoteSegmentStoreProvider {
  return isRecord(value) && typeof value.openPendingRemoteSegmentStore === 'function';
}

function conflictReserve(
  record: PendingRemoteSegmentRecord,
  message: string,
): Extract<PendingRemoteSegmentReserveResult, { status: 'conflict' }> {
  return {
    status: 'conflict',
    record,
    diagnostics: [diagnostic('VERSION_PENDING_REMOTE_CONFLICT', message, 'none')],
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
    diagnostics: [diagnostic('VERSION_PENDING_REMOTE_CONFLICT', message, 'none')],
  };
}

function failedReserve(
  message: string,
): Extract<PendingRemoteSegmentReserveResult, { status: 'failed' }> {
  return {
    status: 'failed',
    record: null,
    diagnostics: [diagnostic('VERSION_INVALID_OPTIONS', message, 'none')],
  };
}

function missingRead(message: string): PendingRemoteSegmentReadResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [diagnostic('VERSION_PENDING_REMOTE_NOT_FOUND', message, 'repair')],
  };
}

function diagnostic(
  code: PendingRemoteSegmentStoreDiagnostic['code'],
  message: string,
  recoverability: PendingRemoteSegmentStoreDiagnostic['recoverability'],
  details?: PendingRemoteSegmentStoreDiagnostic['details'],
): PendingRemoteSegmentStoreDiagnostic {
  return details === undefined
    ? { code, message, recoverability }
    : { code, message, recoverability, details };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
