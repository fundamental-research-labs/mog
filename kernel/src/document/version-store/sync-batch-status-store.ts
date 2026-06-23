import type {
  VersionOperationContext,
  VersionSyncOperationContext,
} from '@mog-sdk/contracts/versioning';

import { isObjectDigest, type ObjectDigest } from './object-digest';
import { objectDigestFor } from './merge-apply-intent-store';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';

export type SyncBatchStatusId = `sync-batch-status:sha256:${string}`;

export type SyncBatchStatusState =
  | 'pending'
  | 'complete'
  | 'failedAfterMutation'
  | 'dropped'
  | 'rejected';

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

type SyncBatchStatusHighWaterIdentity = Omit<SyncBatchStatusIdentity, 'payloadHash'>;

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
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing';
      readonly record: null;
      readonly diagnostics: readonly SyncBatchStatusStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly record: null;
      readonly diagnostics: readonly SyncBatchStatusStoreDiagnostic[];
    };

export type SyncBatchStatusReserveResult =
  | {
      readonly status: 'reserved' | 'existing' | 'duplicate';
      readonly record: SyncBatchStatusRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'conflict';
      readonly record: SyncBatchStatusRecord;
      readonly diagnostics: readonly SyncBatchStatusStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly record: null;
      readonly diagnostics: readonly SyncBatchStatusStoreDiagnostic[];
    };

