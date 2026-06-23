import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import { withVersionManifest } from './version-domain-support-test-utils';
import { CHILD_COMMIT_ID, REF_REVISION } from './version-surface-status-helpers-constants';
import { createMockCtx } from './version-surface-status-helpers-context';
import { createCompleteProposalService } from './version-surface-status-helpers-proposals';

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
