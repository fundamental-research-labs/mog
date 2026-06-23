import type {
  VersionOperationContext,
  VersionSyncOperationContext,
} from '@mog-sdk/contracts/versioning';

import type { ObjectDigest } from './object-digest';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import {
  syncBatchStatusIdentityForOperationContext,
  syncBatchStatusKeyMaterialForOperationContext,
} from './sync-batch-status-identity';
import {
  cloneSyncBatchStatusRecord,
  completeSyncBatchStatusRecord,
  syncBatchCompletionIdentityConflicts,
  syncBatchStatusPendingBacklogSemanticsForReason,
  syncBatchStatusPendingBacklogSemanticsForRecord,
  syncBatchStatusRecordFromReserveInput,
  syncBatchStatusRecordStorageKey,
  syncBatchStatusReservationsEquivalent,
  syncBatchStatusStorageKey,
  syncBatchStatusTerminalsEqual,
} from './sync-batch-status-record-codec';
import {
  conflictCompleteSyncBatchStatusResult,
  conflictReserveSyncBatchStatusResult,
  failedReserveSyncBatchStatusResult,
  missingSyncBatchStatusCompleteResult,
  missingSyncBatchStatusReadResult,
} from './sync-batch-status-store-results';

export {
  cloneSyncBatchStatusRecord,
  syncBatchStatusIdentityForOperationContext,
  syncBatchStatusKeyMaterialForOperationContext,
  syncBatchStatusPendingBacklogSemanticsForReason,
  syncBatchStatusPendingBacklogSemanticsForRecord,
  syncBatchStatusReservationsEquivalent,
  syncBatchStatusStorageKey,
  syncBatchStatusTerminalsEqual,
};

export {
  isSyncBatchStatusRecord,
  normalizeSyncBatchStatusRecord,
} from './sync-batch-status-record-codec';

export type SyncBatchStatusId = `sync-batch-status:sha256:${string}`;

export type SyncBatchStatusState =
  | 'pending'
  | 'complete'
  | 'failedAfterMutation'
  | 'dropped'
  | 'rejected';

export type SyncBatchStatusPendingBacklogReason =
  | 'pending'
  | 'complete'
  | 'failedAfterMutation'
  | 'terminalDropped'
  | 'terminalRejected'
  | 'blockedBatchFailure'
  | 'missing'
  | 'reservationConflict'
  | 'reservationFailure'
  | 'providerFailure';

export type SyncBatchStatusPendingBacklogSemantics = {
  readonly pendingForCheckout: boolean;
  readonly backlogForAdmission: boolean;
  readonly reason: SyncBatchStatusPendingBacklogReason;
};

export type SyncBatchStatusIdentityInput = {
  readonly batchId?: string;
  readonly orderedSubUpdatePayloadHashes?: readonly string[];
  readonly subUpdateCount?: number;
};

export type SyncBatchStatusIdentity = {
  readonly schemaVersion: 1;
  readonly originKind: VersionSyncOperationContext['originKind'];
  readonly stableOriginId: string;
  readonly epoch: string;
  readonly batchId: string;
  readonly payloadHash: string;
  readonly orderedSubUpdatePayloadHashes?: readonly string[];
  readonly subUpdateCount?: number;
};

export type SyncBatchStatusOperationContext = VersionOperationContext & {
  readonly collaboration: VersionSyncOperationContext;
};

export type SyncBatchStatusTerminal =
  | {
      readonly status: 'complete';
      readonly diagnosticDigest?: ObjectDigest;
    }
  | {
      readonly status: 'failedAfterMutation' | 'dropped' | 'rejected';
      readonly reason: string;
      readonly diagnosticDigest?: ObjectDigest;
    };

export type SyncBatchStatusRecord = {
  readonly schemaVersion: 1;
  readonly recordKind: 'syncBatchStatus';
  readonly batchStatusId: SyncBatchStatusId;
  readonly documentScopeKey: string;
  readonly sourceKind: VersionSyncOperationContext['sourceKind'];
  readonly identity: SyncBatchStatusIdentity;
  readonly operationContext: SyncBatchStatusOperationContext;
  readonly state: SyncBatchStatusState;
  readonly pendingBacklogSemantics: SyncBatchStatusPendingBacklogSemantics;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly terminal?: SyncBatchStatusTerminal;
};

