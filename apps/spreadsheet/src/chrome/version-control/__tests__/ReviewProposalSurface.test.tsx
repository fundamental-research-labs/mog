import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AgentProposalSummary,
  VersionCapability,
  VersionCapabilityState,
  VersionDiagnostic,
  VersionSurfaceStatus,
  WorkbookCommitId,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

import { ReviewProposalSurface } from '../ReviewProposalSurface';
import { reviewProposalAccessDiagnosticsFromSummaries } from '../review-proposal-access-diagnostics';

const BASE_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const HEAD_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
const PROPOSAL_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;

const ALL_CAPABILITIES: readonly VersionCapability[] = [
  'version:read',
  'version:diff',
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:reviewRead',
  'version:reviewWrite',
  'version:proposal',
  'version:mergePreview',
  'version:mergeApply',
  'version:revert',
  'version:provenance',
  'version:remotePromote',
];

describe('ReviewProposalSurface', () => {
  it('renders stable selectors for status rows and persisted diff target handles', () => {
    render(
      <ReviewProposalSurface
        surface={createSurfaceStatus()}
        reviews={[createReview()]}
        proposals={[createProposal()]}
      />,
    );

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

    render(
      <ReviewProposalSurface
        surface={createSurfaceStatus()}
        reviews={[createReview()]}
        proposals={[createProposal()]}
        onOpenDiff={onOpenDiff}
      />,
    );

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

    render(
      <ReviewProposalSurface
        surface={createSurfaceStatus()}
        reviews={[createReview()]}
        proposals={[]}
        diffEnabled={false}
        diffDisabledReason="Diff service is unavailable."
        onOpenDiff={onOpenDiff}
      />,
    );

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

  it('surfaces access projection diagnostics and blocks denied diff activation', async () => {
    const user = userEvent.setup();
    const onOpenDiff = jest.fn();
    const onAcceptProposal = jest.fn();
    const reviewDeniedMessage = 'Review diff omitted authored semantic changes.';
    const proposalPartialMessage = 'Proposal diff hides redacted workbook changes.';

    render(
      <ReviewProposalSurface
        surface={createSurfaceStatus()}
        reviews={[createReview()]}
        proposals={[createProposal()]}
        onOpenDiff={onOpenDiff}
        onAcceptProposal={onAcceptProposal}
        accessDiagnostics={{
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
        }}
      />,
    );

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

  it('renders proposal accept controls only for mergeable visible proposals', async () => {
    const user = userEvent.setup();
    const onAcceptProposal = jest.fn();
    const proposalPartialMessage = 'Proposal diff hides redacted workbook changes.';
    const proposalDeniedMessage = 'Proposal diff is hidden by workbook access policy.';
    const privateCommitId = `commit:sha256:${'d'.repeat(64)}`;
    const { rerender } = render(
      <ReviewProposalSurface
        surface={createSurfaceStatus()}
        reviews={[]}
        proposals={[createProposal()]}
        onAcceptProposal={onAcceptProposal}
      />,
    );

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
    rerender(
      <ReviewProposalSurface
        surface={createSurfaceStatus({
          capabilityOverrides: {
            'version:mergeApply': disabledCapability(
              `Merge apply is unavailable for principal principal-secret on refs/heads/private at ${privateCommitId}.`,
            ),
          },
        })}
        reviews={[]}
        proposals={[createProposal()]}
        onAcceptProposal={onAcceptProposal}
      />,
    );

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

    rerender(
      <ReviewProposalSurface
        surface={createSurfaceStatus({
          capabilityOverrides: {
            'version:proposal': disabledCapability(
              `Proposal surface disabled for principal principal-secret on refs/heads/private at ${privateCommitId}.`,
            ),
          },
        })}
        reviews={[]}
        proposals={[createProposal()]}
        onAcceptProposal={onAcceptProposal}
      />,
    );

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

    rerender(
      <ReviewProposalSurface
        surface={createSurfaceStatus()}
        reviews={[]}
        proposals={[createProposal()]}
        onAcceptProposal={onAcceptProposal}
        accessDiagnostics={{
          proposals: {
            'proposal-1': {
              state: 'partial',
              severity: 'warning',
              message: proposalPartialMessage,
              redactedChangeCount: 1,
            },
          },
        }}
      />,
    );

    expectAcceptControlAbsent();
    expect(screen.getByTestId('version-proposal-record-access-diagnostic')).toHaveTextContent(
      proposalPartialMessage,
    );
    expect(onAcceptProposal).not.toHaveBeenCalled();

    rerender(
      <ReviewProposalSurface
        surface={createSurfaceStatus()}
        reviews={[]}
        proposals={[createProposal()]}
        onAcceptProposal={onAcceptProposal}
        accessDiagnostics={{
          proposals: {
            'proposal-1': {
              state: 'denied',
              severity: 'error',
              message: proposalDeniedMessage,
              hiddenChangeCount: 3,
            },
          },
        }}
      />,
    );

    expectAcceptControlAbsent();
    expect(screen.getByTestId('version-proposal-record-access-diagnostic')).toHaveTextContent(
      proposalDeniedMessage,
    );
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

    render(
      <ReviewProposalSurface
        surface={createSurfaceStatus()}
        reviews={[]}
        proposals={[createProposal()]}
        onOpenDiff={onOpenDiff}
        onAcceptProposal={onAcceptProposal}
        accessDiagnostics={accessDiagnostics}
      />,
    );

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

    render(
      <ReviewProposalSurface
        surface={createSurfaceStatus()}
        reviews={[createReview({ status: 'stale' })]}
        proposals={[createProposal({ status: 'stale' })]}
        onOpenDiff={onOpenDiff}
        onAcceptProposal={onAcceptProposal}
        accessDiagnostics={{
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
        }}
      />,
    );

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

  it('shows disabled and unavailable reasons with stable selectors', () => {
    render(
      <ReviewProposalSurface
        surface={createSurfaceStatus({
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
        })}
        reviews={[]}
        proposals={[]}
      />,
    );

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

function createSurfaceStatus({
  storage = {},
  capabilityOverrides = {},
}: {
  readonly storage?: Partial<VersionSurfaceStatus['storage']>;
  readonly capabilityOverrides?: Partial<Record<VersionCapability, VersionCapabilityState>>;
} = {}): VersionSurfaceStatus {
  return {
    schemaVersion: 1,
    documentId: 'document-1',
    stage: 'authoring',
    featureGateEnabled: true,
    storage: {
      ready: true,
      backend: 'memory',
      diagnostics: [],
      ...storage,
    },
    current: {
      headCommitId: HEAD_COMMIT_ID,
      branchName: 'refs/heads/main',
      detached: false,
      stale: false,
    },
    dirty: {
      statusRevision: '1',
      checkoutPreflightToken: 'token-1',
      hasUncommittedLocalChanges: false,
      commitEligibleChanges: true,
      unsupportedDirtyDomains: [],
      pendingProviderWrites: false,
      pendingRecalc: false,
      checkoutSafe: true,
      unsafeReasons: [],
      source: 'VC-05',
      diagnostics: [],
    },
    capabilities: Object.fromEntries(
      ALL_CAPABILITIES.map((capability) => [
        capability,
        capabilityOverrides[capability] ?? { enabled: true },
      ]),
    ) as VersionSurfaceStatus['capabilities'],
    diagnostics: [],
  };
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

function withDiagnostics<T extends object>(
  summary: T,
  diagnostics: readonly VersionDiagnostic[],
): T {
  return { ...summary, diagnostics };
}

function disabledCapability(reason: string): VersionCapabilityState {
  return {
    enabled: false,
    dependency: 'VC-05',
    reason,
    retryable: false,
  };
}

function expectAcceptControlAbsent(): void {
  expect(
    screen.queryByRole('button', {
      name: 'Accept proposal Budget scenario',
    }),
  ).not.toBeInTheDocument();
}

function shortCommitId(id: string): string {
  return id.slice('commit:sha256:'.length, 'commit:sha256:'.length + 12);
}
