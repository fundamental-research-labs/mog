import type { WorkbookCommitId } from './version';

export type VersionPendingRemoteSegmentId = `pending-remote-segment:sha256:${string}` & {
  readonly __brand?: 'VersionPendingRemoteSegmentId';
};

export interface VersionPromotePendingRemoteOptions {
  readonly includeDiagnostics?: boolean;
}

export type VersionPromotePendingRemoteStatus = 'success' | 'partial' | 'failed';

export type VersionPromotePendingRemoteSkipReason =
  | 'batch-status-read-failed'
  | 'batch-status-terminal'
  | 'completion-failed'
  | 'graph-ref-unavailable'
  | 'graph-write-failed'
  | 'inconsistent-group'
  | 'ineligible-operation-context'
  | 'ineligible-state'
  | 'invalid-required-object'
  | 'missing-required-object'
  | 'missing-semantic-change-set'
  | 'missing-snapshot-root'
  | 'provider-authority-stale'
  | 'provider-authority-unknown'
  | 'provider-read-failed';

export type VersionPromotePendingRemoteDiagnosticCode =
  | 'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_COMPLETION_FAILED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_INELIGIBLE'
  | 'VERSION_PENDING_REMOTE_PROMOTION_OBJECT_READ_FAILED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE';

export interface VersionPromotePendingRemoteDiagnostic {
  readonly code: VersionPromotePendingRemoteDiagnosticCode | (string & {});
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly reason?: VersionPromotePendingRemoteSkipReason;
  readonly segmentId?: VersionPendingRemoteSegmentId;
  readonly commitId?: WorkbookCommitId;
  readonly data?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface VersionPromotePendingRemoteSkippedSegment {
  readonly segmentId: VersionPendingRemoteSegmentId;
  readonly reason: VersionPromotePendingRemoteSkipReason;
  readonly message: string;
  readonly commitId?: WorkbookCommitId;
}

export interface VersionPromotePendingRemoteResult {
  readonly status: VersionPromotePendingRemoteStatus;
  readonly promotedSegmentIds: readonly VersionPendingRemoteSegmentId[];
  readonly commitIds: readonly WorkbookCommitId[];
  readonly skipped: readonly VersionPromotePendingRemoteSkippedSegment[];
  readonly diagnostics: readonly VersionPromotePendingRemoteDiagnostic[];
}
