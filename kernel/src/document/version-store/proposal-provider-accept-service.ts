import type { AgentProposalAcceptResult, VersionResult } from '@mog-sdk/contracts/api';

import { ensureProposalBranchFastForwardFromExpectedHead } from './proposal-provider-branch-head-validation';
import { fastForwardTargetRef } from './proposal-provider-accept-service-graph';
import {
  diagnosticsFromFailureResult,
  fastForwardAcceptResult,
  invalidState,
  markProposalStale,
  ok,
  proposalAcceptReceiptId,
  staleRevision,
  storeFailure,
} from './proposal-provider-accept-service-results';
import {
  ensureReviewFinalizerAvailable,
  markLinkedReviewApplied,
  requireApprovedProposalReview,
} from './proposal-provider-accept-service-review';
import { openProposalStore } from './proposal-provider-accept-service-store';
import type { AcceptProviderBackedAgentProposalOptions } from './proposal-provider-accept-service-types';

export async function acceptProviderBackedAgentProposal(
  options: AcceptProviderBackedAgentProposalOptions,
): Promise<VersionResult<AgentProposalAcceptResult>> {
  const store = await openProposalStore(options.openStore);
  if (!store.ok) return store.result;

  const proposalResult = await store.value.getProposal(options.input.proposalId);
  if (!proposalResult.ok) return storeFailure(proposalResult);
  const proposal = proposalResult.value;

  if (options.input.resolutionPolicy !== 'fastForwardOnly') {
    return invalidState(
      'proposal_accept_resolution_policy_unsupported',
      ['fastForwardOnly'],
      'Provider-backed proposal acceptance currently supports only fast-forward-only ref advancement.',
    );
  }

  if (proposal.status === 'applied' && proposal.accepted) {
    const finalizedReview = await markLinkedReviewApplied({
      input: options.input,
      reviewId: proposal.reviewId,
      markReviewApplied: options.markReviewApplied,
    });
    if (!finalizedReview.ok) return finalizedReview.result;
    return ok(fastForwardAcceptResult(proposal.id, proposal.accepted));
  }
  if (proposal.revision !== options.input.expectedRevision) {
    return staleRevision(options.input.expectedRevision, proposal.revision);
  }
  if (proposal.status !== 'ready_for_review') {
    return invalidState(
      'proposal_not_ready_for_review',
      ['ready_for_review'],
      'Only ready-for-review proposals can be accepted.',
    );
  }
  if (!proposal.proposalCommitId) {
    return invalidState(
      'proposal_commit_required',
      ['committed_proposal'],
      'Proposal acceptance requires a proposal commit id.',
    );
  }
  const reviewReady = await requireApprovedProposalReview({
    proposalId: proposal.id,
    baseCommitId: proposal.baseCommitId,
    proposalCommitId: proposal.proposalCommitId,
    reviewId: proposal.reviewId,
    getReview: options.getReview,
  });
  if (!reviewReady.ok) return reviewReady.result;
  const reviewFinalizerReady = ensureReviewFinalizerAvailable({
    reviewId: proposal.reviewId,
    markReviewApplied: options.markReviewApplied,
  });
  if (!reviewFinalizerReady.ok) return reviewFinalizerReady.result;

  const commitExists = await options.ensureCommitExists(proposal.proposalCommitId);
  if (!commitExists.ok) return commitExists.result;

  const target = await options.resolveTargetHead(proposal.targetRef);
  if (!target.ok) return target.result;

  if (
    target.head.commitId !== options.input.expectedTargetHeadId ||
    target.head.commitId !== proposal.baseCommitId
  ) {
    return markProposalStale({
      store: store.value,
      input: options.input,
      actualTargetHeadId: target.head.commitId,
      targetHeadMoved: true,
    });
  }

  const proposalBranchReady = await ensureProposalBranchFastForwardFromExpectedHead({
    graphProvider: options.graphProvider,
    operation: 'acceptProposal',
    proposalBranchName: proposal.proposalBranchName,
    expectedHeadCommitId: options.input.expectedTargetHeadId,
    proposalCommitId: proposal.proposalCommitId,
  });
  if (!proposalBranchReady.ok) {
    if (!('stale' in proposalBranchReady)) return proposalBranchReady.result;
    return markProposalStale({
      store: store.value,
      input: options.input,
      actualTargetHeadId: target.head.commitId,
      targetHeadMoved: false,
      diagnostics: proposalBranchReady.diagnostics,
    });
  }

  const advanced = await fastForwardTargetRef(options.graphProvider, {
    targetRef: proposal.targetRef,
    nextCommitId: proposal.proposalCommitId,
    expectedHeadCommitId: proposal.baseCommitId,
    expectedRefVersion: target.head.refVersion,
  });
  if (!advanced.ok) {
    if (!advanced.stale) return advanced.result;
    return markProposalStale({
      store: store.value,
      input: options.input,
      actualTargetHeadId: advanced.actualTargetHeadId ?? target.head.commitId,
      targetHeadMoved: true,
      diagnostics: diagnosticsFromFailureResult(advanced.result),
    });
  }

  const accepted = {
    targetRef: proposal.targetRef,
    expectedTargetHeadId: options.input.expectedTargetHeadId,
    appliedCommitId: proposal.proposalCommitId,
    refUpdateReceiptId: proposalAcceptReceiptId({
      proposalId: proposal.id,
      clientRequestId: options.input.clientRequestId,
      appliedCommitId: proposal.proposalCommitId,
    }),
  };
  const updated = await store.value.updateProposal({
    clientRequestId: options.input.clientRequestId,
    proposalId: options.input.proposalId,
    expectedRevision: options.input.expectedRevision,
    status: 'applied',
    trustedActor: options.input.actor,
    accepted,
  });
  if (!updated.ok) return storeFailure(updated);

  const finalizedReview = await markLinkedReviewApplied({
    input: options.input,
    reviewId: reviewReady.review.id,
    markReviewApplied: options.markReviewApplied,
  });
  if (!finalizedReview.ok) return finalizedReview.result;

  return ok(fastForwardAcceptResult(updated.value.id, accepted));
}
