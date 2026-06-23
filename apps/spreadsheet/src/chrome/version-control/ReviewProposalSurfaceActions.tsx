import type { AgentProposalSummary } from '@mog-sdk/contracts/api';

import { proposalAcceptAvailable } from './review-proposal-formatting';
import type {
  CapabilityState,
  ReviewProposalAcceptTarget,
  ReviewProposalAccessProjectionDiagnostic,
} from './review-proposal-types';

export function ProposalAcceptControl({
  proposal,
  acceptState,
  onAcceptProposal,
  proposalSurfaceAvailable,
  accessDiagnostic,
}: {
  readonly proposal: AgentProposalSummary;
  readonly acceptState?: CapabilityState;
  readonly onAcceptProposal?: (target: ReviewProposalAcceptTarget) => void;
  readonly proposalSurfaceAvailable: boolean;
  readonly accessDiagnostic?: ReviewProposalAccessProjectionDiagnostic;
}): React.JSX.Element | null {
  if (!onAcceptProposal) return null;
  if (!proposalAcceptAvailable(proposal, acceptState, proposalSurfaceAvailable, accessDiagnostic)) {
    return null;
  }

  return (
    <button
      type="button"
      className="self-start rounded-sm border border-ss-border bg-ss-surface px-2 py-1 text-[11px] font-medium text-ss-text transition-colors hover:bg-ss-surface-hover focus:outline-none focus:ring-1 focus:ring-ss-primary"
      aria-label={`Accept proposal ${proposal.title}`}
      data-testid="version-proposal-accept-control"
      data-capability="version:mergeApply"
      data-state="available"
      data-proposal-id={proposal.id}
      data-proposal-revision={proposal.revision}
      data-target-head-id={proposal.targetHeadIdAtCreation}
      data-proposal-commit-id={proposal.proposalCommitId}
      onClick={() => {
        if (!proposal.proposalCommitId) return;
        onAcceptProposal({
          proposalId: proposal.id,
          expectedRevision: proposal.revision,
          expectedTargetHeadId: proposal.targetHeadIdAtCreation,
          proposalCommitId: proposal.proposalCommitId,
          targetRef: proposal.targetRef,
        });
      }}
    >
      Accept
    </button>
  );
}