export type ReserveSyncBatchStatusInput = SyncBatchStatusIdentityInput & {
  readonly batchStatusId: SyncBatchStatusId;
  readonly operationContext: SyncBatchStatusOperationContext;
  readonly createdAt: string;
};

export type CompleteSyncBatchStatusInput = {
  readonly batchStatusId: SyncBatchStatusId;
  readonly payloadHash: string;
  readonly orderedSubUpdatePayloadHashes?: readonly string[];
  readonly subUpdateCount?: number;
  readonly completedAt: string;
  readonly terminal: SyncBatchStatusTerminal;
};

export type SyncBatchStatusStoreDiagnostic = {
  readonly code:
    | 'VERSION_INVALID_OPTIONS'
    | 'VERSION_SYNC_BATCH_STATUS_CONFLICT'
    | 'VERSION_SYNC_BATCH_STATUS_NOT_FOUND'
    | 'VERSION_PROVIDER_FAILED';
  readonly message: string;
  readonly recoverability: 'retry' | 'repair' | 'none';
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type SyncBatchStatusReadResult =
  | {
      readonly status: 'found';
      readonly record: SyncBatchStatusRecord;
      readonly pendingBacklogSemantics: SyncBatchStatusPendingBacklogSemantics;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing';
      readonly record: null;
      readonly pendingBacklogSemantics: SyncBatchStatusPendingBacklogSemantics;
      readonly diagnostics: readonly SyncBatchStatusStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly record: null;
      readonly pendingBacklogSemantics?: SyncBatchStatusPendingBacklogSemantics;
      readonly diagnostics: readonly SyncBatchStatusStoreDiagnostic[];
    };

export type SyncBatchStatusReserveResult =
  | {
      readonly status: 'reserved' | 'existing' | 'duplicate';
      readonly record: SyncBatchStatusRecord;
      readonly pendingBacklogSemantics: SyncBatchStatusPendingBacklogSemantics;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'conflict';
      readonly record: SyncBatchStatusRecord;
      readonly pendingBacklogSemantics: SyncBatchStatusPendingBacklogSemantics;
      readonly diagnostics: readonly SyncBatchStatusStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly record: null;
      readonly pendingBacklogSemantics: SyncBatchStatusPendingBacklogSemantics;
      readonly diagnostics: readonly SyncBatchStatusStoreDiagnostic[];
    };

export type SyncBatchStatusCompleteResult =
  | {
      readonly status: 'completed';
      readonly record: SyncBatchStatusRecord;
      readonly pendingBacklogSemantics: SyncBatchStatusPendingBacklogSemantics;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing' | 'conflict' | 'failed';
      readonly record: SyncBatchStatusRecord | null;
      readonly pendingBacklogSemantics: SyncBatchStatusPendingBacklogSemantics;
      readonly diagnostics: readonly SyncBatchStatusStoreDiagnostic[];
    };

export interface SyncBatchStatusStore {
  readonly documentScope: VersionDocumentScope;
  reserveBatchStatus(input: ReserveSyncBatchStatusInput): Promise<SyncBatchStatusReserveResult>;
  readByBatchStatusId(batchStatusId: SyncBatchStatusId): Promise<SyncBatchStatusReadResult>;
  completeBatchStatus(input: CompleteSyncBatchStatusInput): Promise<SyncBatchStatusCompleteResult>;
}

export type SyncBatchStatusStoreProvider = {
  openSyncBatchStatusStore(): Promise<SyncBatchStatusStore>;
};

export function hasSyncBatchStatusStoreProvider(
  value: unknown,
): value is SyncBatchStatusStoreProvider {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly openSyncBatchStatusStore?: unknown };
  return typeof candidate.openSyncBatchStatusStore === 'function';
}

export type SyncBatchStatusKeyMaterial = {
  readonly identity: SyncBatchStatusIdentity;
  readonly batchStatusId: SyncBatchStatusId;
};

export type SyncBatchStatusMemoryBackendSnapshot = {
  readonly records: readonly SyncBatchStatusRecord[];
};

export class SyncBatchStatusMemoryBackend {
  private readonly recordsByKey = new Map<string, SyncBatchStatusRecord>();

