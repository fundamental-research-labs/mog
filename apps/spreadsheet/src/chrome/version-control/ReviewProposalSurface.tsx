import { ReviewProposalDiagnostics } from './ReviewProposalSurfaceDiagnostics';
import { ReviewProposalSurfaceHeader } from './ReviewProposalSurfaceHeader';
import { ProposalSummaryRow, ReviewSummaryRow } from './ReviewProposalSurfaceRows';
import { useReviewProposalSurfaceState } from './review-proposal-state';
import type { ReviewProposalSurfaceProps } from './review-proposal-types';

export type {
  ReviewProposalAcceptTarget,
  ReviewProposalAccessProjectionDiagnostic,
  ReviewProposalAccessProjectionDiagnostics,
  ReviewProposalAccessProjectionState,
  ReviewProposalDiffTarget,
  ReviewProposalSurfaceProps,
} from './review-proposal-types';

export function ReviewProposalSurface({
  surface,
  reviews,
  proposals,
  reviewDiagnostic,
  proposalDiagnostic,
  diffEnabled = true,
  diffDisabledReason,
  onOpenDiff,
  accessDiagnostics,
  onAcceptProposal,
}: ReviewProposalSurfaceProps): React.JSX.Element | null {
  const {
    reviewState,
    proposalState,
    diffState,
    acceptState,
    proposalSurfaceAvailable,
    hasUnavailableState,
    hasContent,
    safeDiffDisabledReason,
    diffDisabledReasonId,
  } = useReviewProposalSurfaceState({
    surface,
    reviews,
    proposals,
    reviewDiagnostic,
    proposalDiagnostic,
    diffEnabled,
    diffDisabledReason,
    onOpenDiff,
    accessDiagnostics,
    onAcceptProposal,
  });

  if (!hasUnavailableState && !hasContent) return null;

  return (
    <section
      className="border border-ss-border rounded-sm px-3 py-2 bg-ss-surface-secondary"
      aria-label="Review and proposal status"
      data-testid="version-review-proposal-surface"
    >
      <ReviewProposalSurfaceHeader reviewState={reviewState} proposalState={proposalState} />

      <div className="mt-2 flex flex-col gap-2">
        <ReviewProposalDiagnostics
          surface={surface}
          reviewState={reviewState}
          proposalState={proposalState}
          diffState={diffState}
          acceptState={acceptState}
          reviewDiagnostic={reviewDiagnostic}
          proposalDiagnostic={proposalDiagnostic}
          showAcceptState={Boolean(onAcceptProposal)}
          diffDisabledReason={safeDiffDisabledReason}
          diffDisabledReasonId={diffDisabledReasonId}
        />
        {reviews.map((review) => (
          <ReviewSummaryRow
            key={review.id}
            review={review}
            diffEnabled={diffEnabled}
            diffDisabledReason={safeDiffDisabledReason}
            diffDisabledReasonId={diffDisabledReasonId}
            onOpenDiff={onOpenDiff}
            accessDiagnostic={accessDiagnostics?.reviews?.[review.id]}
          />
        ))}
        {proposals.map((proposal) => (
          <ProposalSummaryRow
            key={proposal.id}
            proposal={proposal}
            diffEnabled={diffEnabled}
            diffDisabledReason={safeDiffDisabledReason}
            diffDisabledReasonId={diffDisabledReasonId}
            onOpenDiff={onOpenDiff}
            acceptState={acceptState}
            onAcceptProposal={onAcceptProposal}
            proposalSurfaceAvailable={proposalSurfaceAvailable}
            accessDiagnostic={accessDiagnostics?.proposals?.[proposal.id]}
          />
        ))}
      </div>
    </section>
  );
}
