import type { VersionGraphWriteResult } from './graph';
import type { WorkbookCommitId } from './object-digest';
import type {
  PendingRemoteSegmentId,
  PendingRemoteSegmentRecord,
} from './pending-remote-segment-store';
import {
  pendingRemotePromotionDiagnostic as diagnostic,
  pendingRemotePromotionErrorMessage as errorMessage,
  sourceDiagnosticsFromPromotionError as sourceDiagnosticsFromError,
  type PendingRemotePromotionDiagnostic,
  type PendingRemotePromotionSkipReason,
} from './pending-remote-promotion-diagnostics';
import type {
  PendingRemotePromotionResult,
  PendingRemotePromotionSkippedSegment,
  PendingRemotePromotionStatus,
} from './pending-remote-promotion-helpers-types';

export function skipGroup(
  records: readonly PendingRemoteSegmentRecord[],
  reason: PendingRemotePromotionSkipReason,
  message: string,
): readonly PendingRemotePromotionSkippedSegment[] {
  return Object.freeze(
    records.map((record) => ({
      segmentId: record.pendingRemoteSegmentId,
      reason,
      message,
    })),
  );
}

export function graphWriteDiagnostic(
  result: Extract<VersionGraphWriteResult, { status: 'failed' }>,
) {
  return diagnostic(
    'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED',
    'error',
    'Pending remote graph commit failed; segments were left pending.',
    {
      reason: 'graph-write-failed',
      sourceDiagnostics: result.diagnostics,
      details: { mutationGuarantee: result.mutationGuarantee },
    },
  );
}

export function graphWriteExceptionDiagnostic(error: unknown) {
  return diagnostic(
    'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED',
    'error',
    'Pending remote graph commit threw before returning a result; segments were left pending.',
    {
      reason: 'graph-write-failed',
      details: { cause: errorMessage(error) },
      sourceDiagnostics: sourceDiagnosticsFromError(error),
    },
  );
}

export function failedPendingRemotePromotionResult(
  diagnostics: readonly PendingRemotePromotionDiagnostic[],
): PendingRemotePromotionResult {
  return {
    status: 'failed',
    promotedSegmentIds: [],
    commitIds: [],
    skipped: [],
    diagnostics: Object.freeze([...diagnostics]),
  };
}

export function buildPendingRemotePromotionResult(input: {
  readonly promotedSegmentIds: readonly PendingRemoteSegmentId[];
  readonly commitIds: readonly WorkbookCommitId[];
  readonly skipped: readonly PendingRemotePromotionSkippedSegment[];
  readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
}): PendingRemotePromotionResult {
  return {
    status: resultStatus(input.promotedSegmentIds, input.skipped, input.diagnostics),
    promotedSegmentIds: Object.freeze([...input.promotedSegmentIds]),
    commitIds: Object.freeze([...input.commitIds]),
    skipped: Object.freeze([...input.skipped]),
    diagnostics: Object.freeze([...input.diagnostics]),
  };
}

export function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) items.push(item);
}

function resultStatus(
  promotedSegmentIds: readonly PendingRemoteSegmentId[],
  skipped: readonly PendingRemotePromotionSkippedSegment[],
  diagnostics: readonly PendingRemotePromotionDiagnostic[],
): PendingRemotePromotionStatus {
  if (skipped.length === 0 && !diagnostics.some((item) => item.severity === 'error')) {
    return 'success';
  }
  return promotedSegmentIds.length > 0 ? 'partial' : 'failed';
}
