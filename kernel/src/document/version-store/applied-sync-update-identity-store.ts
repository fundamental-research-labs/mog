import type {
  VersionOperationContext,
  VersionSyncOperationContext,
} from '@mog-sdk/contracts/versioning';

import type { ObjectDigest } from './object-digest';
import { isObjectDigest } from './object-digest';
import { objectDigestFor } from './merge-apply-intent-store';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';

export type AppliedSyncUpdateIdentityKey = `applied-sync-update:sha256:${string}`;

export type AppliedSyncUpdateIdentityState =
  | 'reserved'
  | 'applied'
  | 'rejected'
  | 'retryable'
  | 'gapWaiting'
  | 'failedAfterMutation';

export type AppliedSyncUpdateIdentity = {
  readonly schemaVersion: 1;
  readonly originKind: Extract<VersionSyncOperationContext['originKind'], 'provider' | 'room'>;
  readonly stableOriginId: string;
  readonly epoch: string;
  readonly updateId: string;
};

export type AppliedSyncUpdateIdentityOperationContext = VersionOperationContext & {
  readonly collaboration: VersionSyncOperationContext;
};

export type AppliedSyncUpdateIdentityTerminal =
  | {
      readonly status: 'applied';
      readonly pendingRemoteSegmentId?: string;
      readonly mutationSegmentDigest?: ObjectDigest;
    }
  | {
      readonly status: 'rejected' | 'retryable' | 'gapWaiting' | 'failedAfterMutation';
      readonly reason: string;
      readonly diagnosticDigest?: ObjectDigest;
    };

export type AppliedSyncUpdateIdentityRecord = {
  readonly schemaVersion: 1;
  readonly recordKind: 'appliedSyncUpdateIdentity';
  readonly identityKey: AppliedSyncUpdateIdentityKey;
  readonly documentScopeKey: string;
  readonly identity: AppliedSyncUpdateIdentity;
  readonly payloadHash: string;
  readonly operationContext: AppliedSyncUpdateIdentityOperationContext;
  readonly state: AppliedSyncUpdateIdentityState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly terminal?: AppliedSyncUpdateIdentityTerminal;
};

export type ReserveAppliedSyncUpdateIdentityInput = Omit<
  AppliedSyncUpdateIdentityRecord,
  | 'schemaVersion'
  | 'recordKind'
  | 'documentScopeKey'
  | 'identity'
  | 'payloadHash'
  | 'state'
  | 'updatedAt'
  | 'terminal'
>;

export type CompleteAppliedSyncUpdateIdentityInput = {
  readonly identityKey: AppliedSyncUpdateIdentityKey;
  readonly payloadHash: string;
  readonly completedAt: string;
  readonly terminal: AppliedSyncUpdateIdentityTerminal;
};

