import type {
  AcceptAgentProposalInput,
  VersionResult,
  WorkbookCommitId,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';

import { invalidState, targetUnavailable } from './proposal-provider-accept-service-results';
import type { WorkbookVersionMarkReviewAppliedInput } from '../review-service';

export async function requireApprovedProposalReview(input: {
  readonly proposalId: string;
  readonly baseCommitId: WorkbookCommitId;
  readonly proposalCommitId: WorkbookCommitId;
  readonly reviewId?: string;
  readonly getReview?: (reviewId: string) => Promise<VersionResult<WorkbookVersionReviewRecord>>;
}): Promise<
  | { readonly ok: true; readonly review: WorkbookVersionReviewRecord }
  | { readonly ok: false; readonly result: VersionResult<never> }
> {
  if (!input.reviewId) {
    return {
      ok: false,
      result: invalidState(
        'proposal_review_required',
        ['approved_review'],
        'Proposal acceptance requires a linked approved review.',
      ),
    };
  }
  if (!input.getReview) {
    return {
      ok: false,
      result: targetUnavailable(
        'VERSION_REVIEW_SERVICE_UNAVAILABLE',
        'Proposal acceptance requires an attached review service.',
      ),
    };
  }

  const review = await input.getReview(input.reviewId);
  if (!review.ok) return { ok: false, result: review };
  if (review.value.status !== 'approved') {
    return {
      ok: false,
      result: invalidState(
        'proposal_review_not_approved',
        ['approved'],
        'Proposal acceptance requires the linked review to be approved.',
      ),
    };
  }
  if (
    review.value.subject.kind !== 'proposal' ||
    review.value.subject.proposalId !== input.proposalId ||
    review.value.subject.baseCommitId !== input.baseCommitId ||
    review.value.subject.headCommitId !== input.proposalCommitId
  ) {
    return {
      ok: false,
      result: invalidState(
        'proposal_review_mismatch',
        ['matching_proposal_review'],
        'Proposal acceptance requires an approved review for the same proposal commit range.',
      ),
    };
  }
  return { ok: true, review: review.value };
}

export function ensureReviewFinalizerAvailable(input: {
  readonly reviewId?: string;
  readonly markReviewApplied?: (
    reviewInput: WorkbookVersionMarkReviewAppliedInput,
  ) => Promise<VersionResult<WorkbookVersionReviewRecord>>;
}): { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> } {
  if (!input.reviewId || input.markReviewApplied) return { ok: true };
  return {
    ok: false,
    result: targetUnavailable(
      'VERSION_REVIEW_FINALIZER_UNAVAILABLE',
      'Proposal acceptance requires an attached review service that can finalize the linked review.',
    ),
  };
}

export async function markLinkedReviewApplied(input: {
  readonly input: AcceptAgentProposalInput;
  readonly reviewId?: string;
  readonly markReviewApplied?: (
    reviewInput: WorkbookVersionMarkReviewAppliedInput,
  ) => Promise<VersionResult<WorkbookVersionReviewRecord>>;
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }> {
  const finalizerReady = ensureReviewFinalizerAvailable(input);
  if (!finalizerReady.ok) return finalizerReady;
  if (!input.reviewId) return { ok: true };
  const applied = await input.markReviewApplied!({
    reviewId: input.reviewId,
    clientRequestId: `${input.input.clientRequestId}:review-applied`,
    actor: input.input.actor,
  });
  return applied.ok ? { ok: true } : { ok: false, result: applied };
}
