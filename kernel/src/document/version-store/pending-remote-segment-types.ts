import type {
  VersionOperationContext,
  VersionSyncOperationContext,
} from '@mog-sdk/contracts/versioning';

import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import type { VersionGraphNamespace } from './object-store';
import type { VersionGraphStore } from './provider-graph-store';

export type PendingRemoteSegmentState = 'pending' | 'promoted' | 'dropped';

export type PendingRemoteSegmentId = `pending-remote-segment:sha256:${string}`;
export type PendingRemoteSegmentIdempotencyKey = `pending-remote:sha256:${string}`;

export type PendingRemoteSegmentOperationContext = VersionOperationContext & {
  readonly collaboration: VersionSyncOperationContext;
};

export type PendingRemoteSegmentSyncIdentity = {
  readonly schemaVersion: 1;
  readonly sourceKind: VersionSyncOperationContext['sourceKind'];
  readonly originKind: VersionSyncOperationContext['originKind'];
  readonly stableOriginId?: string;
  readonly providerId?: string;
  readonly authorityRef?: string;
  readonly roomId?: string;
  readonly epoch?: string;
  readonly updateId?: string;
  readonly sequence?: string;
  readonly payloadHash: string;
};

export type PendingRemoteSegmentTerminal =
  | {
      readonly status: 'promoted';
      readonly commitId?: WorkbookCommitId;
      readonly promotionDigest?: ObjectDigest;
    }
  | {
      readonly status: 'dropped';
      readonly reason: string;
      readonly diagnosticDigest?: ObjectDigest;
    };

export type PendingRemoteSegmentRecord = {
  readonly schemaVersion: 1;
  readonly recordKind: 'pendingRemoteSegment';
  readonly pendingRemoteSegmentId: PendingRemoteSegmentId;
  readonly idempotencyKey: PendingRemoteSegmentIdempotencyKey;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly syncIdentity: PendingRemoteSegmentSyncIdentity;
  readonly operationContext: PendingRemoteSegmentOperationContext;
  readonly mutationSegmentDigest: ObjectDigest;
  readonly snapshotRootDigest?: ObjectDigest;
  readonly semanticChangeSetDigest?: ObjectDigest;
  readonly state: PendingRemoteSegmentState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly terminal?: PendingRemoteSegmentTerminal;
};

export type ReservePendingRemoteSegmentInput = Omit<
  PendingRemoteSegmentRecord,
  | 'schemaVersion'
  | 'recordKind'
  | 'namespaceKey'
  | 'documentScopeKey'
  | 'syncIdentity'
  | 'state'
  | 'updatedAt'
  | 'terminal'
>;

export type CompletePendingRemoteSegmentInput = {
  readonly pendingRemoteSegmentId: PendingRemoteSegmentId;
  readonly mutationSegmentDigest: ObjectDigest;
  readonly completedAt: string;
  readonly terminal: PendingRemoteSegmentTerminal;
};

export type PendingRemoteSegmentStoreDiagnostic = {
  readonly code:
    | 'VERSION_INVALID_OPTIONS'
    | 'VERSION_PENDING_REMOTE_CONFLICT'
    | 'VERSION_PENDING_REMOTE_MISSING_OBJECT'
    | 'VERSION_PENDING_REMOTE_OBJECT_CORRUPTION'
    | 'VERSION_PENDING_REMOTE_NOT_FOUND'
    | 'VERSION_PROVIDER_FAILED';
  readonly message: string;
  readonly recoverability: 'retry' | 'repair' | 'none';
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type PendingRemoteSegmentReadResult =
  | {
      readonly status: 'found';
      readonly record: PendingRemoteSegmentRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing';
      readonly record: null;
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly record: null;
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    };

export type PendingRemoteSegmentListResult =
  | {
      readonly status: 'success';
      readonly records: readonly PendingRemoteSegmentRecord[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly records: readonly [];
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    };

export type PendingRemoteSegmentReserveResult =
  | {
      readonly status: 'created' | 'existing';
      readonly record: PendingRemoteSegmentRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'conflict';
      readonly record: PendingRemoteSegmentRecord;
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly record: null;
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    };

export type PendingRemoteSegmentCompleteResult =
  | {
      readonly status: 'completed';
      readonly record: PendingRemoteSegmentRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing' | 'conflict' | 'failed';
      readonly record: PendingRemoteSegmentRecord | null;
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    };

export interface PendingRemoteSegmentStore {
  readonly namespace: VersionGraphNamespace;
  reserveSegment(
    input: ReservePendingRemoteSegmentInput,
  ): Promise<PendingRemoteSegmentReserveResult>;
  readBySegmentId(segmentId: PendingRemoteSegmentId): Promise<PendingRemoteSegmentReadResult>;
  readByIdempotencyKey(
    idempotencyKey: PendingRemoteSegmentIdempotencyKey,
  ): Promise<PendingRemoteSegmentReadResult>;
  listByState(state: PendingRemoteSegmentState): Promise<PendingRemoteSegmentListResult>;
  completeSegment(
    input: CompletePendingRemoteSegmentInput,
  ): Promise<PendingRemoteSegmentCompleteResult>;
}

export type PendingRemoteSegmentStoreProvider = {
  openPendingRemoteSegmentStore(
    namespace: VersionGraphNamespace,
  ): Promise<PendingRemoteSegmentStore>;
};

export type PendingRemoteSegmentKeyMaterial = {
  readonly syncIdentity: PendingRemoteSegmentSyncIdentity;
  readonly idempotencyKey: PendingRemoteSegmentIdempotencyKey;
  readonly pendingRemoteSegmentId: PendingRemoteSegmentId;
};

export type PendingRemoteSegmentObjectValidationResult =
  | {
      readonly status: 'success';
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    };

export type ReservePersistedPendingRemoteSegmentOptions = {
  readonly graph: Pick<VersionGraphStore, 'getObjectRecord'>;
  readonly store: PendingRemoteSegmentStore;
  readonly input: ReservePendingRemoteSegmentInput;
};

export type PendingRemoteSegmentReservationRecordOptions = {
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly input: ReservePendingRemoteSegmentInput;
};

export type PendingRemoteSegmentMemoryBackendSnapshot = {
  readonly records: readonly PendingRemoteSegmentRecord[];
};