  get(
    documentScope: VersionDocumentScope,
    batchStatusId: SyncBatchStatusId,
  ): SyncBatchStatusRecord | undefined {
    return cloneSyncBatchStatusRecord(
      this.recordsByKey.get(syncBatchStatusStorageKey(documentScope, batchStatusId)),
    );
  }

  put(record: SyncBatchStatusRecord): void {
    this.recordsByKey.set(
      syncBatchStatusRecordStorageKey(record),
      cloneSyncBatchStatusRecord(record),
    );
  }

  exportSnapshot(): SyncBatchStatusMemoryBackendSnapshot {
    return {
      records: [...this.recordsByKey.values()].map((record) => cloneSyncBatchStatusRecord(record)),
    };
  }

  static fromSnapshot(
    snapshot: SyncBatchStatusMemoryBackendSnapshot,
  ): SyncBatchStatusMemoryBackend {
    const backend = new SyncBatchStatusMemoryBackend();
    for (const record of snapshot.records) backend.put(record);
    return backend;
  }
}

export class InMemorySyncBatchStatusStore implements SyncBatchStatusStore {
  readonly documentScope: VersionDocumentScope;

  private readonly backend: SyncBatchStatusMemoryBackend;
  private readonly documentScopeKey: string;

  constructor(options: {
    readonly documentScope: VersionDocumentScope;
    readonly backend: SyncBatchStatusMemoryBackend;
  }) {
    this.documentScope = normalizeVersionDocumentScope(options.documentScope);
    this.documentScopeKey = versionDocumentScopeKey(this.documentScope);
    this.backend = options.backend;
  }

  async reserveBatchStatus(
    input: ReserveSyncBatchStatusInput,
  ): Promise<SyncBatchStatusReserveResult> {
    let record: SyncBatchStatusRecord;
    try {
      record = await syncBatchStatusRecordFromReserveInput(input, this.documentScopeKey);
    } catch {
      return failedReserveSyncBatchStatusResult(
        'Sync batch status reservation has invalid sync batch identity.',
      );
    }

    const existing = this.backend.get(this.documentScope, input.batchStatusId);
    if (existing) {
      return syncBatchStatusReservationsEquivalent(existing, record)
        ? {
            status: existing.state === 'complete' ? 'duplicate' : 'existing',
            record: existing,
            pendingBacklogSemantics: existing.pendingBacklogSemantics,
            diagnostics: [],
          }
        : conflictReserveSyncBatchStatusResult(
            existing,
            'Sync batch status id is already bound to a different batch identity.',
          );
    }

    this.backend.put(record);
    return {
      status: 'reserved',
      record,
      pendingBacklogSemantics: record.pendingBacklogSemantics,
      diagnostics: [],
    };
  }

  async readByBatchStatusId(batchStatusId: SyncBatchStatusId): Promise<SyncBatchStatusReadResult> {
    const record = this.backend.get(this.documentScope, batchStatusId);
    return record
      ? {
          status: 'found',
          record,
          pendingBacklogSemantics: record.pendingBacklogSemantics,
          diagnostics: [],
        }
      : missingSyncBatchStatusReadResult('Sync batch status was not found.');
  }

  async completeBatchStatus(
    input: CompleteSyncBatchStatusInput,
  ): Promise<SyncBatchStatusCompleteResult> {
    const existing = this.backend.get(this.documentScope, input.batchStatusId);
    if (!existing) {
      return missingSyncBatchStatusCompleteResult();
    }
    if (syncBatchCompletionIdentityConflicts(existing, input)) {
      return conflictCompleteSyncBatchStatusResult(
        existing,
        'Sync batch status completion did not match the stored batch identity.',
      );
    }
    if (existing.terminal) {
      return syncBatchStatusTerminalsEqual(existing.terminal, input.terminal)
        ? {
            status: 'completed',
            record: existing,
            pendingBacklogSemantics: existing.pendingBacklogSemantics,
            diagnostics: [],
          }
        : conflictCompleteSyncBatchStatusResult(
            existing,
            'Sync batch status is already finalized with different terminal metadata.',
          );
    }

    const completed = completeSyncBatchStatusRecord(existing, input);
    this.backend.put(completed);
    return {
      status: 'completed',
      record: completed,
      pendingBacklogSemantics: completed.pendingBacklogSemantics,
      diagnostics: [],
    };
  }
}
