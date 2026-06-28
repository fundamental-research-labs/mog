import type {
  AgentProposalAcceptResult,
  VersionDiagnostic,
  VersionMergeReview,
  VersionRecordRevision,
  VersionResult,
  WorkbookCommitId,
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
  targetUnavailable,
} from './proposal-provider-accept-service-results';
import {
  ensureReviewFinalizerAvailable,
  markLinkedReviewApplied,
  requireApprovedProposalReview,
} from './proposal-provider-accept-service-review';
import { openProposalStore } from './proposal-provider-accept-service-store';
import type { AcceptProviderBackedAgentProposalOptions } from './proposal-provider-accept-service-types';
import type { AgentProposalMetadataStore, AgentProposalRecord } from './proposal-store';
import { refVersionsEqual, type RefVersion } from '../refs/ref-store';

export async function acceptProviderBackedAgentProposal(
  options: AcceptProviderBackedAgentProposalOptions,
): Promise<VersionResult<AgentProposalAcceptResult>> {
  const store = await openProposalStore(options.openStore);
  if (!store.ok) return store.result;

  const proposalResult = await store.value.getProposal(options.input.proposalId);
  if (!proposalResult.ok) return storeFailure(proposalResult);
  const proposal = proposalResult.value;

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
    if (options.input.resolutionPolicy !== 'fastForwardOnly') {
      return acceptMovedTargetWithMergeReview({
        store: store.value,
        input: options.input,
        proposal,
        actualTargetHeadId: target.head.commitId,
        diagnostics: targetRefDiagnostics,
        mergeReviewService: options.mergeReviewService,
        markReviewApplied: options.markReviewApplied,
        reviewId: reviewReady.review.id,
      });
    }
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

async function acceptMovedTargetWithMergeReview(options: {
  readonly store: AgentProposalMetadataStore;
  readonly input: AcceptProviderBackedAgentProposalOptions['input'];
  readonly proposal: AgentProposalRecord;
  readonly actualTargetHeadId: WorkbookCommitId;
  readonly diagnostics: readonly VersionDiagnostic[];
  readonly mergeReviewService: AcceptProviderBackedAgentProposalOptions['mergeReviewService'];
  readonly markReviewApplied: AcceptProviderBackedAgentProposalOptions['markReviewApplied'];
  readonly reviewId: string;
}): Promise<VersionResult<AgentProposalAcceptResult>> {
  if (!options.mergeReviewService) {
    return invalidState(
      'proposal_accept_merge_review_unavailable',
      ['merge_review'],
      'Moved-target proposal acceptance requires merge review preview/apply services.',
    );
  }
  if (!options.proposal.proposalCommitId) {
    return invalidState(
      'proposal_commit_required',
      ['committed_proposal'],
      'Proposal acceptance requires a proposal commit id.',
    );
  }

  const preview = await options.mergeReviewService.previewMerge({
    from: { kind: 'commit', id: options.proposal.proposalCommitId },
    into: { kind: 'ref', name: options.proposal.targetRef },
    base: options.proposal.baseCommitId,
  });
  if (!preview.ok) return retargetFailure(preview);

  const review = preview.value;
  if (review.status === 'blocked') {
    return targetUnavailableFromDiagnostics(
      'proposal_accept_merge_blocked',
      'Proposal acceptance merge preview was blocked before applying.',
      review.diagnostics,
    );
  }
  if (review.status === 'conflicted') {
    return markProposalMergeConflicted({
      store: options.store,
      input: options.input,
      proposalId: options.proposal.id,
      review,
      diagnostics: options.diagnostics,
    });
  }

  const applied = await review.apply({ materializeActiveCheckout: false });
  if (!applied.ok) return retargetFailure(applied);

  switch (applied.value.status) {
    case 'applied':
      return markProposalMergeApplied({
        store: options.store,
        input: options.input,
        proposal: options.proposal,
        mergePreviewId: mergePreviewIdForReview(review, options.input.clientRequestId),
        mergeCommitId: applied.value.commitRef.id,
        markReviewApplied: options.markReviewApplied,
        reviewId: options.reviewId,
      });
    case 'fastForwarded':
      return markProposalFastForwardApplied({
        store: options.store,
        input: options.input,
        proposal: options.proposal,
        appliedCommitId: applied.value.commitRef.id,
        markReviewApplied: options.markReviewApplied,
        reviewId: options.reviewId,
      });
    case 'alreadyApplied':
    case 'alreadyMerged':
      return markProposalMergeApplied({
        store: options.store,
        input: options.input,
        proposal: options.proposal,
        mergePreviewId: mergePreviewIdForReview(review, options.input.clientRequestId),
        mergeCommitId: applied.value.commitRef.id,
        markReviewApplied: options.markReviewApplied,
        reviewId: options.reviewId,
      });
    case 'conflicted':
      return markProposalMergeConflicted({
        store: options.store,
        input: options.input,
        proposalId: options.proposal.id,
        review,
        diagnostics: options.diagnostics,
      });
    case 'staleTargetHead':
      return markProposalStale({
        store: options.store,
        input: options.input,
        actualTargetHeadId: options.actualTargetHeadId,
        targetHeadMoved: true,
        diagnostics: options.diagnostics,
      });
    case 'planned':
    case 'blocked':
      return targetUnavailableFromDiagnostics(
        'proposal_accept_merge_apply_blocked',
        'Proposal acceptance merge apply did not produce a target ref update.',
        applied.value.diagnostics,
      );
  }
}

async function markProposalMergeApplied(options: {
  readonly store: AgentProposalMetadataStore;
  readonly input: AcceptProviderBackedAgentProposalOptions['input'];
  readonly proposal: AgentProposalRecord;
  readonly mergePreviewId: string;
  readonly mergeCommitId: WorkbookCommitId;
  readonly markReviewApplied: AcceptProviderBackedAgentProposalOptions['markReviewApplied'];
  readonly reviewId: string;
}): Promise<VersionResult<AgentProposalAcceptResult>> {
  const accepted = {
    targetRef: options.proposal.targetRef,
    expectedTargetHeadId: options.input.expectedTargetHeadId,
    appliedCommitId: options.mergeCommitId,
    refUpdateReceiptId: proposalAcceptReceiptId({
      proposalId: options.proposal.id,
      clientRequestId: options.input.clientRequestId,
      appliedCommitId: options.mergeCommitId,
    }),
  };
  const updated = await options.store.updateProposal({
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
    reviewId: options.reviewId,
    markReviewApplied: options.markReviewApplied,
  });
  if (!finalizedReview.ok) return finalizedReview.result;

  return ok({
    status: 'merge_applied',
    proposalId: updated.value.id as AgentProposalAcceptResult['proposalId'],
    mergeCommitId: options.mergeCommitId,
    targetRef: options.proposal.targetRef as Extract<
      AgentProposalAcceptResult,
      { readonly status: 'merge_applied' }
    >['targetRef'],
    newHeadId: options.mergeCommitId,
    mergePreviewId: options.mergePreviewId,
    refUpdateReceiptId: accepted.refUpdateReceiptId,
  });
}

async function markProposalFastForwardApplied(options: {
  readonly store: AgentProposalMetadataStore;
  readonly input: AcceptProviderBackedAgentProposalOptions['input'];
  readonly proposal: AgentProposalRecord;
  readonly appliedCommitId: WorkbookCommitId;
  readonly markReviewApplied: AcceptProviderBackedAgentProposalOptions['markReviewApplied'];
  readonly reviewId: string;
}): Promise<VersionResult<AgentProposalAcceptResult>> {
  const accepted = {
    targetRef: options.proposal.targetRef,
    expectedTargetHeadId: options.input.expectedTargetHeadId,
    appliedCommitId: options.appliedCommitId,
    refUpdateReceiptId: proposalAcceptReceiptId({
      proposalId: options.proposal.id,
      clientRequestId: options.input.clientRequestId,
      appliedCommitId: options.appliedCommitId,
    }),
  };
  const updated = await options.store.updateProposal({
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
    reviewId: options.reviewId,
    markReviewApplied: options.markReviewApplied,
  });
  if (!finalizedReview.ok) return finalizedReview.result;

  return ok(fastForwardAcceptResult(updated.value.id, accepted));
}

async function markProposalMergeConflicted(options: {
  readonly store: AgentProposalMetadataStore;
  readonly input: AcceptProviderBackedAgentProposalOptions['input'];
  readonly proposalId: AgentProposalRecord['id'];
  readonly review: VersionMergeReview;
  readonly diagnostics: readonly VersionDiagnostic[];
}): Promise<VersionResult<AgentProposalAcceptResult>> {
  const mergePreviewId = mergePreviewIdForReview(options.review, options.input.clientRequestId);
  const updated = await options.store.updateProposal({
    clientRequestId: options.input.clientRequestId,
    proposalId: options.input.proposalId,
    expectedRevision: options.input.expectedRevision,
    status: 'merge_conflicted',
    trustedActor: options.input.actor,
    diagnostics: [
      ...options.diagnostics,
      acceptDiagnostic(
        'merge_conflicted',
        'warning',
        'Proposal acceptance found merge conflicts that require review resolution.',
        {
          mergePreviewId,
          conflictCount: options.review.conflicts.length,
        },
      ),
    ],
  });
  if (!updated.ok) return storeFailure(updated);

  return ok({
    status: 'merge_conflicted',
    proposalId: options.proposalId,
    mergePreviewId,
    conflictIds: options.review.conflicts.map((conflict) => conflict.conflictId),
  });
}

function mergePreviewIdForReview(review: VersionMergeReview, clientRequestId: string): string {
  return review.resultId ?? `proposal-merge-preview:${clientRequestId}`;
}

function retargetFailure<T>(
  result: Extract<VersionResult<unknown>, { readonly ok: false }>,
): VersionResult<T> {
  return {
    ok: false,
    error:
      result.error.code === 'target_unavailable'
        ? { ...result.error, target: 'workbook.version.proposals.advanced.acceptProposal' }
        : result.error,
  };
}

function targetUnavailableFromDiagnostics<T>(
  code: string,
  message: string,
  diagnostics: readonly unknown[],
): VersionResult<T> {
  if (diagnostics.length === 0) return targetUnavailable(code, message);
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.proposals.advanced.acceptProposal',
      diagnostics: diagnostics.map((item) => publicDiagnosticFromUnknown(item, code, message)),
    },
  };
}

function publicDiagnosticFromUnknown(
  value: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): VersionDiagnostic {
  if (!isRecord(value)) return acceptDiagnostic(fallbackCode, 'error', fallbackMessage);
  const code =
    stringValue(value.issueCode) ??
    stringValue(value.code) ??
    fallbackCode;
  const message =
    stringValue(value.safeMessage) ??
    stringValue(value.message) ??
    fallbackMessage;
  return acceptDiagnostic(code, diagnosticSeverity(value.severity), message);
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

function acceptDiagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
  data?: Readonly<Record<string, string | number | boolean | null>>,
): VersionDiagnostic {
  return {
    code,
    severity,
    message,
    owner: 'version-store',
    ...(data === undefined ? {} : { data }),
  };
}

function diagnosticSeverity(value: unknown): VersionDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' ? value : 'error';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function recordRevisionsEqual(left: VersionRecordRevision, right: RefVersion): boolean {
  return left.kind === right.kind && left.value === right.value;
}

function revisionLabel(revision: VersionRecordRevision | RefVersion): string {
  return `${revision.kind}:${revision.value}`;
}
