import type {
  AgentProposalAcceptResult,
  VersionDiagnostic,
  VersionRecordRevision,
  VersionResult,
} from '@mog-sdk/contracts/api';

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
import { refVersionsEqual, type RefVersion } from '../refs/ref-store';

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
    options.input.expectedTargetRefRevision !== undefined &&
    proposal.targetRefVersionAtCreation !== undefined &&
    !recordRevisionsEqual(
      options.input.expectedTargetRefRevision,
      proposal.targetRefVersionAtCreation,
    )
  ) {
    return invalidState(
      'proposal_target_ref_revision_binding_mismatch',
      ['matching_target_ref_revision'],
      'Proposal acceptance must use the target ref revision recorded when the proposal was created.',
    );
  }

  const targetRefDiagnostics = staleTargetRefDiagnostics(proposal, target.head.refVersion);
  if (
    target.head.commitId !== options.input.expectedTargetHeadId ||
    target.head.commitId !== proposal.baseCommitId ||
    targetRefDiagnostics.length > 0
  ) {
    return markProposalStale({
      store: store.value,
      input: options.input,
      actualTargetHeadId: target.head.commitId,
      targetHeadMoved:
        target.head.commitId !== options.input.expectedTargetHeadId ||
        target.head.commitId !== proposal.baseCommitId,
      diagnostics: targetRefDiagnostics,
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

function staleTargetRefDiagnostics(
  proposal: { readonly id: string; readonly targetRefVersionAtCreation?: RefVersion },
  actualTargetRefRevision: RefVersion,
): readonly VersionDiagnostic[] {
  if (proposal.targetRefVersionAtCreation === undefined) {
    return [
      diagnostic('proposal_target_ref_revision_missing', 'error', {
        proposalId: proposal.id,
        actualTargetRefRevision: revisionLabel(actualTargetRefRevision),
      }),
    ];
  }
  if (refVersionsEqual(actualTargetRefRevision, proposal.targetRefVersionAtCreation)) return [];
  return [
    diagnostic('stale_proposal_target_ref_revision', 'warning', {
      proposalId: proposal.id,
      expectedTargetRefRevision: revisionLabel(proposal.targetRefVersionAtCreation),
      actualTargetRefRevision: revisionLabel(actualTargetRefRevision),
    }),
  ];
}

function diagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  data: Readonly<Record<string, string | number | boolean | null>>,
): VersionDiagnostic {
  return {
    code,
    severity,
    message:
      code === 'proposal_target_ref_revision_missing'
        ? 'Proposal record is missing the target ref revision required for acceptance.'
        : 'Proposal target ref revision changed after the proposal was created.',
    owner: 'version-store',
    data,
  };
}

function recordRevisionsEqual(left: VersionRecordRevision, right: RefVersion): boolean {
  return left.kind === right.kind && left.value === right.value;
}

function revisionLabel(revision: VersionRecordRevision | RefVersion): string {
  return `${revision.kind}:${revision.value}`;
}
