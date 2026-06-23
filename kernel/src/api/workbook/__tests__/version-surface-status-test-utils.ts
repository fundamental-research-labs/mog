import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import { withVersionManifest } from './version-domain-support-test-utils';

export const CHILD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
export const MOVED_COMMIT_ID = `commit:sha256:${'3'.repeat(64)}`;
export const REF_REVISION = { kind: 'counter', value: '2' } as const;

export const SURFACE_CAPABILITY_KEYS = [
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
  'version:refAdmin',
  'version:revert',
  'version:provenance',
  'version:remotePromote',
] as const;

export const HOST_DENIAL_SPLIT_CAPABILITIES = [
  'version:reviewRead',
  'version:reviewWrite',
  'version:proposal',
  'version:revert',
  'version:provenance',
  'version:mergeApply',
] as const;

type SurfaceCapabilityForAssertion = {
  readonly enabled: boolean;
  readonly dependency?: string;
  readonly reason?: string;
  readonly retryable?: boolean;
};

export function capabilityState(
  surface: { readonly capabilities: object },
  capability: string,
): SurfaceCapabilityForAssertion {
  return (surface.capabilities as Record<string, SurfaceCapabilityForAssertion>)[capability];
}

export function createCompleteProposalService(overrides: Record<string, unknown> = {}) {
  return {
    createProposal: jest.fn(),
    startProposalWorkspace: jest.fn(),
    getProposalWorkspace: jest.fn(),
    disposeProposalWorkspace: jest.fn(),
    commitProposalWorkspace: jest.fn(),
    failProposal: jest.fn(),
    getProposal: jest.fn(),
    listProposals: jest.fn(),
    markProposalVerified: jest.fn(),
    openProposalReview: jest.fn(),
    acceptProposal: jest.fn(),
    rejectProposal: jest.fn(),
    supersedeProposal: jest.fn(),
    proposalWorkspaceLifecycleAvailable: true,
    ...overrides,
  };
}

export function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {
      getAllSheetIds: jest.fn(async () => []),
      getAllTablesInSheet: jest.fn(async () => []),
      getFiltersInSheet: jest.fn(async () => []),
      namedRangeCount: jest.fn(async () => 0),
      getAllNamedRangesWire: jest.fn(async () => []),
      getHyperlinks: jest.fn(async () => []),
      getRangeSchemasForSheet: jest.fn(async () => []),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    workbookLinkScope: () => ({
      requestingDocumentId: 'document-1',
      requestingSessionId: 'session-1',
      actor: 'user-1',
      principal: { tags: ['host:trusted'] },
    }),
    ...overrides,
  } as any;
}

export function createSurfaceReadyVersion() {
  return createSurfaceReadyVersionWithContext();
}

export function createSurfaceReadyVersionWithContext(
  ctxOverrides: Record<string, unknown> = {},
  versioningOverrides: Record<string, unknown> = {},
) {
  const readHead = jest.fn(async () => ({
    status: 'success',
    head: {
      id: CHILD_COMMIT_ID,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: REF_REVISION,
    },
    diagnostics: [],
  }));
  const readRef = jest.fn(async () => ({
    status: 'success',
    ref: {
      name: 'refs/heads/main',
      commitId: CHILD_COMMIT_ID,
      revision: REF_REVISION,
    },
    diagnostics: [],
  }));
  const listCommits = jest.fn(async () => ({
    status: 'success',
    commits: [],
    readRevision: REF_REVISION,
    diagnostics: [],
  }));
  const diff = jest.fn();
  const commit = jest.fn();
  const mergeCommit = jest.fn();
  const createBranch = jest.fn();
  const readBranch = jest.fn();
  const listBranches = jest.fn();
  const fastForwardBranch = jest.fn();
  const planCheckout = jest.fn();
  const merge = jest.fn();
  const version = new WorkbookVersionImpl(
    createMockCtx({
      ...ctxOverrides,
      versioning: {
        ...withVersionManifest({
          provider: {
            kind: 'memory',
            documentScope: { documentId: 'document-1' },
            capabilities: {
              reads: {
                graphRegistry: true,
                objects: true,
                refs: true,
                commits: true,
              },
            },
          },
          readService: {
            readHead,
            readRef,
            listCommits,
          },
          diffService: { diff },
          writeService: {
            commit,
            mergeCommit,
          },
          branchService: {
            createBranch,
            readBranch,
            listBranches,
            fastForwardBranch,
          },
          checkoutService: { planCheckout },
          mergeService: { merge },
          ...versioningOverrides,
        }),
      },
    }),
  );

  return {
    version,
    readHead,
    readRef,
    listCommits,
    diff,
    commit,
    mergeCommit,
    createBranch,
    readBranch,
    listBranches,
    fastForwardBranch,
    planCheckout,
    merge,
  };
}

export function createSplitCapabilityReadyVersion(ctxOverrides: Record<string, unknown> = {}) {
  return createSurfaceReadyVersionWithContext(ctxOverrides, {
    reviewService: {
      listReviews: jest.fn(),
      getReview: jest.fn(),
      getReviewDiff: jest.fn(),
      createReview: jest.fn(),
      appendReviewDecision: jest.fn(),
      updateReviewStatus: jest.fn(),
    },
    proposalService: createCompleteProposalService(),
    captureMergeCommit: jest.fn(),
    mergeCommitMaterializer: { kind: 'test-materializer' },
    provenanceTruthService: {
      vc09ProvenanceTruthComplete: true,
    },
  });
}
