import type {
  PendingRemoteSegmentId,
  PendingRemoteSegmentRecord,
  PendingRemoteSegmentStore,
} from './pending-remote-segment-store';
import {
  pendingRemotePromotionDiagnostic as diagnostic,
  pendingRemotePromotionErrorMessage as errorMessage,
  type PendingRemotePromotionDiagnostic,
} from './pending-remote-promotion-diagnostics';
import type {
  PendingRemotePromotionSkippedSegment,
  PromotionCompletion,
} from './pending-remote-promotion-helpers-types';

export async function completePendingRemotePromotionSegments(input: {
  readonly store: PendingRemoteSegmentStore;
  readonly records: readonly PendingRemoteSegmentRecord[];
  readonly completion: PromotionCompletion;
  readonly completedAt: string;
}): Promise<{
  readonly promotedSegmentIds: readonly PendingRemoteSegmentId[];
  readonly skipped: readonly PendingRemotePromotionSkippedSegment[];
  readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
}> {
  const promotedSegmentIds: PendingRemoteSegmentId[] = [];
  const skipped: PendingRemotePromotionSkippedSegment[] = [];
  const diagnostics: PendingRemotePromotionDiagnostic[] = [];

  for (const record of input.records) {
    let completed: Awaited<ReturnType<PendingRemoteSegmentStore['completeSegment']>>;
    try {
      completed = await input.store.completeSegment({
        pendingRemoteSegmentId: record.pendingRemoteSegmentId,
        mutationSegmentDigest: record.mutationSegmentDigest,
        completedAt: input.completedAt,
        terminal: {
          status: 'promoted',
          commitId: input.completion.commitId,
          promotionDigest: input.completion.promotionDigest,
        },
      });
    } catch (error) {
      completed = {
        status: 'failed',
        record: null,
        diagnostics: [
          {
            code: 'VERSION_PROVIDER_FAILED',
            message: 'Pending remote segment completion threw before returning a result.',
            recoverability: 'retry',
            details: { cause: errorMessage(error) },
          },
        ],
      };
    }

    if (completed.status === 'completed') {
      promotedSegmentIds.push(record.pendingRemoteSegmentId);
      continue;
    }

    skipped.push({
      segmentId: record.pendingRemoteSegmentId,
      reason: 'completion-failed',
      message: 'Pending remote segment was committed but could not be marked promoted.',
      commitId: input.completion.commitId,
    });
    diagnostics.push(
      diagnostic(
        'VERSION_PENDING_REMOTE_PROMOTION_COMPLETION_FAILED',
        'error',
        'Pending remote segment completion failed after graph commit creation.',
        {
          reason: 'completion-failed',
          segmentId: record.pendingRemoteSegmentId,
          commitId: input.completion.commitId,
          sourceDiagnostics: completed.diagnostics,
        },
      ),
    );
  }

  return {
    promotedSegmentIds: Object.freeze(promotedSegmentIds),
    skipped: Object.freeze(skipped),
    diagnostics: Object.freeze(diagnostics),
  };
}
