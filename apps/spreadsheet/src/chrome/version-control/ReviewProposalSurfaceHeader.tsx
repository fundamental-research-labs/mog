import type { CapabilityState } from './review-proposal-types';

export function ReviewProposalSurfaceHeader({
  reviewState,
  proposalState,
}: {
  readonly reviewState?: CapabilityState;
  readonly proposalState?: CapabilityState;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body-sm font-medium text-ss-text">Proposal review</span>
      <span
        className="text-[11px] leading-none uppercase text-ss-text-tertiary"
        data-testid="version-review-proposal-state"
      >
        {reviewState?.enabled || proposalState?.enabled ? 'Active' : 'Unavailable'}
      </span>
    </div>
  );
}
