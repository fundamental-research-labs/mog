import type {
  AcceptAgentProposalInput,
  AgentProposalAcceptResult,
  OpenProposalReviewInput,
  VersionResult,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';

import type { ProviderBackedAgentProposalServiceContext } from './proposal-provider-service-context';
import {
  invalidState,
  sanitizeProposalProviderResult,
  staleRevision,
  storeFailure,
  targetUnavailable,
} from './proposal-provider-service-diagnostics';
import { acceptProviderBackedAgentProposalWithStaleRecovery } from './proposal-workspace-lifecycle-service';

export async function openProviderBackedProposalReview(
  context: ProviderBackedAgentProposalServiceContext,
  input: OpenProposalReviewInput,
): Promise<VersionResult<WorkbookVersionReviewRecord>> {
  if (!context.reviewService) {
    return targetUnavailable(
      'openProposalReview',
      'VERSION_REVIEW_SERVICE_UNAVAILABLE',
      'Provider-backed proposal review creation requires an attached review service.',
    );
  }

  const store = await context.openProposalStore('openProposalReview');
  if (!store.ok) return store.result;

  const proposalResult = await store.value.getProposal(input.proposalId);
  if (!proposalResult.ok) return storeFailure(proposalResult);
  const proposal = proposalResult.value;

  if (proposal.status === 'ready_for_review' && proposal.reviewId) {
    if (proposal.revision !== input.expectedRevision) {
      return staleRevision(input.expectedRevision, proposal.revision);
    }
    return sanitizeProposalProviderResult(
      await context.reviewService.getReview({ reviewId: proposal.reviewId }),
    );
  }

  if (proposal.status !== 'verified') {
    return invalidState(
      'proposal_not_verified',
      ['verified'],
      'Only verified proposals can be opened for review.',
    );
  }
  if (proposal.revision !== input.expectedRevision) {
    return {
      ok: false,
      error: {
        code: 'stale_revision',
        expectedRevision: input.expectedRevision,
        actualRevision: proposal.revision,
      },
    };
  }
  if (!proposal.proposalCommitId) {
    return invalidState(
      'proposal_commit_required',
      ['committed_proposal'],
      'Proposal review requires a proposal commit id.',
    );
  }
  const commitExists = await context.ensureCommitExists(
    proposal.proposalCommitId,
    'openProposalReview',
  );
  if (!commitExists.ok) return sanitizeProposalProviderResult(commitExists.result);

  const review = await context.reviewService.createReview({
    clientRequestId: input.clientRequestId,
    subject: {
      kind: 'proposal',
      proposalId: proposal.id,
      baseCommitId: proposal.baseCommitId,
      headCommitId: proposal.proposalCommitId,
    },
    title: proposal.title,
    createdBy: input.actor,
    baseCommitId: proposal.baseCommitId,
    headCommitId: proposal.proposalCommitId,
    redactionPolicy: proposal.redaction.policy,
  });
  if (!review.ok) return sanitizeProposalProviderResult(review);

  const updated = await store.value.updateProposal({
    clientRequestId: input.clientRequestId,
    proposalId: input.proposalId,
    expectedRevision: input.expectedRevision,
    status: 'ready_for_review',
    trustedActor: input.actor,
    reviewId: review.value.id,
  });
  if (!updated.ok) return storeFailure(updated);

  return review;
}

export async function acceptProviderBackedProposal(
  context: ProviderBackedAgentProposalServiceContext,
  input: AcceptAgentProposalInput,
): Promise<VersionResult<AgentProposalAcceptResult>> {
  return sanitizeProposalProviderResult(
    await acceptProviderBackedAgentProposalWithStaleRecovery({
      input,
      openStore: context.openStore,
      ...(context.graphProvider ? { graphProvider: context.graphProvider } : {}),
      ensureCommitExists: (commitId) => context.ensureCommitExists(commitId, 'acceptProposal'),
      resolveTargetHead: (targetRef) => context.resolveTargetHead(targetRef, 'acceptProposal'),
      ...(context.reviewService
        ? { getReview: (reviewId) => context.reviewService!.getReview({ reviewId }) }
        : {}),
      ...(context.reviewService?.markReviewApplied
        ? {
            markReviewApplied: (reviewInput) =>
              context.reviewService!.markReviewApplied!(reviewInput),
          }
        : {}),
    }),
  );
}
