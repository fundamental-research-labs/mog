import type {
  AgentProposalSummary,
  WorkbookCommitId,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

import { shortCommitId } from './review-proposal-formatting';

export function reviewTargetEvidence(review: WorkbookVersionReviewRecordSummary): {
  readonly label: string;
  readonly baseCommitId?: WorkbookCommitId;
  readonly headCommitId?: WorkbookCommitId;
} {
  const baseCommitId = review.baseCommitId ?? subjectBaseCommitId(review);
  const headCommitId = review.headCommitId ?? subjectHeadCommitId(review);

  if (baseCommitId && headCommitId) {
    return {
      label: `Base ${shortCommitId(baseCommitId)} · Head ${shortCommitId(headCommitId)}`,
      baseCommitId,
      headCommitId,
    };
  }

  if (review.subject.kind === 'commit') {
    return {
      label: `Commit ${shortCommitId(review.subject.commitId)}`,
      headCommitId: review.subject.commitId,
    };
  }

  if (review.subject.kind === 'proposal') {
    return {
      label: `Proposal ${review.subject.proposalId}`,
      baseCommitId,
      headCommitId,
    };
  }

  if (review.subject.kind === 'merge') {
    return { label: `Merge preview ${review.subject.mergePreviewId}` };
  }

  if (review.subject.kind === 'conflict') {
    return {
      label: `Conflict ${review.subject.conflictId} · Merge preview ${review.subject.mergePreviewId}`,
    };
  }

  return { label: review.subject.kind };
}

export function proposalTargetEvidence(proposal: AgentProposalSummary): string {
  const parts = [
    `Base ${shortCommitId(proposal.baseCommitId)}`,
    `Target ${shortCommitId(proposal.targetHeadIdAtCreation)}`,
  ];
  if (proposal.proposalCommitId) {
    parts.push(`Proposal ${shortCommitId(proposal.proposalCommitId)}`);
  }
  return parts.join(' · ');
}

function subjectBaseCommitId(
  review: WorkbookVersionReviewRecordSummary,
): WorkbookCommitId | undefined {
  if (review.subject.kind === 'commitRange' || review.subject.kind === 'proposal') {
    return review.subject.baseCommitId;
  }
  return undefined;
}

function subjectHeadCommitId(
  review: WorkbookVersionReviewRecordSummary,
): WorkbookCommitId | undefined {
  if (review.subject.kind === 'commitRange' || review.subject.kind === 'proposal') {
    return review.subject.headCommitId;
  }
  return undefined;
}
