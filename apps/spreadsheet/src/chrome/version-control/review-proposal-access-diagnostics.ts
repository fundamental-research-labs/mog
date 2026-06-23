import type {
  AgentProposalSummary,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

import type {
  ReviewProposalAccessProjectionDiagnostic,
  ReviewProposalAccessProjectionDiagnostics,
} from './ReviewProposalSurface';

export function reviewProposalAccessDiagnosticsFromSummaries({
  reviews,
  proposals,
}: {
  readonly reviews: readonly WorkbookVersionReviewRecordSummary[];
  readonly proposals: readonly AgentProposalSummary[];
}): ReviewProposalAccessProjectionDiagnostics | undefined {
  const reviewDiagnostics = Object.fromEntries(
    reviews
      .filter((review) => review.status === 'stale')
      .map((review) => [review.id, staleReviewAccessDiagnostic(review)]),
  );
  const proposalDiagnostics = Object.fromEntries(
    proposals
      .filter((proposal) => proposal.status === 'stale')
      .map((proposal) => [proposal.id, staleProposalAccessDiagnostic(proposal)]),
  );

  return Object.keys(reviewDiagnostics).length > 0 || Object.keys(proposalDiagnostics).length > 0
    ? { reviews: reviewDiagnostics, proposals: proposalDiagnostics }
    : undefined;
}

function staleReviewAccessDiagnostic(
  review: WorkbookVersionReviewRecordSummary,
): ReviewProposalAccessProjectionDiagnostic {
  return {
    state: 'stale',
    code: 'VERSION_REVIEW_STALE',
    severity: 'warning',
    reason: 'stale',
    message: `Review ${review.title ?? review.id} is stale; create a new review before applying changes.`,
  };
}

function staleProposalAccessDiagnostic(
  proposal: AgentProposalSummary,
): ReviewProposalAccessProjectionDiagnostic {
  return {
    state: 'stale',
    code: 'VERSION_PROPOSAL_STALE',
    severity: 'warning',
    reason: 'stale',
    message: `Proposal ${proposal.title} is stale because the target branch moved. Review remains read-only until a new proposal or merge is created.`,
  };
}
