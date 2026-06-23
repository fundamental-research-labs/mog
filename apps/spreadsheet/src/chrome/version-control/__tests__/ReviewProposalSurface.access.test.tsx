import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { reviewProposalAccessDiagnosticsFromSummaries } from '../review-proposal-access-diagnostics';
import {
  BASE_COMMIT_ID,
  HEAD_COMMIT_ID,
  PROPOSAL_COMMIT_ID,
  createProposal,
  createReview,
  createSurfaceStatus,
  expectAcceptControlAbsent,
  renderReviewProposalSurface,
  withDiagnostics,
} from './ReviewProposalSurface.test-utils';

describe('ReviewProposalSurface access projections', () => {
  it('surfaces access projection diagnostics and blocks denied diff activation', async () => {
    const user = userEvent.setup();
    const onOpenDiff = jest.fn();
    const onAcceptProposal = jest.fn();
    const reviewDeniedMessage = 'Review diff omitted authored semantic changes.';
    const proposalPartialMessage = 'Proposal diff hides redacted workbook changes.';

    renderReviewProposalSurface({
      surface: createSurfaceStatus(),
      reviews: [createReview()],
      proposals: [createProposal()],
      onOpenDiff,
      onAcceptProposal,
      accessDiagnostics: {
        reviews: {
          'review-1': {
            state: 'denied',
            code: 'VERSION_REVIEW_DIFF_INCOMPLETE',
            severity: 'error',
            reason: 'access-denied',
            message: reviewDeniedMessage,
            hiddenChangeCount: 2,
            omittedDomainCount: 2,
            domains: ['charts', 'filters'],
          },
        },
        proposals: {
          'proposal-1': {
            state: 'partial',
            code: 'VERSION_REVIEW_DIFF_PARTIAL',
            severity: 'warning',
            reason: 'redaction-policy',
            message: proposalPartialMessage,
            redactedChangeCount: 1,
            omittedDomainCount: 1,
            domains: ['validations'],
          },
        },
      },
    });

    const reviewRow = screen.getByRole('button', {
      name: 'Open review diff for Forecast review approved',
    });
    const reviewDiagnostic = screen.getByTestId('version-review-record-access-diagnostic');
    expect(reviewRow).toHaveAccessibleName('Open review diff for Forecast review approved');
    expect(reviewRow).toHaveAttribute('aria-disabled', 'true');
    expect(reviewRow).toHaveAttribute('data-actionable', 'false');
    expect(reviewRow).toHaveAttribute('data-access-projection', 'denied');
    expect(reviewRow).toHaveAttribute(
      'data-access-diagnostic-code',
      'VERSION_REVIEW_DIFF_INCOMPLETE',
    );
    expect(reviewRow).toHaveAttribute('data-hidden-change-count', '2');
    expect(reviewDiagnostic).toHaveAttribute('data-access-projection', 'denied');
    expect(reviewDiagnostic).toHaveAttribute('data-redaction-reason', 'access-denied');
    expect(reviewDiagnostic).toHaveTextContent('Diff denied');
    expect(reviewDiagnostic).toHaveTextContent('Hidden 2');
    expect(reviewDiagnostic).toHaveTextContent('Scope charts, filters');
    expect(reviewRow).toHaveAccessibleDescription(reviewDeniedMessage);

    await user.click(reviewRow);
    expect(onOpenDiff).not.toHaveBeenCalled();

    const proposalRow = screen.getByRole('button', {
      name: 'Open proposal diff for Budget scenario ready_for_review',
    });
    const proposalDiagnostic = screen.getByTestId('version-proposal-record-access-diagnostic');
    expect(proposalRow).toHaveAccessibleName(
      'Open proposal diff for Budget scenario ready_for_review',
    );
    expect(proposalRow).toHaveAttribute('aria-disabled', 'false');
    expect(proposalRow).toHaveAttribute('data-actionable', 'true');
    expect(proposalRow).toHaveAttribute('data-access-projection', 'partial');
    expect(proposalRow).toHaveAttribute('data-redacted-change-count', '1');
    expect(proposalRow).toHaveAttribute('data-omitted-domain-count', '1');
    expect(proposalDiagnostic).toHaveTextContent('Diff partially hidden');
    expect(proposalDiagnostic).toHaveTextContent('Redacted 1');
    expect(proposalDiagnostic).toHaveTextContent('Scope validations');
    expect(proposalRow).toHaveAccessibleDescription(proposalPartialMessage);

    await user.click(proposalRow);
    expect(onOpenDiff).toHaveBeenCalledWith({
      recordKind: 'proposal',
      recordId: 'proposal-1',
      baseCommitId: BASE_COMMIT_ID,
      targetCommitId: PROPOSAL_COMMIT_ID,
    });

    expect(
      screen.queryByRole('button', {
        name: 'Accept proposal Budget scenario',
      }),
    ).not.toBeInTheDocument();
    expect(onAcceptProposal).not.toHaveBeenCalled();
  });

  it('redacts provider-unavailable projection diagnostics and suppresses proposal actions', async () => {
    const user = userEvent.setup();
    const onOpenDiff = jest.fn();
    const onAcceptProposal = jest.fn();
    const privateCommitId = `commit:sha256:${'e'.repeat(64)}`;
    const accessDiagnostics = reviewProposalAccessDiagnosticsFromSummaries({
      reviews: [],
      proposals: [
        withDiagnostics(createProposal(), [
          {
            code: 'VERSION_PROPOSAL_SERVICE_UNAVAILABLE',
            severity: 'error',
            message: `Proposal provider failed for principal principal-secret on refs/heads/private at ${privateCommitId}.`,
            data: {
              reason: 'provider-unavailable',
              principalId: 'principal-secret',
              targetRef: 'refs/heads/private',
              commitId: privateCommitId,
            },
          },
        ]),
      ],
    });

    renderReviewProposalSurface({
      surface: createSurfaceStatus(),
      reviews: [],
      proposals: [createProposal()],
      onOpenDiff,
      onAcceptProposal,
      accessDiagnostics,
    });

    const proposalRow = screen.getByRole('button', {
      name: 'Open proposal diff for Budget scenario ready_for_review',
    });
    const diagnostic = screen.getByTestId('version-proposal-record-access-diagnostic');
    expect(proposalRow).toHaveAttribute('aria-disabled', 'true');
    expect(proposalRow).toHaveAttribute('data-actionable', 'false');
    expect(proposalRow).toHaveAttribute('data-access-projection', 'unavailable');
    expect(proposalRow).toHaveAttribute(
      'data-access-diagnostic-code',
      'VERSION_PROPOSAL_PROVIDER_UNAVAILABLE',
    );
    expect(diagnostic).toHaveTextContent('Proposal unavailable');
    expect(diagnostic).toHaveTextContent('Proposal details are temporarily unavailable.');
    expect(screen.getByTestId('version-review-proposal-surface')).not.toHaveTextContent(
      'principal-secret',
    );
    expect(screen.getByTestId('version-review-proposal-surface')).not.toHaveTextContent(
      'refs/heads/private',
    );
    expect(screen.getByTestId('version-review-proposal-surface')).not.toHaveTextContent(
      privateCommitId,
    );
    expectAcceptControlAbsent();

    await user.click(proposalRow);
    expect(onOpenDiff).not.toHaveBeenCalled();
    expect(onAcceptProposal).not.toHaveBeenCalled();
  });

  it('surfaces stale access diagnostics without blocking read-only diff activation', async () => {
    const user = userEvent.setup();
    const onOpenDiff = jest.fn();
    const onAcceptProposal = jest.fn();
    const reviewStaleMessage =
      'Review Forecast review is stale; create a new review before applying changes.';
    const proposalStaleMessage =
      'Proposal Budget scenario is stale because the target branch moved. Review remains read-only until a new proposal or merge is created.';

    renderReviewProposalSurface({
      surface: createSurfaceStatus(),
      reviews: [createReview({ status: 'stale' })],
      proposals: [createProposal({ status: 'stale' })],
      onOpenDiff,
      onAcceptProposal,
      accessDiagnostics: {
        reviews: {
          'review-1': {
            state: 'stale',
            code: 'VERSION_REVIEW_STALE',
            severity: 'warning',
            reason: 'stale',
            message: reviewStaleMessage,
          },
        },
        proposals: {
          'proposal-1': {
            state: 'stale',
            code: 'VERSION_PROPOSAL_STALE',
            severity: 'warning',
            reason: 'stale',
            message: proposalStaleMessage,
          },
        },
      },
    });

    const reviewRow = screen.getByRole('button', {
      name: 'Open review diff for Forecast review stale',
    });
    expect(reviewRow).toHaveAccessibleName('Open review diff for Forecast review stale');
    expect(reviewRow).toHaveAttribute('data-access-projection', 'stale');
    expect(reviewRow).toHaveAttribute('data-access-diagnostic-code', 'VERSION_REVIEW_STALE');
    expect(reviewRow).toHaveAttribute('data-actionable', 'true');
    expect(reviewRow).toHaveAccessibleDescription(reviewStaleMessage);

    const proposalRow = screen.getByRole('button', {
      name: 'Open proposal diff for Budget scenario stale',
    });
    expect(proposalRow).toHaveAccessibleName('Open proposal diff for Budget scenario stale');
    expect(proposalRow).toHaveAttribute('data-access-projection', 'stale');
    expect(proposalRow).toHaveAttribute('data-access-diagnostic-code', 'VERSION_PROPOSAL_STALE');
    expect(proposalRow).toHaveAttribute('data-actionable', 'true');
    expect(proposalRow).toHaveAccessibleDescription(proposalStaleMessage);
    expect(screen.getByText('Review stale')).toBeVisible();
    expect(screen.getByText('Proposal stale')).toBeVisible();

    await user.click(reviewRow);
    await user.click(proposalRow);
    expect(onOpenDiff).toHaveBeenNthCalledWith(1, {
      recordKind: 'review',
      recordId: 'review-1',
      baseCommitId: BASE_COMMIT_ID,
      targetCommitId: HEAD_COMMIT_ID,
    });
    expect(onOpenDiff).toHaveBeenNthCalledWith(2, {
      recordKind: 'proposal',
      recordId: 'proposal-1',
      baseCommitId: BASE_COMMIT_ID,
      targetCommitId: PROPOSAL_COMMIT_ID,
    });

    expectAcceptControlAbsent();
    expect(onAcceptProposal).not.toHaveBeenCalled();
  });
});
