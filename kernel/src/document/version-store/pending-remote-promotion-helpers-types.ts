import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import type { VersionObjectRecord } from './object-store';
import type {
  PendingRemoteSegmentId,
  PendingRemoteSegmentRecord,
} from './pending-remote-segment-store';
import type {
  PendingRemotePromotionDiagnostic,
  PendingRemotePromotionSkipReason,
} from './pending-remote-promotion-diagnostics';

export type PendingRemotePromotionStatus = 'success' | 'partial' | 'failed';

export type PendingRemotePromotionSkippedSegment = {
  readonly segmentId: PendingRemoteSegmentId;
  readonly reason: PendingRemotePromotionSkipReason;
  readonly message: string;
  readonly commitId?: WorkbookCommitId;
};

export type PendingRemotePromotionResult = {
  readonly status: PendingRemotePromotionStatus;
  readonly promotedSegmentIds: readonly PendingRemoteSegmentId[];
  readonly commitIds: readonly WorkbookCommitId[];
  readonly skipped: readonly PendingRemotePromotionSkippedSegment[];
  readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
};

export type PendingRemotePromotionGroup = {
  readonly records: readonly PendingRemoteSegmentRecord[];
};

export type PreparedPendingRemotePromotionGroup = {
  readonly records: readonly PendingRemoteSegmentRecord[];
  readonly snapshotRootRecord: VersionObjectRecord<unknown>;
  readonly semanticChangeSetRecord: VersionObjectRecord<unknown>;
  readonly mutationSegmentRecords: readonly VersionObjectRecord<unknown>[];
  readonly author: VersionAuthor;
  readonly createdAt: string;
};

export type PreparePendingRemotePromotionGroupResult =
  | {
      readonly status: 'ready';
      readonly prepared: PreparedPendingRemotePromotionGroup;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    }
  | {
      readonly status: 'skipped';
      readonly skipped: readonly PendingRemotePromotionSkippedSegment[];
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

export type PromotionCompletion = {
  readonly commitId: WorkbookCommitId;
  readonly promotionDigest: ObjectDigest;
};

export type ExistingPromotionCommitResolution =
  | {
      readonly status: 'found';
      readonly completion: PromotionCompletion;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    }
  | {
      readonly status: 'not-found';
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    }
  | {
      readonly status: 'skipped';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

export type PromotedRecoveryRecord = PendingRemoteSegmentRecord & {
  readonly terminal: {
    readonly status: 'promoted';
    readonly commitId: WorkbookCommitId;
    readonly promotionDigest?: ObjectDigest;
  };
};
