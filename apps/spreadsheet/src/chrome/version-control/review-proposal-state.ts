import type { CapabilityState, ReviewProposalSurfaceProps } from './review-proposal-types';
import { sanitizeVersionStatusText } from './review-proposal-formatting';

export type ReviewProposalSurfaceState = {
  readonly reviewState?: CapabilityState;
  readonly proposalState?: CapabilityState;
  readonly diffState?: CapabilityState;
  readonly acceptState?: CapabilityState;
  readonly proposalSurfaceAvailable: boolean;
  readonly hasUnavailableState: boolean;
  readonly hasContent: boolean;
  readonly safeDiffDisabledReason?: string;
  readonly diffDisabledReasonId?: string;
};

export function useReviewProposalSurfaceState({
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
}: Pick<
  ReviewProposalSurfaceProps,
  | 'surface'
  | 'reviews'
  | 'proposals'
  | 'reviewDiagnostic'
  | 'proposalDiagnostic'
  | 'diffDisabledReason'
  | 'onOpenDiff'
  | 'accessDiagnostics'
  | 'onAcceptProposal'
> & {
  readonly diffEnabled: boolean;
}): ReviewProposalSurfaceState {
  const reviewState = surface?.capabilities['version:reviewRead'];
  const proposalState = surface?.capabilities['version:proposal'];
  const diffState = surface?.capabilities['version:diff'];
  const acceptState = surface?.capabilities['version:mergeApply'];
  const proposalSurfaceAvailable = proposalState?.enabled === true && !proposalDiagnostic;
  const hasUnavailableState =
    (reviewState && !reviewState.enabled) ||
    (proposalState && !proposalState.enabled) ||
    (Boolean(onAcceptProposal) && acceptState && !acceptState.enabled);
  const hasAccessDiagnostics =
    Boolean(accessDiagnostics?.reviews && Object.keys(accessDiagnostics.reviews).length > 0) ||
    Boolean(accessDiagnostics?.proposals && Object.keys(accessDiagnostics.proposals).length > 0);
  const hasContent =
    Boolean(surface) ||
    reviews.length > 0 ||
    proposals.length > 0 ||
    Boolean(reviewDiagnostic) ||
    Boolean(proposalDiagnostic) ||
    hasAccessDiagnostics;
  const safeDiffDisabledReason = sanitizeVersionStatusText(
    diffDisabledReason,
    'Diff service is unavailable.',
  );
  const diffDisabledReasonId =
    onOpenDiff && !diffEnabled && safeDiffDisabledReason
      ? 'version-review-proposal-diff-disabled-reason'
      : undefined;

  return {
    reviewState,
    proposalState,
    diffState,
    acceptState,
    proposalSurfaceAvailable,
    hasUnavailableState: Boolean(hasUnavailableState),
    hasContent,
    safeDiffDisabledReason,
    diffDisabledReasonId,
  };
}
