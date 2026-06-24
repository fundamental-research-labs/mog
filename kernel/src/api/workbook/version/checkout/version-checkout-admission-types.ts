import type { DocumentContext } from '../../../../context';

export type MaybePromise<T> = T | Promise<T>;
export type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type PendingProviderWriteNumberPayload = {
  pendingRemoteSegmentCount?: number;
  remoteSyncApplyActiveCount?: number;
  pendingRemotePromotionActiveCount?: number;
  pendingRemotePromotionQueuedCount?: number;
  syncBatchStatusPendingCount?: number;
  syncBatchStatusBlockedCount?: number;
  syncBatchStatusTerminalCount?: number;
  syncBatchStatusFailedAfterMutationCount?: number;
  syncBatchStatusDroppedCount?: number;
  syncBatchStatusRejectedCount?: number;
  syncBatchStatusReadFailedCount?: number;
};

export type PendingProviderWriteStringPayload = {
  syncBatchStatusFirstState?: string;
  syncBatchStatusFirstReason?: string;
  syncBatchStatusFirstSegmentId?: string;
  syncBatchStatusFirstBatchStatusId?: string;
};

export type PendingProviderWritePayload = PendingProviderWriteNumberPayload &
  PendingProviderWriteStringPayload;

export type SyncBatchStatusPayload = Pick<
  PendingProviderWritePayload,
  | 'pendingRemoteSegmentCount'
  | 'syncBatchStatusPendingCount'
  | 'syncBatchStatusBlockedCount'
  | 'syncBatchStatusTerminalCount'
  | 'syncBatchStatusFailedAfterMutationCount'
  | 'syncBatchStatusDroppedCount'
  | 'syncBatchStatusRejectedCount'
  | 'syncBatchStatusReadFailedCount'
  | 'syncBatchStatusFirstState'
  | 'syncBatchStatusFirstReason'
  | 'syncBatchStatusFirstSegmentId'
  | 'syncBatchStatusFirstBatchStatusId'
>;

export type LiveCollaborationPayload = {
  collaborationState?: string;
  roomId?: string;
  sidecarStatus?: string;
  activeParticipantCount?: number;
  remoteProviderAttached?: boolean;
  inFlightRemoteUpdateCount?: number;
  syncApplyRemoteQueueDepth?: number;
};

export type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type VersionCheckoutAdmissionBlock =
  | {
      readonly reason: 'dirtyWorkingState';
    }
  | {
      readonly reason: 'pendingProviderWrites';
      readonly pendingRemoteSegmentCount?: number;
      readonly remoteSyncApplyActiveCount?: number;
      readonly pendingRemotePromotionActiveCount?: number;
      readonly pendingRemotePromotionQueuedCount?: number;
      readonly syncBatchStatusPendingCount?: number;
      readonly syncBatchStatusBlockedCount?: number;
      readonly syncBatchStatusTerminalCount?: number;
      readonly syncBatchStatusFailedAfterMutationCount?: number;
      readonly syncBatchStatusDroppedCount?: number;
      readonly syncBatchStatusRejectedCount?: number;
      readonly syncBatchStatusReadFailedCount?: number;
      readonly syncBatchStatusFirstState?: string;
      readonly syncBatchStatusFirstReason?: string;
      readonly syncBatchStatusFirstSegmentId?: string;
      readonly syncBatchStatusFirstBatchStatusId?: string;
    }
  | ({
      readonly reason: 'syncBatchStatusBlocked';
    } & SyncBatchStatusPayload)
  | {
      readonly reason: 'pendingRecalc';
    }
  | ({
      readonly reason: 'liveCollaborationActive';
    } & LiveCollaborationPayload)
  | {
      readonly reason: 'checkoutAlreadyInProgress' | 'checkoutPreflightUnsafe';
    }
  | {
      readonly reason: 'checkoutPreflightStale';
    }
  | {
      readonly reason: 'staleWorkspaceHead';
      readonly staleReason: 'refMoved' | 'activeSessionBehind' | 'unknown';
      readonly branchName?: string;
      readonly checkedOutCommitId?: string;
      readonly refHeadAtMaterialization?: string;
      readonly currentRefHeadId?: string;
    };

export type VersionCheckoutAdmissionLease = {
  readonly statusRevision: string;
  readonly checkoutPreflightToken: string;
};

export type VersionCheckoutAdmissionState = {
  readonly block: VersionCheckoutAdmissionBlock | null;
  readonly lease: VersionCheckoutAdmissionLease | null;
};

export type AttachedCheckoutAdmissionReadService = {
  readRef?: (name: string) => MaybePromise<unknown>;
};
