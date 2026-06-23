import type {
  AgentProposalSummary,
  WorkbookCommitId,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

import { reviewProposalAccessDiagnosticsFromSummaries } from '../review-proposal-access-diagnostics';

const BASE_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const HEAD_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
const PROPOSAL_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;

describe('reviewProposalAccessDiagnosticsFromSummaries', () => {
  it('projects stale review and proposal summaries into public-safe access diagnostics', () => {
    const diagnostics = reviewProposalAccessDiagnosticsFromSummaries({
      reviews: [createReview({ status: 'stale' })],
      proposals: [createProposal({ status: 'stale' })],
    });

    expect(diagnostics).toEqual({
      reviews: {
        'review-1': {
          state: 'stale',
          code: 'VERSION_REVIEW_STALE',
          severity: 'warning',
          reason: 'stale',
          message: 'Review Forecast review is stale; create a new review before applying changes.',
        },
      },
      proposals: {
        'proposal-1': {
          state: 'stale',
          code: 'VERSION_PROPOSAL_STALE',
          severity: 'warning',
          reason: 'stale',
          message:
            'Proposal Budget scenario is stale because the target branch moved. Review remains read-only until a new proposal or merge is created.',
        },
      },
    });
  });

  it('omits visible records', () => {
    expect(
      reviewProposalAccessDiagnosticsFromSummaries({
        reviews: [createReview()],
        proposals: [createProposal()],
      }),
    ).toBeUndefined();
  });
});

function createReview(
  overrides: Partial<WorkbookVersionReviewRecordSummary> = {},
): WorkbookVersionReviewRecordSummary {
  return {
    id: 'review-1',
    documentId: 'document-1',
    subject: {
      kind: 'commitRange',
      baseCommitId: BASE_COMMIT_ID,
      headCommitId: HEAD_COMMIT_ID,
    },
    status: 'approved',
    title: 'Forecast review',
    baseCommitId: BASE_COMMIT_ID,
    headCommitId: HEAD_COMMIT_ID,
    revision: 3,
    createdBy: {
      kind: 'user',
      trust: 'trusted',
      displayName: 'Reviewer',
    },
    updatedAt: '2026-06-22T10:30:00.000Z',
    ...overrides,
  };
}

function createProposal(overrides: Partial<AgentProposalSummary> = {}): AgentProposalSummary {
  return {
    id: 'proposal-1' as AgentProposalSummary['id'],
    documentId: 'document-1',
    title: 'Budget scenario',
    targetRef: 'refs/heads/main' as AgentProposalSummary['targetRef'],
    baseCommitId: BASE_COMMIT_ID,
    targetHeadIdAtCreation: HEAD_COMMIT_ID,
    proposalBranchName: 'refs/heads/agent/proposal-1' as AgentProposalSummary['proposalBranchName'],
    proposalCommitId: PROPOSAL_COMMIT_ID,
    status: 'ready_for_review',
    revision: 4,
    agentRunId: 'agent-run-1',
    agent: {
      kind: 'agent',
      trust: 'trusted',
      displayName: 'Planning agent',
      agentRunId: 'agent-run-1',
    },
    updatedAt: '2026-06-22T10:35:00.000Z',
    ...overrides,
  };
}