export type SyncBatchStatusCompleteResult =
  | {
      readonly status: 'completed';
      readonly record: SyncBatchStatusRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing' | 'conflict' | 'failed';
      readonly record: SyncBatchStatusRecord | null;
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
      this.recordsByKey.get(memoryKey(documentScope, batchStatusId)),
    );
  }

  put(record: SyncBatchStatusRecord): void {
    this.recordsByKey.set(memoryKeyFromRecord(record), cloneSyncBatchStatusRecord(record));
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
      record = await this.recordFromInput(input);
    } catch {
      return failedReserve('Sync batch status reservation has invalid sync batch identity.');
    }

    const existing = this.backend.get(this.documentScope, input.batchStatusId);
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

    this.backend.put(record);
    return { status: 'reserved', record, diagnostics: [] };
  }

  async readByBatchStatusId(batchStatusId: SyncBatchStatusId): Promise<SyncBatchStatusReadResult> {
    const record = this.backend.get(this.documentScope, batchStatusId);
    return record
      ? { status: 'found', record, diagnostics: [] }
      : missingRead('Sync batch status was not found.');
  }

  async completeBatchStatus(
    input: CompleteSyncBatchStatusInput,
  ): Promise<SyncBatchStatusCompleteResult> {
    const existing = this.backend.get(this.documentScope, input.batchStatusId);
    if (!existing) {
      return {
        status: 'missing',
        record: null,
        diagnostics: [
          diagnostic(
            'VERSION_SYNC_BATCH_STATUS_NOT_FOUND',
            'Sync batch status was not found.',
            'repair',
          ),
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
    this.backend.put(completed);
    return { status: 'completed', record: completed, diagnostics: [] };
  }

  private async recordFromInput(
    input: ReserveSyncBatchStatusInput,
  ): Promise<SyncBatchStatusRecord> {
    const collaboration = syncBatchOperationContext(input.operationContext);
    const keyMaterial = await syncBatchStatusKeyMaterialForOperationContext(
      input.operationContext,
      input,
    );
    if (input.batchStatusId !== keyMaterial.batchStatusId) {
      throw new Error('Sync batch status id does not match operation context.');
    }
    return cloneSyncBatchStatusRecord({
      schemaVersion: 1,
      recordKind: 'syncBatchStatus',
      batchStatusId: input.batchStatusId,
      documentScopeKey: this.documentScopeKey,
      sourceKind: collaboration.sourceKind,
      identity: keyMaterial.identity,
      operationContext: sanitizeSyncBatchStatusOperationContext(input.operationContext),
      state: 'pending',
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }
}

export function syncBatchStatusIdentityForOperationContext(
  operationContext: VersionOperationContext,
  input: SyncBatchStatusIdentityInput = {},
): SyncBatchStatusIdentity {
  const collaboration = syncBatchOperationContext(operationContext);
  const batchId = input.batchId ?? collaboration.updateId;
  if (
    !collaboration.stableOriginId ||
    !collaboration.epoch ||
    !batchId ||
    !collaboration.payloadHash
  ) {
    throw new Error(
      'Sync batch status identity requires stable origin id, epoch, batch id, and payload hash.',
    );
  }

  const normalizedSubUpdates = normalizeSubUpdateIdentity(input);
  return {
    schemaVersion: 1,
    originKind: collaboration.originKind,
    stableOriginId: collaboration.stableOriginId,
    epoch: collaboration.epoch,
    batchId,
    payloadHash: collaboration.payloadHash,
    ...(normalizedSubUpdates.orderedSubUpdatePayloadHashes === undefined
      ? {}
      : { orderedSubUpdatePayloadHashes: normalizedSubUpdates.orderedSubUpdatePayloadHashes }),
    ...(normalizedSubUpdates.subUpdateCount === undefined
      ? {}
      : { subUpdateCount: normalizedSubUpdates.subUpdateCount }),
  };
}

export async function syncBatchStatusKeyMaterialForOperationContext(
  operationContext: VersionOperationContext,
  input: SyncBatchStatusIdentityInput = {},
): Promise<SyncBatchStatusKeyMaterial> {
  const identity = syncBatchStatusIdentityForOperationContext(operationContext, input);
  const digest = await objectDigestFor(
    'mog.version.sync-batch-status.high-water-identity.v1',
    syncBatchStatusHighWaterIdentity(identity),
  );
  return {
    identity,
    batchStatusId: `sync-batch-status:sha256:${digest.digest}`,
  };
}

export function cloneSyncBatchStatusRecord(record: SyncBatchStatusRecord): SyncBatchStatusRecord;
export function cloneSyncBatchStatusRecord(record: undefined): undefined;
export function cloneSyncBatchStatusRecord(
  record: SyncBatchStatusRecord | undefined,
): SyncBatchStatusRecord | undefined;
export function cloneSyncBatchStatusRecord(
  record: SyncBatchStatusRecord | undefined,
): SyncBatchStatusRecord | undefined {
  if (record === undefined) return undefined;
  const cloned = cloneJson(record);
  return {
    ...cloned,
    operationContext: sanitizeSyncBatchStatusOperationContext(cloned.operationContext),
  };
}

export function syncBatchStatusReservationsEquivalent(
  left: SyncBatchStatusRecord,
  right: SyncBatchStatusRecord,
): boolean {
  return (
    canonicalJsonStringify(syncBatchStatusReservationIdentity(left)) ===
    canonicalJsonStringify(syncBatchStatusReservationIdentity(right))
  );
}

export function syncBatchStatusTerminalsEqual(
  left: SyncBatchStatusTerminal,
  right: SyncBatchStatusTerminal,
): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export function syncBatchStatusStorageKey(
  documentScope: VersionDocumentScope,
  batchStatusId: SyncBatchStatusId,
): string {
  return memoryKey(documentScope, batchStatusId);
}

export function hasSyncBatchStatusStoreProvider(
  value: unknown,
): value is SyncBatchStatusStoreProvider {
  return isRecord(value) && typeof value.openSyncBatchStatusStore === 'function';
}

export function isSyncBatchStatusRecord(value: unknown): value is SyncBatchStatusRecord {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (value.recordKind !== 'syncBatchStatus') return false;
  if (
    typeof value.batchStatusId !== 'string' ||
    !/^sync-batch-status:sha256:[0-9a-f]{64}$/.test(value.batchStatusId)
  ) {
    return false;
  }
  if (typeof value.documentScopeKey !== 'string') return false;
  if (typeof value.sourceKind !== 'string') return false;
  if (!isSyncBatchStatusIdentity(value.identity)) return false;
  if (!isSyncBatchOperationContext(value.operationContext)) return false;
  if (!syncBatchStatusIdentityMatchesOperationContext(value.identity, value.operationContext)) {
    return false;
  }
  if (!isSanitizedSyncBatchStatusCollaboration(value.operationContext.collaboration)) return false;
  if (!isSyncBatchStatusState(value.state)) return false;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (value.state === 'pending') return value.terminal === undefined;
  if (!isSyncBatchStatusTerminal(value.terminal)) return false;
  return value.terminal.status === value.state;
}

function syncBatchOperationContext(
  operationContext: VersionOperationContext,
): SyncBatchStatusOperationContext['collaboration'] {
  if (!operationContext.collaboration) {
    throw new Error('Sync batch status operation context must include collaboration.');
  }
  return operationContext.collaboration;
}

function syncBatchStatusHighWaterIdentity(
  identity: SyncBatchStatusIdentity,
): SyncBatchStatusHighWaterIdentity {
  return {
    schemaVersion: identity.schemaVersion,
    originKind: identity.originKind,
    stableOriginId: identity.stableOriginId,
    epoch: identity.epoch,
    batchId: identity.batchId,
    ...(identity.orderedSubUpdatePayloadHashes === undefined
      ? {}
      : { orderedSubUpdatePayloadHashes: identity.orderedSubUpdatePayloadHashes }),
    ...(identity.subUpdateCount === undefined ? {} : { subUpdateCount: identity.subUpdateCount }),
  };
}

function sanitizeSyncBatchStatusOperationContext(
  operationContext: SyncBatchStatusOperationContext,
): SyncBatchStatusOperationContext {
  const collaboration = operationContext.collaboration;
  return cloneJson({
    ...operationContext,
    collaboration: {
      sourceKind: collaboration.sourceKind,
      originKind: collaboration.originKind,
      payloadHash: collaboration.payloadHash,
      trustStatus: collaboration.trustStatus,
      authorState: collaboration.authorState,
      replay: collaboration.replay,
      system: collaboration.system,
      commitGrouping: collaboration.commitGrouping,
      validationDiagnosticCount: collaboration.validationDiagnosticCount,
      ...(collaboration.stableOriginId === undefined
        ? {}
        : { stableOriginId: collaboration.stableOriginId }),
      ...(collaboration.epoch === undefined ? {} : { epoch: collaboration.epoch }),
      ...(collaboration.updateId === undefined ? {} : { updateId: collaboration.updateId }),
      ...(collaboration.roomId === undefined ? {} : { roomId: collaboration.roomId }),
      ...(collaboration.sequence === undefined ? {} : { sequence: collaboration.sequence }),
      ...(collaboration.provenancePayloadHash === undefined
        ? {}
        : { provenancePayloadHash: collaboration.provenancePayloadHash }),
      ...(collaboration.batchId === undefined ? {} : { batchId: collaboration.batchId }),
      ...(collaboration.subUpdateIndex === undefined
        ? {}
        : { subUpdateIndex: collaboration.subUpdateIndex }),
      ...(collaboration.subUpdateCount === undefined
        ? {}
        : { subUpdateCount: collaboration.subUpdateCount }),
      ...(collaboration.batchStatusId === undefined
        ? {}
        : { batchStatusId: collaboration.batchStatusId }),
      ...(collaboration.batchStatusState === undefined
        ? {}
        : { batchStatusState: collaboration.batchStatusState }),
      ...(collaboration.exclusionReason === undefined
        ? {}
        : { exclusionReason: collaboration.exclusionReason }),
      ...(collaboration.exclusionSubreason === undefined
        ? {}
        : { exclusionSubreason: collaboration.exclusionSubreason }),
    },
  });
}

function syncBatchStatusIdentityMatchesOperationContext(
  identity: SyncBatchStatusIdentity,
  operationContext: SyncBatchStatusOperationContext,
): boolean {
  const collaboration = operationContext.collaboration;
  const batchId = collaboration.batchId ?? identity.batchId;
  return (
    identity.originKind === collaboration.originKind &&
    identity.stableOriginId === collaboration.stableOriginId &&
    identity.epoch === collaboration.epoch &&
    identity.batchId === batchId &&
    identity.payloadHash === collaboration.payloadHash
  );
}

function isSanitizedSyncBatchStatusCollaboration(
  collaboration: VersionSyncOperationContext,
): boolean {
  return (
    collaboration.providerId === undefined &&
    collaboration.providerKind === undefined &&
    collaboration.authorityRef === undefined &&
    collaboration.remoteSessionId === undefined &&
    collaboration.correlationId === undefined &&
    collaboration.causationIds === undefined
  );
}

function normalizeSubUpdateIdentity(input: SyncBatchStatusIdentityInput): {
  readonly orderedSubUpdatePayloadHashes?: readonly string[];
  readonly subUpdateCount?: number;
} {
  const ordered =
    input.orderedSubUpdatePayloadHashes === undefined
      ? undefined
      : [...input.orderedSubUpdatePayloadHashes];
  if (
    ordered !== undefined &&
    !ordered.every((hash) => typeof hash === 'string' && hash.length > 0)
  ) {
    throw new Error('Sync batch status sub-update hashes must be non-empty strings.');
  }
  if (
    input.subUpdateCount !== undefined &&
    (!Number.isInteger(input.subUpdateCount) || input.subUpdateCount < 0)
  ) {
    throw new Error('Sync batch status sub-update count must be a non-negative integer.');
  }
  if (
    ordered !== undefined &&
    input.subUpdateCount !== undefined &&
    ordered.length !== input.subUpdateCount
  ) {
    throw new Error('Sync batch status sub-update count must match ordered sub-update hashes.');
  }
  return {
    ...(ordered === undefined ? {} : { orderedSubUpdatePayloadHashes: Object.freeze(ordered) }),
    ...(input.subUpdateCount === undefined && ordered === undefined
      ? {}
      : { subUpdateCount: input.subUpdateCount ?? ordered?.length ?? 0 }),
  };
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

function isSyncBatchStatusIdentity(value: unknown): value is SyncBatchStatusIdentity {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  return (
    typeof value.originKind === 'string' &&
    typeof value.stableOriginId === 'string' &&
    typeof value.epoch === 'string' &&
    typeof value.batchId === 'string' &&
    typeof value.payloadHash === 'string' &&
    optionalStringArray(value.orderedSubUpdatePayloadHashes) &&
    optionalNonNegativeInteger(value.subUpdateCount)
  );
}

function isSyncBatchOperationContext(value: unknown): value is SyncBatchStatusOperationContext {
  if (!isRecord(value) || !isRecord(value.collaboration)) return false;
  return (
    typeof value.operationId === 'string' &&
    typeof value.kind === 'string' &&
    isRecord(value.author) &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.domainIds) &&
    typeof value.capturePolicy === 'string' &&
    typeof value.writeAdmissionMode === 'string' &&
    typeof value.collaboration.sourceKind === 'string' &&
    typeof value.collaboration.originKind === 'string' &&
    typeof value.collaboration.payloadHash === 'string'
  );
}

function isSyncBatchStatusState(value: unknown): value is SyncBatchStatusState {
  return (
    value === 'pending' ||
    value === 'complete' ||
    value === 'failedAfterMutation' ||
    value === 'dropped' ||
    value === 'rejected'
  );
}

function isSyncBatchStatusTerminal(value: unknown): value is SyncBatchStatusTerminal {
  if (!isRecord(value)) return false;
  if (value.status === 'complete') {
    return value.diagnosticDigest === undefined || isObjectDigest(value.diagnosticDigest);
  }
  if (
    value.status === 'failedAfterMutation' ||
    value.status === 'dropped' ||
    value.status === 'rejected'
  ) {
    return (
      typeof value.reason === 'string' &&
      (value.diagnosticDigest === undefined || isObjectDigest(value.diagnosticDigest))
    );
  }
  return false;
}

function syncBatchStatusReservationIdentity(record: SyncBatchStatusRecord) {
  return {
    schemaVersion: record.schemaVersion,
    recordKind: record.recordKind,
    batchStatusId: record.batchStatusId,
    documentScopeKey: record.documentScopeKey,
    identity: record.identity,
  };
}

function memoryKey(documentScope: VersionDocumentScope, batchStatusId: SyncBatchStatusId): string {
  return `${versionDocumentScopeKey(documentScope)}\u0000syncBatchStatus\u0000${batchStatusId}`;
}

function memoryKeyFromRecord(record: SyncBatchStatusRecord): string {
  return `${record.documentScopeKey}\u0000syncBatchStatus\u0000${record.batchStatusId}`;
}

function conflictReserve(
  record: SyncBatchStatusRecord,
  message: string,
): Extract<SyncBatchStatusReserveResult, { status: 'conflict' }> {
  return {
    status: 'conflict',
    record,
    diagnostics: [diagnostic('VERSION_SYNC_BATCH_STATUS_CONFLICT', message, 'none')],
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
    diagnostics: [diagnostic('VERSION_SYNC_BATCH_STATUS_CONFLICT', message, 'none')],
  };
}

function failedReserve(
  message: string,
): Extract<SyncBatchStatusReserveResult, { status: 'failed' }> {
  return {
    status: 'failed',
    record: null,
    diagnostics: [diagnostic('VERSION_INVALID_OPTIONS', message, 'none')],
  };
}

function missingRead(message: string): SyncBatchStatusReadResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [diagnostic('VERSION_SYNC_BATCH_STATUS_NOT_FOUND', message, 'repair')],
  };
}

function diagnostic(
  code: SyncBatchStatusStoreDiagnostic['code'],
  message: string,
  recoverability: SyncBatchStatusStoreDiagnostic['recoverability'],
  details?: SyncBatchStatusStoreDiagnostic['details'],
): SyncBatchStatusStoreDiagnostic {
  return details === undefined
    ? { code, message, recoverability }
    : { code, message, recoverability, details };
}

function optionalStringArray(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return (
    value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0)
  );
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
