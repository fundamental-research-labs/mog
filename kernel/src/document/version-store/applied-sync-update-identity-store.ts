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
  appliedSyncUpdateIdentityRecordFromReserveInput,
  appliedSyncUpdateIdentityRecordStorageKey,
  appliedSyncUpdateIdentityReservationsEquivalent,
  appliedSyncUpdateIdentityStorageKey,
  appliedSyncUpdateIdentityTerminalsEqual,
  cloneAppliedSyncUpdateIdentityRecord,
  completeAppliedSyncUpdateIdentityRecord,
} from './applied-sync-update-identity-record-codec';
import {
  conflictCompleteAppliedSyncUpdateIdentityResult,
  conflictReserveAppliedSyncUpdateIdentityResult,
  failedReserveAppliedSyncUpdateIdentityResult,
  missingAppliedSyncUpdateIdentityCompleteResult,
  missingAppliedSyncUpdateIdentityReadResult,
} from './applied-sync-update-identity-store-results';

export {
  appliedSyncUpdateIdentityForOperationContext,
  appliedSyncUpdateIdentityKeyMaterialForOperationContext,
} from './applied-sync-update-identity';

export {
  appliedSyncUpdateIdentityReservationsEquivalent,
  appliedSyncUpdateIdentityStorageKey,
  appliedSyncUpdateIdentityTerminalsEqual,
  cloneAppliedSyncUpdateIdentityRecord,
  isAppliedSyncUpdateIdentityRecord,
} from './applied-sync-update-identity-record-codec';

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
      this.recordsByKey.get(appliedSyncUpdateIdentityStorageKey(documentScope, identityKey)),
    );
  }

  put(record: AppliedSyncUpdateIdentityRecord): void {
    this.recordsByKey.set(
      appliedSyncUpdateIdentityRecordStorageKey(record),
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
      record = await appliedSyncUpdateIdentityRecordFromReserveInput(input, this.documentScopeKey);
    } catch {
      return failedReserveAppliedSyncUpdateIdentityResult(
        'Applied sync update reservation has invalid identity context.',
      );
    }

    const existing = this.backend.get(this.documentScope, input.identityKey);
    if (existing) {
      if (existing.payloadHash !== record.payloadHash) {
        return conflictReserveAppliedSyncUpdateIdentityResult(
          existing,
          'Applied sync update identity is already bound to a different payload hash.',
        );
      }
      if (!appliedSyncUpdateIdentityReservationsEquivalent(existing, record)) {
        return conflictReserveAppliedSyncUpdateIdentityResult(
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
      : missingAppliedSyncUpdateIdentityReadResult('Applied sync update identity was not found.');
  }

  async completeIdentity(
    input: CompleteAppliedSyncUpdateIdentityInput,
  ): Promise<AppliedSyncUpdateIdentityCompleteResult> {
    const existing = this.backend.get(this.documentScope, input.identityKey);
    if (!existing) {
      return missingAppliedSyncUpdateIdentityCompleteResult();
    }
    if (existing.payloadHash !== input.payloadHash) {
      return conflictCompleteAppliedSyncUpdateIdentityResult(
        existing,
        'Applied sync update completion did not match the stored payload hash.',
      );
    }
    if (existing.terminal) {
      if (appliedSyncUpdateIdentityTerminalsEqual(existing.terminal, input.terminal)) {
        return { status: 'completed', record: existing, diagnostics: [] };
      }
      if (existing.state !== 'retryable') {
        return conflictCompleteAppliedSyncUpdateIdentityResult(
          existing,
          'Applied sync update identity is already finalized with different terminal metadata.',
        );
      }
    }

    const completed = completeAppliedSyncUpdateIdentityRecord(existing, input);
    this.backend.put(completed);
    return { status: 'completed', record: completed, diagnostics: [] };
  }
}

export function hasAppliedSyncUpdateIdentityStoreProvider(
  value: unknown,
): value is AppliedSyncUpdateIdentityStoreProvider {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly openAppliedSyncUpdateIdentityStore?: unknown };
  return typeof candidate.openAppliedSyncUpdateIdentityStore === 'function';
}