export type AppliedSyncUpdateIdentityStoreDiagnostic = {
  readonly code:
    | 'VERSION_INVALID_OPTIONS'
    | 'VERSION_APPLIED_SYNC_UPDATE_CONFLICT'
    | 'VERSION_APPLIED_SYNC_UPDATE_NOT_FOUND'
    | 'VERSION_PROVIDER_FAILED';
  readonly message: string;
  readonly recoverability: 'retry' | 'repair' | 'none';
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type AppliedSyncUpdateIdentityReadResult =
  | {
      readonly status: 'found';
      readonly record: AppliedSyncUpdateIdentityRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing';
      readonly record: null;
      readonly diagnostics: readonly AppliedSyncUpdateIdentityStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly record: null;
      readonly diagnostics: readonly AppliedSyncUpdateIdentityStoreDiagnostic[];
    };

export type AppliedSyncUpdateIdentityReserveResult =
  | {
      readonly status: 'reserved' | 'existing' | 'duplicate';
      readonly record: AppliedSyncUpdateIdentityRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'conflict';
      readonly record: AppliedSyncUpdateIdentityRecord;
      readonly diagnostics: readonly AppliedSyncUpdateIdentityStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly record: null;
      readonly diagnostics: readonly AppliedSyncUpdateIdentityStoreDiagnostic[];
    };

export type AppliedSyncUpdateIdentityCompleteResult =
  | {
      readonly status: 'completed';
      readonly record: AppliedSyncUpdateIdentityRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing' | 'conflict' | 'failed';
      readonly record: AppliedSyncUpdateIdentityRecord | null;
      readonly diagnostics: readonly AppliedSyncUpdateIdentityStoreDiagnostic[];
    };

export interface AppliedSyncUpdateIdentityStore {
  readonly documentScope: VersionDocumentScope;
  reserveIdentity(
    input: ReserveAppliedSyncUpdateIdentityInput,
  ): Promise<AppliedSyncUpdateIdentityReserveResult>;
  readByIdentityKey(
    identityKey: AppliedSyncUpdateIdentityKey,
  ): Promise<AppliedSyncUpdateIdentityReadResult>;
  completeIdentity(
    input: CompleteAppliedSyncUpdateIdentityInput,
  ): Promise<AppliedSyncUpdateIdentityCompleteResult>;
}

export type AppliedSyncUpdateIdentityStoreProvider = {
  openAppliedSyncUpdateIdentityStore(): Promise<AppliedSyncUpdateIdentityStore>;
};

export type AppliedSyncUpdateIdentityKeyMaterial = {
  readonly identity: AppliedSyncUpdateIdentity;
  readonly identityKey: AppliedSyncUpdateIdentityKey;
};

export type AppliedSyncUpdateIdentityMemoryBackendSnapshot = {
  readonly records: readonly AppliedSyncUpdateIdentityRecord[];
};

export class AppliedSyncUpdateIdentityMemoryBackend {
  private readonly recordsByKey = new Map<string, AppliedSyncUpdateIdentityRecord>();

  get(
    documentScope: VersionDocumentScope,
    identityKey: AppliedSyncUpdateIdentityKey,
  ): AppliedSyncUpdateIdentityRecord | undefined {
    return cloneAppliedSyncUpdateIdentityRecord(
      this.recordsByKey.get(memoryKey(documentScope, identityKey)),
    );
  }

  put(record: AppliedSyncUpdateIdentityRecord): void {
    this.recordsByKey.set(
      memoryKeyFromRecord(record),
      cloneAppliedSyncUpdateIdentityRecord(record),
    );
  }

  exportSnapshot(): AppliedSyncUpdateIdentityMemoryBackendSnapshot {
    return {
      records: [...this.recordsByKey.values()].map((record) =>
        cloneAppliedSyncUpdateIdentityRecord(record),
      ),
    };
  }

  static fromSnapshot(
    snapshot: AppliedSyncUpdateIdentityMemoryBackendSnapshot,
  ): AppliedSyncUpdateIdentityMemoryBackend {
    const backend = new AppliedSyncUpdateIdentityMemoryBackend();
    for (const record of snapshot.records) backend.put(record);
    return backend;
  }
}

export class InMemoryAppliedSyncUpdateIdentityStore implements AppliedSyncUpdateIdentityStore {
  readonly documentScope: VersionDocumentScope;

  private readonly backend: AppliedSyncUpdateIdentityMemoryBackend;
  private readonly documentScopeKey: string;

  constructor(options: {
    readonly documentScope: VersionDocumentScope;
    readonly backend: AppliedSyncUpdateIdentityMemoryBackend;
  }) {
    this.documentScope = normalizeVersionDocumentScope(options.documentScope);
    this.documentScopeKey = versionDocumentScopeKey(this.documentScope);
    this.backend = options.backend;
  }

  async reserveIdentity(
    input: ReserveAppliedSyncUpdateIdentityInput,
  ): Promise<AppliedSyncUpdateIdentityReserveResult> {
    let record: AppliedSyncUpdateIdentityRecord;
    try {
      record = await this.recordFromInput(input);
    } catch {
      return failedReserve('Applied sync update reservation has invalid identity context.');
    }

    const existing = this.backend.get(this.documentScope, input.identityKey);
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

    this.backend.put(record);
    return { status: 'reserved', record, diagnostics: [] };
  }

  async readByIdentityKey(
    identityKey: AppliedSyncUpdateIdentityKey,
  ): Promise<AppliedSyncUpdateIdentityReadResult> {
    const record = this.backend.get(this.documentScope, identityKey);
    return record
      ? { status: 'found', record, diagnostics: [] }
      : missingRead('Applied sync update identity was not found.');
  }

  async completeIdentity(
    input: CompleteAppliedSyncUpdateIdentityInput,
  ): Promise<AppliedSyncUpdateIdentityCompleteResult> {
    const existing = this.backend.get(this.documentScope, input.identityKey);
    if (!existing) {
      return {
        status: 'missing',
        record: null,
        diagnostics: [
          diagnostic(
            'VERSION_APPLIED_SYNC_UPDATE_NOT_FOUND',
            'Applied sync update identity was not found.',
            'repair',
          ),
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
    this.backend.put(completed);
    return { status: 'completed', record: completed, diagnostics: [] };
  }

  private async recordFromInput(
    input: ReserveAppliedSyncUpdateIdentityInput,
  ): Promise<AppliedSyncUpdateIdentityRecord> {
    const collaboration = appliedSyncOperationContext(input.operationContext);
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

export function appliedSyncUpdateIdentityForOperationContext(
  operationContext: VersionOperationContext,
): AppliedSyncUpdateIdentity {
  const collaboration = appliedSyncOperationContext(operationContext);
  if (collaboration.originKind !== 'provider' && collaboration.originKind !== 'room') {
    throw new Error('Applied sync update identity requires provider or room origin.');
  }
  if (
    !collaboration.stableOriginId ||
    !collaboration.epoch ||
    !collaboration.updateId ||
    !collaboration.payloadHash
  ) {
    throw new Error(
      'Applied sync update identity requires stable origin, epoch, update id, and payload hash.',
    );
  }
  return {
    schemaVersion: 1,
    originKind: collaboration.originKind,
    stableOriginId: collaboration.stableOriginId,
    epoch: collaboration.epoch,
    updateId: collaboration.updateId,
  };
}

export async function appliedSyncUpdateIdentityKeyMaterialForOperationContext(
  operationContext: VersionOperationContext,
): Promise<AppliedSyncUpdateIdentityKeyMaterial> {
  const identity = appliedSyncUpdateIdentityForOperationContext(operationContext);
  const digest = await objectDigestFor('mog.version.applied-sync-update.identity.v1', identity);
  return {
    identity,
    identityKey: `applied-sync-update:sha256:${digest.digest}`,
  };
}

export function cloneAppliedSyncUpdateIdentityRecord(
  record: AppliedSyncUpdateIdentityRecord,
): AppliedSyncUpdateIdentityRecord;
export function cloneAppliedSyncUpdateIdentityRecord(record: undefined): undefined;
export function cloneAppliedSyncUpdateIdentityRecord(
  record: AppliedSyncUpdateIdentityRecord | undefined,
): AppliedSyncUpdateIdentityRecord | undefined;
export function cloneAppliedSyncUpdateIdentityRecord(
  record: AppliedSyncUpdateIdentityRecord | undefined,
): AppliedSyncUpdateIdentityRecord | undefined {
  return record === undefined ? undefined : cloneJson(record);
}

export function appliedSyncUpdateIdentityReservationsEquivalent(
  left: AppliedSyncUpdateIdentityRecord,
  right: AppliedSyncUpdateIdentityRecord,
): boolean {
  return (
    canonicalJsonStringify(appliedSyncUpdateIdentityReservationIdentity(left)) ===
    canonicalJsonStringify(appliedSyncUpdateIdentityReservationIdentity(right))
  );
}

export function appliedSyncUpdateIdentityTerminalsEqual(
  left: AppliedSyncUpdateIdentityTerminal,
  right: AppliedSyncUpdateIdentityTerminal,
): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export function hasAppliedSyncUpdateIdentityStoreProvider(
  value: unknown,
): value is AppliedSyncUpdateIdentityStoreProvider {
  return isRecord(value) && typeof value.openAppliedSyncUpdateIdentityStore === 'function';
}

export function appliedSyncUpdateIdentityStorageKey(
  documentScope: VersionDocumentScope,
  identityKey: AppliedSyncUpdateIdentityKey,
): string {
  return memoryKey(documentScope, identityKey);
}

export function isAppliedSyncUpdateIdentityRecord(
  value: unknown,
): value is AppliedSyncUpdateIdentityRecord {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (value.recordKind !== 'appliedSyncUpdateIdentity') return false;
  if (
    typeof value.identityKey !== 'string' ||
    !/^applied-sync-update:sha256:[0-9a-f]{64}$/.test(value.identityKey)
  ) {
    return false;
  }
  if (typeof value.documentScopeKey !== 'string') return false;
  const identity = value.identity;
  if (!isAppliedSyncUpdateIdentity(identity)) return false;
  if (typeof value.payloadHash !== 'string' || value.payloadHash.length === 0) return false;
  const operationContext = value.operationContext;
  if (!isAppliedSyncOperationContext(operationContext)) return false;
  if (operationContext.collaboration.payloadHash !== value.payloadHash) return false;
  try {
    if (
      canonicalJsonStringify(
        appliedSyncUpdateIdentityForOperationContext(operationContext),
      ) !==
      canonicalJsonStringify(identity)
    ) {
      return false;
    }
  } catch {
    return false;
  }
  if (!isAppliedSyncUpdateIdentityState(value.state)) return false;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (value.state === 'reserved') return value.terminal === undefined;
  if (!isAppliedSyncUpdateIdentityTerminal(value.terminal)) return false;
  return value.terminal.status === value.state;
}

function appliedSyncOperationContext(
  operationContext: VersionOperationContext,
): AppliedSyncUpdateIdentityOperationContext['collaboration'] {
  if (!operationContext.collaboration) {
    throw new Error('Applied sync update identity operation context must include collaboration.');
  }
  return operationContext.collaboration;
}

function isAppliedSyncUpdateIdentity(value: unknown): value is AppliedSyncUpdateIdentity {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    (value.originKind === 'provider' || value.originKind === 'room') &&
    typeof value.stableOriginId === 'string' &&
    typeof value.epoch === 'string' &&
    typeof value.updateId === 'string'
  );
}

function isAppliedSyncOperationContext(
  value: unknown,
): value is AppliedSyncUpdateIdentityOperationContext {
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
    (value.collaboration.originKind === 'provider' ||
      value.collaboration.originKind === 'room') &&
    typeof value.collaboration.stableOriginId === 'string' &&
    typeof value.collaboration.epoch === 'string' &&
    typeof value.collaboration.updateId === 'string' &&
    typeof value.collaboration.payloadHash === 'string'
  );
}

function isAppliedSyncUpdateIdentityState(value: unknown): value is AppliedSyncUpdateIdentityState {
  return (
    value === 'reserved' ||
    value === 'applied' ||
    value === 'rejected' ||
    value === 'retryable' ||
    value === 'gapWaiting' ||
    value === 'failedAfterMutation'
  );
}

function isAppliedSyncUpdateIdentityTerminal(
  value: unknown,
): value is AppliedSyncUpdateIdentityTerminal {
  if (!isRecord(value)) return false;
  if (value.status === 'applied') {
    return (
      (value.pendingRemoteSegmentId === undefined ||
        typeof value.pendingRemoteSegmentId === 'string') &&
      (value.mutationSegmentDigest === undefined || isObjectDigest(value.mutationSegmentDigest))
    );
  }
  if (
    value.status === 'rejected' ||
    value.status === 'retryable' ||
    value.status === 'gapWaiting' ||
    value.status === 'failedAfterMutation'
  ) {
    return (
      typeof value.reason === 'string' &&
      (value.diagnosticDigest === undefined || isObjectDigest(value.diagnosticDigest))
    );
  }
  return false;
}

function memoryKey(
  documentScope: VersionDocumentScope,
  identityKey: AppliedSyncUpdateIdentityKey,
): string {
  return `${versionDocumentScopeKey(documentScope)}\u0000appliedSyncUpdate\u0000${identityKey}`;
}

function memoryKeyFromRecord(record: AppliedSyncUpdateIdentityRecord): string {
  return `${record.documentScopeKey}\u0000appliedSyncUpdate\u0000${record.identityKey}`;
}

function appliedSyncUpdateIdentityReservationIdentity(record: AppliedSyncUpdateIdentityRecord) {
  return {
    schemaVersion: record.schemaVersion,
    recordKind: record.recordKind,
    identityKey: record.identityKey,
    documentScopeKey: record.documentScopeKey,
    identity: record.identity,
  };
}

function conflictReserve(
  record: AppliedSyncUpdateIdentityRecord,
  message: string,
): Extract<AppliedSyncUpdateIdentityReserveResult, { status: 'conflict' }> {
  return {
    status: 'conflict',
    record,
    diagnostics: [diagnostic('VERSION_APPLIED_SYNC_UPDATE_CONFLICT', message, 'none')],
  };
}

function conflictComplete(
  record: AppliedSyncUpdateIdentityRecord,
  message: string,
): {
  readonly status: 'conflict';
  readonly record: AppliedSyncUpdateIdentityRecord;
  readonly diagnostics: readonly AppliedSyncUpdateIdentityStoreDiagnostic[];
} {
  return {
    status: 'conflict',
    record,
    diagnostics: [diagnostic('VERSION_APPLIED_SYNC_UPDATE_CONFLICT', message, 'none')],
  };
}

function failedReserve(
  message: string,
): Extract<AppliedSyncUpdateIdentityReserveResult, { status: 'failed' }> {
  return {
    status: 'failed',
    record: null,
    diagnostics: [diagnostic('VERSION_INVALID_OPTIONS', message, 'none')],
  };
}

function missingRead(message: string): AppliedSyncUpdateIdentityReadResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [diagnostic('VERSION_APPLIED_SYNC_UPDATE_NOT_FOUND', message, 'repair')],
  };
}

function diagnostic(
  code: AppliedSyncUpdateIdentityStoreDiagnostic['code'],
  message: string,
  recoverability: AppliedSyncUpdateIdentityStoreDiagnostic['recoverability'],
  details?: AppliedSyncUpdateIdentityStoreDiagnostic['details'],
): AppliedSyncUpdateIdentityStoreDiagnostic {
  return details === undefined
    ? { code, message, recoverability }
    : { code, message, recoverability, details };
}

function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child !== undefined) sorted[key] = sortJson(child);
  }
  return sorted;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
