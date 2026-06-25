import { render, screen } from '@testing-library/react';
import type {
  AgentProposalSummary,
  VersionCapability,
  VersionCapabilityState,
  VersionDiagnostic,
  VersionSurfaceStatus,
  WorkbookCommitId,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

import { ReviewProposalSurface, type ReviewProposalSurfaceProps } from '../ReviewProposalSurface';

export const BASE_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
export const HEAD_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
export const PROPOSAL_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;

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

type RenderReviewProposalSurfaceOptions = Omit<
  ReviewProposalSurfaceProps,
  'surface' | 'reviews' | 'proposals'
> & {
  readonly surface?: VersionSurfaceStatus;
  readonly reviews?: readonly WorkbookVersionReviewRecordSummary[];
  readonly proposals?: readonly AgentProposalSummary[];
};

export function renderReviewProposalSurface(options: RenderReviewProposalSurfaceOptions = {}) {
  const result = render(<ReviewProposalSurface {...reviewProposalSurfaceProps(options)} />);

  return {
    ...result,
    rerenderSurface: (nextOptions: RenderReviewProposalSurfaceOptions = {}) => {
      result.rerender(<ReviewProposalSurface {...reviewProposalSurfaceProps(nextOptions)} />);
    },
  };
}

function reviewProposalSurfaceProps({
  surface = createSurfaceStatus(),
  reviews = [createReview()],
  proposals = [createProposal()],
  ...options
}: RenderReviewProposalSurfaceOptions): ReviewProposalSurfaceProps {
  return {
    surface,
    reviews,
    proposals,
    ...options,
  };
}

export function createSurfaceStatus({
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

export function createReview(
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

export function createProposal(
  overrides: Partial<AgentProposalSummary> = {},
): AgentProposalSummary {
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

export function withDiagnostics<T extends object>(
  summary: T,
  diagnostics: readonly VersionDiagnostic[],
): T {
  return { ...summary, diagnostics };
}

export function disabledCapability(reason: string): VersionCapabilityState {
  return {
    enabled: false,
    dependency: 'VC-05',
    reason,
    retryable: false,
  };
}

export function expectAcceptControlAbsent(): void {
  expect(
    screen.queryByRole('button', {
      name: 'Accept proposal Budget scenario',
    }),
  ).not.toBeInTheDocument();
}

export function shortCommitId(id: string): string {
  return id.slice('commit:sha256:'.length, 'commit:sha256:'.length + 12);
}
