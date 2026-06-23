import type {
  AgentProposalSummary,
  VersionDiagnostic,
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
      reviews: [
        createReview({
          status: 'stale',
          title: 'Forecast review for reviewer-secret on refs/heads/private',
        }),
      ],
      proposals: [
        createProposal({
          status: 'stale',
          title: 'Budget proposal for principal-secret on refs/heads/private',
        }),
      ],
    });

    expect(diagnostics).toEqual({
      reviews: {
        'review-1': {
          state: 'stale',
          code: 'VERSION_REVIEW_STALE',
          severity: 'warning',
          reason: 'stale',
          message: 'Review is stale; create a new review before applying changes.',
        },
      },
      proposals: {
        'proposal-1': {
          state: 'stale',
          code: 'VERSION_PROPOSAL_STALE',
          severity: 'warning',
          reason: 'stale',
          message:
            'Proposal is stale because the target branch moved. Review remains read-only until a new proposal or merge is created.',
        },
      },
    });
    expectNoUnsafeDetails(diagnostics);
  });

  it('maps provider denial diagnostics to stable public messages', () => {
    const diagnostics = reviewProposalAccessDiagnosticsFromSummaries({
      reviews: [
        withDiagnostics(
          createReview({
            title: 'Reviewer principal-secret on refs/heads/private',
            createdBy: {
              kind: 'user',
              trust: 'trusted',
              displayName: 'reviewer-secret',
            },
          }),
          [
            {
              code: 'VERSION_REVIEW_ACCESS_DENIED',
              severity: 'error',
              message: 'Review read denied for principal-secret on refs/heads/private.',
              data: {
                deniedPrincipalId: 'principal-secret',
                payload: {
                  deniedCapabilities: ['version:reviewRead'],
                  deniedPrincipal: 'principal-secret',
                  targetRef: 'refs/heads/private',
                },
              },
            },
          ],
        ),
      ],
      proposals: [
        withDiagnostics(
          createProposal({
            title: 'Proposal principal-secret on refs/heads/private',
            agent: {
              kind: 'agent',
              trust: 'trusted',
              displayName: 'agent-secret',
              agentRunId: 'agent-run-secret',
            },
          }),
          [
            {
              code: 'VERSION_PERMISSION_DENIED',
              severity: 'error',
              message: 'Proposal read denied for principal-secret on refs/heads/private.',
              data: {
                reason: 'provider-denial',
                deniedPrincipalId: 'principal-secret',
                targetRef: 'refs/heads/private',
              },
            },
          ],
        ),
      ],
    });

    expect(diagnostics).toEqual({
      reviews: {
        'review-1': {
          state: 'denied',
          code: 'VERSION_REVIEW_ACCESS_DENIED',
          severity: 'error',
          reason: 'access-denied',
          message: 'Review details are not available for the current caller.',
        },
      },
      proposals: {
        'proposal-1': {
          state: 'denied',
          code: 'VERSION_PROPOSAL_ACCESS_DENIED',
          severity: 'error',
          reason: 'access-denied',
          message: 'Proposal details are not available for the current caller.',
        },
      },
    });
    expectNoUnsafeDetails(diagnostics);
  });

  it('maps provider not-found diagnostics to stable public messages', () => {
    const diagnostics = reviewProposalAccessDiagnosticsFromSummaries({
      reviews: [
        withDiagnostics(createReview(), [
          {
            code: 'VERSION_PROVIDER_ERROR',
            severity: 'error',
            message: 'Review review-secret was not found on refs/heads/private.',
            data: {
              reason: 'review-not-found',
              reviewId: 'review-secret',
              targetRef: 'refs/heads/private',
            },
          },
        ]),
      ],
      proposals: [
        withDiagnostics(createProposal(), [
          {
            code: 'VERSION_PROVIDER_ERROR',
            severity: 'error',
            message: 'Proposal proposal-secret was not found on refs/heads/private.',
            data: {
              reason: 'proposal-not-found',
              proposalId: 'proposal-secret',
              targetRef: 'refs/heads/private',
            },
          },
        ]),
      ],
    });

    expect(diagnostics).toEqual({
      reviews: {
        'review-1': {
          state: 'denied',
          code: 'VERSION_REVIEW_NOT_FOUND',
          severity: 'warning',
          reason: 'review-not-found',
          message: 'Review details are not available because the review could not be found.',
        },
      },
      proposals: {
        'proposal-1': {
          state: 'denied',
          code: 'VERSION_PROPOSAL_NOT_FOUND',
          severity: 'warning',
          reason: 'proposal-not-found',
          message: 'Proposal details are not available because the proposal could not be found.',
        },
      },
    });
    expectNoUnsafeDetails(diagnostics);
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

function withDiagnostics<T extends object>(
  summary: T,
  diagnostics: readonly VersionDiagnostic[],
): T {
  return { ...summary, diagnostics };
}

function expectNoUnsafeDetails(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('principal-secret');
  expect(serialized).not.toContain('reviewer-secret');
  expect(serialized).not.toContain('agent-secret');
  expect(serialized).not.toContain('agent-run-secret');
  expect(serialized).not.toContain('review-secret');
  expect(serialized).not.toContain('proposal-secret');
  expect(serialized).not.toContain('refs/heads/private');
}

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
