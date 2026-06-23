import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AgentProposalSummary,
  VersionCapability,
  VersionCapabilityState,
  VersionSurfaceStatus,
  WorkbookCommitId,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

import { ReviewProposalSurface } from '../ReviewProposalSurface';

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
    expect(
      screen.getByTestId('version-review-diff-persistence-storage-reason'),
    ).toHaveTextContent('IndexedDB version store is not ready.');
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

function createReview(): WorkbookVersionReviewRecordSummary {
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
  };
}

function createProposal(): AgentProposalSummary {
  return {
    id: 'proposal-1' as AgentProposalSummary['id'],
    documentId: 'document-1',
    title: 'Budget scenario',
    targetRef: 'refs/heads/main' as AgentProposalSummary['targetRef'],
    baseCommitId: BASE_COMMIT_ID,
    targetHeadIdAtCreation: HEAD_COMMIT_ID,
    proposalBranchName:
      'refs/heads/agent/proposal-1' as AgentProposalSummary['proposalBranchName'],
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
  };
}

function disabledCapability(reason: string): VersionCapabilityState {
  return {
    enabled: false,
    dependency: 'VC-05',
    reason,
    retryable: false,
  };
}

function shortCommitId(id: string): string {
  return id.slice('commit:sha256:'.length, 'commit:sha256:'.length + 12);
}
