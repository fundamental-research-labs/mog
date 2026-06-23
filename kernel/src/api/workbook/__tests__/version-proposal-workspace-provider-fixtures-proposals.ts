import { expect } from '@jest/globals';
import type { VersionUpdateReviewStatusInput } from '@mog-sdk/contracts/api';

import type { WorkbookVersionImpl } from '../version';
import {
  ACTOR,
  PASSED_VERIFICATION,
  openProposalWorkspace,
} from './version-proposal-workspace-provider-fixtures-core';
import type { ProposalWorkspaceGraph } from './version-proposal-workspace-provider-fixtures-graph';

export async function createReadyReviewedProposal(
  version: WorkbookVersionImpl,
  graph: ProposalWorkspaceGraph,
  suffix: string,
  approve = true,
) {
  const opened = await openProposalWorkspace(version, suffix);
  const committed = await version.commitProposalWorkspace({
    clientRequestId: `workspace-commit-${suffix}`,
    proposalId: opened.proposalId,
    workspaceId: opened.workspaceId,
    expectedRevision: 2,
    actor: ACTOR,
    message: 'Agent proposal commit',
  });
  if (!committed.ok) throw new Error(`expected proposal commit success: ${committed.error.code}`);
  const verified = await version.markProposalVerified({
    clientRequestId: `proposal-verify-${suffix}`,
    proposalId: opened.proposalId,
    expectedRevision: 3,
    actor: ACTOR,
    verification: PASSED_VERIFICATION,
  });
  if (!verified.ok) throw new Error(`expected proposal verify success: ${verified.error.code}`);
  const review = await version.openProposalReview({
    clientRequestId: `proposal-review-${suffix}`,
    proposalId: opened.proposalId,
    expectedRevision: 4,
    actor: ACTOR,
  });
  if (!review.ok) throw new Error(`expected proposal review success: ${review.error.code}`);
  if (approve) {
    const approved = await approveReview(
      version,
      review.value.id,
      review.value.revision,
      `proposal-review-approve-${suffix}`,
    );
    if (!approved.ok) throw new Error(`expected review approval success: ${approved.error.code}`);
  }

  expect(committed.value.baseCommitId).toBe(graph.rootCommitId);
  return {
    proposalId: opened.proposalId,
    proposalCommitId: committed.value.proposalCommitId,
    reviewId: review.value.id,
  };
}

function approveReview(
  version: WorkbookVersionImpl,
  reviewId: VersionUpdateReviewStatusInput['reviewId'],
  expectedRevision: number,
  clientRequestId: string,
) {
  return version.updateReviewStatus({
    reviewId,
    expectedRevision,
    clientRequestId,
    status: 'approved',
    actor: ACTOR,
  });
}
