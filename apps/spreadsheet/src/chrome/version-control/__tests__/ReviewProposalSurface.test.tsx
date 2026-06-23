import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  BASE_COMMIT_ID,
  HEAD_COMMIT_ID,
  PROPOSAL_COMMIT_ID,
  createProposal,
  createReview,
  createSurfaceStatus,
  disabledCapability,
  expectAcceptControlAbsent,
  renderReviewProposalSurface,
  shortCommitId,
} from './ReviewProposalSurface.test-utils';

describe('ReviewProposalSurface', () => {
  it('renders stable selectors for status rows and persisted diff target handles', () => {
    renderReviewProposalSurface({
      surface: createSurfaceStatus(),
      reviews: [createReview()],
      proposals: [createProposal()],
    });

    expect(screen.getByTestId('version-review-proposal-surface')).toBeVisible();
    expect(screen.getByTestId('version-review-status-row')).toHaveAttribute(
      'data-capability',
      'version:reviewRead',
    );
    expect(screen.getByTestId('version-review-status-row')).toHaveAttribute(
      'data-state',
      'available',
    );
    expect(screen.getByTestId('version-proposal-status-row')).toHaveAttribute(
      'data-capability',
      'version:proposal',
    );

    const evidence = screen.getByTestId('version-review-diff-persistence-evidence');
    expect(evidence).toHaveAttribute('data-storage-backend', 'memory');
    expect(evidence).toHaveAttribute('data-storage-ready', 'true');
    expect(evidence).toHaveAttribute('data-diff-enabled', 'true');
    expect(evidence).toHaveAttribute('data-current-head-id', HEAD_COMMIT_ID);
    expect(evidence).toHaveTextContent('Diff enabled');
    expect(evidence).toHaveTextContent(shortCommitId(HEAD_COMMIT_ID));

    const reviewRow = screen.getByTestId('version-review-record-row');
    expect(reviewRow).toHaveAttribute('data-review-id', 'review-1');
    expect(reviewRow).toHaveAttribute('data-record-kind', 'review');
    expect(reviewRow).toHaveAttribute('data-review-status', 'approved');
    expect(reviewRow).toHaveAttribute('data-status', 'approved');
    expect(reviewRow).toHaveAttribute('data-review-subject', 'commitRange');
    expect(reviewRow).toHaveAttribute('data-base-commit-id', BASE_COMMIT_ID);
    expect(reviewRow).toHaveAttribute('data-head-commit-id', HEAD_COMMIT_ID);
    expect(reviewRow).toHaveTextContent(`Base ${shortCommitId(BASE_COMMIT_ID)}`);
    expect(reviewRow).toHaveTextContent(`Head ${shortCommitId(HEAD_COMMIT_ID)}`);

    const proposalRow = screen.getByTestId('version-proposal-record-row');
    expect(proposalRow).toHaveAttribute('data-proposal-id', 'proposal-1');
    expect(proposalRow).toHaveAttribute('data-record-kind', 'proposal');
    expect(proposalRow).toHaveAttribute('data-proposal-status', 'ready_for_review');
    expect(proposalRow).toHaveAttribute('data-status', 'ready_for_review');
    expect(proposalRow).toHaveAttribute('data-target-ref', 'refs/heads/main');
    expect(proposalRow).toHaveAttribute('data-base-commit-id', BASE_COMMIT_ID);
    expect(proposalRow).toHaveAttribute('data-target-head-id', HEAD_COMMIT_ID);
    expect(proposalRow).toHaveAttribute('data-proposal-commit-id', PROPOSAL_COMMIT_ID);
    expect(proposalRow).toHaveTextContent(`Base ${shortCommitId(BASE_COMMIT_ID)}`);
    expect(proposalRow).toHaveTextContent(`Target ${shortCommitId(HEAD_COMMIT_ID)}`);
    expect(proposalRow).toHaveTextContent(`Proposal ${shortCommitId(PROPOSAL_COMMIT_ID)}`);
  });

  it('makes diff-backed rows keyboard focusable and activates them with commit handles', async () => {
    const user = userEvent.setup();
    const onOpenDiff = jest.fn();

    renderReviewProposalSurface({
      surface: createSurfaceStatus(),
      reviews: [createReview()],
      proposals: [createProposal()],
      onOpenDiff,
    });

    const reviewRow = screen.getByRole('button', {
      name: 'Open review diff for Forecast review approved',
    });
    const proposalRow = screen.getByRole('button', {
      name: 'Open proposal diff for Budget scenario ready_for_review',
    });

    expect(reviewRow).toHaveAttribute('data-actionable', 'true');
    expect(reviewRow).toHaveAttribute('data-diff-base-commit-id', BASE_COMMIT_ID);
    expect(reviewRow).toHaveAttribute('data-diff-target-commit-id', HEAD_COMMIT_ID);
    expect(proposalRow).toHaveAttribute('data-actionable', 'true');
    expect(proposalRow).toHaveAttribute('data-diff-base-commit-id', BASE_COMMIT_ID);
    expect(proposalRow).toHaveAttribute('data-diff-target-commit-id', PROPOSAL_COMMIT_ID);

    await user.tab();
    expect(reviewRow).toHaveFocus();
    await user.keyboard('{Enter}');

    await user.tab();
    expect(proposalRow).toHaveFocus();
    await user.keyboard('{Enter}');

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
  });

  it('keeps diff-backed rows focusable but inert with an accessible reason when diff is disabled', async () => {
    const user = userEvent.setup();
    const onOpenDiff = jest.fn();

    renderReviewProposalSurface({
      surface: createSurfaceStatus(),
      reviews: [createReview()],
      proposals: [],
      diffEnabled: false,
      diffDisabledReason: 'Diff service is unavailable.',
      onOpenDiff,
    });

    const reviewRow = screen.getByRole('button', {
      name: 'Open review diff for Forecast review approved',
    });

    expect(reviewRow).toHaveAttribute('aria-disabled', 'true');
    expect(reviewRow).toHaveAttribute('data-actionable', 'false');
    expect(reviewRow).toHaveAccessibleDescription('Diff service is unavailable.');

    await user.tab();
    expect(reviewRow).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onOpenDiff).not.toHaveBeenCalled();
  });

  it('renders proposal accept controls only for mergeable visible proposals', async () => {
    const user = userEvent.setup();
    const onAcceptProposal = jest.fn();
    const proposalPartialMessage = 'Proposal diff hides redacted workbook changes.';
    const proposalDeniedMessage = 'Proposal diff is hidden by workbook access policy.';
    const privateCommitId = `commit:sha256:${'d'.repeat(64)}`;
    const { rerenderSurface } = renderReviewProposalSurface({
      surface: createSurfaceStatus(),
      reviews: [],
      proposals: [createProposal()],
      onAcceptProposal,
    });

    const acceptButton = screen.getByRole('button', {
      name: 'Accept proposal Budget scenario',
    });
    expect(acceptButton).toHaveAccessibleName('Accept proposal Budget scenario');
    expect(acceptButton).toBeEnabled();
    expect(acceptButton).toHaveAttribute('data-capability', 'version:mergeApply');
    expect(acceptButton).toHaveAttribute('data-state', 'available');

    await user.click(acceptButton);
    expect(onAcceptProposal).toHaveBeenCalledWith({
      proposalId: 'proposal-1',
      expectedRevision: 4,
      expectedTargetHeadId: HEAD_COMMIT_ID,
      proposalCommitId: PROPOSAL_COMMIT_ID,
      targetRef: 'refs/heads/main',
    });

    onAcceptProposal.mockClear();
    rerenderSurface({
      surface: createSurfaceStatus({
        capabilityOverrides: {
          'version:mergeApply': disabledCapability(
            `Merge apply is unavailable for principal principal-secret on refs/heads/private at ${privateCommitId}.`,
          ),
        },
      }),
      reviews: [],
      proposals: [createProposal()],
      onAcceptProposal,
    });

    expectAcceptControlAbsent();
    expect(screen.getByTestId('version-merge-apply-status-row')).toHaveAttribute(
      'data-state',
      'unavailable',
    );
    expect(screen.getByTestId('version-merge-apply-unavailable-reason')).toHaveTextContent(
      'Merge apply is unavailable for principal [principal] on [version ref] at [commit].',
    );
    expect(screen.getByTestId('version-review-proposal-surface')).not.toHaveTextContent(
      'principal-secret',
    );
    expect(screen.getByTestId('version-review-proposal-surface')).not.toHaveTextContent(
      'refs/heads/private',
    );
    expect(screen.getByTestId('version-review-proposal-surface')).not.toHaveTextContent(
      privateCommitId,
    );

    rerenderSurface({
      surface: createSurfaceStatus({
        capabilityOverrides: {
          'version:proposal': disabledCapability(
            `Proposal surface disabled for principal principal-secret on refs/heads/private at ${privateCommitId}.`,
          ),
        },
      }),
      reviews: [],
      proposals: [createProposal()],
      onAcceptProposal,
    });

    expectAcceptControlAbsent();
    expect(screen.getByTestId('version-proposal-status-row')).toHaveAttribute(
      'data-state',
      'unavailable',
    );
    expect(screen.getByTestId('version-proposal-unavailable-reason')).toHaveTextContent(
      'Proposal surface disabled for principal [principal] on [version ref] at [commit].',
    );
    expect(screen.getByTestId('version-review-proposal-surface')).not.toHaveTextContent(
      'principal-secret',
    );
    expect(screen.getByTestId('version-review-proposal-surface')).not.toHaveTextContent(
      'refs/heads/private',
    );

    rerenderSurface({
      surface: createSurfaceStatus(),
      reviews: [],
      proposals: [createProposal()],
      onAcceptProposal,
      accessDiagnostics: {
        proposals: {
          'proposal-1': {
            state: 'partial',
            severity: 'warning',
            message: proposalPartialMessage,
            redactedChangeCount: 1,
          },
        },
      },
    });

    expectAcceptControlAbsent();
    expect(screen.getByTestId('version-proposal-record-access-diagnostic')).toHaveTextContent(
      proposalPartialMessage,
    );
    expect(onAcceptProposal).not.toHaveBeenCalled();

    rerenderSurface({
      surface: createSurfaceStatus(),
      reviews: [],
      proposals: [createProposal()],
      onAcceptProposal,
      accessDiagnostics: {
        proposals: {
          'proposal-1': {
            state: 'denied',
            severity: 'error',
            message: proposalDeniedMessage,
            hiddenChangeCount: 3,
          },
        },
      },
    });

    expectAcceptControlAbsent();
    expect(screen.getByTestId('version-proposal-record-access-diagnostic')).toHaveTextContent(
      proposalDeniedMessage,
    );
    expect(onAcceptProposal).not.toHaveBeenCalled();
  });

  it('shows disabled and unavailable reasons with stable selectors', () => {
    renderReviewProposalSurface({
      surface: createSurfaceStatus({
        storage: {
          ready: false,
          backend: 'indexeddb',
          diagnostics: [
            {
              code: 'version.surfaceStatus.storageUnavailable',
              severity: 'warning',
              message: 'IndexedDB version store is not ready.',
            },
          ],
        },
        capabilityOverrides: {
          'version:reviewRead': disabledCapability('Review records are unavailable.'),
          'version:proposal': disabledCapability('Proposal records are unavailable.'),
          'version:diff': disabledCapability('Diff service is unavailable.'),
        },
      }),
      reviews: [],
      proposals: [],
    });

    expect(screen.getByTestId('version-review-status-row')).toHaveAttribute(
      'data-state',
      'unavailable',
    );
    expect(screen.getByTestId('version-review-unavailable-reason')).toHaveTextContent(
      'Review records are unavailable.',
    );
    expect(screen.getByTestId('version-proposal-unavailable-reason')).toHaveTextContent(
      'Proposal records are unavailable.',
    );
    expect(screen.getByTestId('version-review-diff-persistence-storage-reason')).toHaveTextContent(
      'IndexedDB version store is not ready.',
    );
    expect(screen.getByTestId('version-diff-unavailable-reason')).toHaveTextContent(
      'Diff service is unavailable.',
    );
  });
});
