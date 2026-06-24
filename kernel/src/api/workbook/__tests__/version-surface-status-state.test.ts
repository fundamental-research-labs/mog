import { jest } from '@jest/globals';

import {
  CHILD_COMMIT_ID,
  MOVED_COMMIT_ID,
  REF_REVISION,
  capabilityState,
  createCleanSurfaceDirtyStatus,
  createSensitiveSurfaceDirtyStatus,
  createSurfaceDirtyStatus,
  createSurfaceReadyVersionWithContext,
} from './version-surface-status-test-utils';
import { createWorkbookVersionSurfaceStatusService } from '../version/surface-status/version-surface-status-service';
import type { VersionSurfaceActiveCheckoutStateChanged } from '../version/surface-status/version-surface-status-service';

describe('WorkbookVersion surface status state projection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses attached real dirty status without invoking checkout planning', async () => {
    const dirtyStatus = createSurfaceDirtyStatus();
    const readDirtyStatus = jest.fn(() => dirtyStatus);
    const surfaceReady = createSurfaceReadyVersionWithContext(
      {},
      {
        surfaceStatusService: {
          readDirtyStatus,
        },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.dirty).toEqual(dirtyStatus);
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'version.surfaceStatus.dirtyTokenUnavailable',
    );
    expect(readDirtyStatus).toHaveBeenCalledTimes(1);
    expect(surfaceReady.planCheckout).not.toHaveBeenCalled();
  });

  it('reports stale active checkout-session status from current ref head', async () => {
    const readDirtyStatus = jest.fn(() => createCleanSurfaceDirtyStatus());
    const readActiveCheckoutSession = jest.fn(() => ({
      checkedOutCommitId: CHILD_COMMIT_ID,
      branchName: 'main',
      refHeadAtMaterialization: CHILD_COMMIT_ID,
      detached: false,
    }));
    const readHeadShouldNotRun = jest.fn();
    const sessionReadRef = jest.fn(async () => ({
      status: 'success',
      ref: {
        name: 'refs/heads/main',
        commitId: MOVED_COMMIT_ID,
        revision: REF_REVISION,
      },
      diagnostics: [],
    }));
    const surfaceReady = createSurfaceReadyVersionWithContext(
      {},
      {
        surfaceStatusService: {
          readDirtyStatus,
          readActiveCheckoutSession,
        },
        readService: {
          readHead: readHeadShouldNotRun,
          readRef: sessionReadRef,
          listCommits: jest.fn(),
        },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.current).toMatchObject({
      headCommitId: CHILD_COMMIT_ID,
      checkedOutCommitId: CHILD_COMMIT_ID,
      branchName: 'main',
      refHeadAtMaterialization: CHILD_COMMIT_ID,
      currentRefHeadId: MOVED_COMMIT_ID,
      detached: false,
      stale: true,
      staleReason: 'refMoved',
    });
    expect(readActiveCheckoutSession).toHaveBeenCalledTimes(1);
    expect(readHeadShouldNotRun).not.toHaveBeenCalled();
    expect(sessionReadRef).toHaveBeenCalledWith('refs/heads/main');
    expect(surfaceReady.planCheckout).not.toHaveBeenCalled();
  });

  it('notifies active checkout state changes with monotonic revisions', () => {
    const changes: VersionSurfaceActiveCheckoutStateChanged[] = [];
    const service = createWorkbookVersionSurfaceStatusService({
      readDirtyState: () => ({
        hasUncommittedLocalChanges: false,
        calculationState: 'done',
        checkoutInProgress: false,
        revision: 0,
        contextGeneration: 0,
      }),
      notifyActiveCheckoutStateChanged: (change) => changes.push(change),
    });

    service.recordActiveCheckoutBranchCommit({
      commitId: CHILD_COMMIT_ID,
      refName: 'refs/heads/scenario/active-checkout-state',
    });
    service.recordActiveCheckoutBranchCommit({
      commitId: CHILD_COMMIT_ID,
      refName: 'refs/heads/scenario/active-checkout-state',
    });
    service.recordActiveCheckoutBranchRefMove({
      checkedOutCommitId: CHILD_COMMIT_ID,
      refHeadCommitId: MOVED_COMMIT_ID,
      refName: 'refs/heads/scenario/active-checkout-state',
    });
    service.recordActiveCheckoutBranchCommit({
      commitId: MOVED_COMMIT_ID,
      refName: 'refs/heads/scenario/active-checkout-state',
    });
    service.recordCheckoutMaterialization({
      commitId: CHILD_COMMIT_ID,
      resolvedTarget: { kind: 'commit', commitId: CHILD_COMMIT_ID },
    } as never);

    expect(changes).toEqual([
      {
        activeCheckoutSession: {
          checkedOutCommitId: CHILD_COMMIT_ID,
          branchName: 'scenario/active-checkout-state',
          refHeadAtMaterialization: CHILD_COMMIT_ID,
          detached: false,
        },
        previousActiveCheckoutSession: null,
        statusRevision: 1,
        reason: 'branch-head-advanced',
      },
      {
        activeCheckoutSession: {
          checkedOutCommitId: CHILD_COMMIT_ID,
          branchName: 'scenario/active-checkout-state',
          refHeadAtMaterialization: MOVED_COMMIT_ID,
          detached: false,
        },
        previousActiveCheckoutSession: {
          checkedOutCommitId: CHILD_COMMIT_ID,
          branchName: 'scenario/active-checkout-state',
          refHeadAtMaterialization: CHILD_COMMIT_ID,
          detached: false,
        },
        statusRevision: 2,
        reason: 'branch-ref-moved',
      },
      {
        activeCheckoutSession: {
          checkedOutCommitId: MOVED_COMMIT_ID,
          branchName: 'scenario/active-checkout-state',
          refHeadAtMaterialization: MOVED_COMMIT_ID,
          detached: false,
        },
        previousActiveCheckoutSession: {
          checkedOutCommitId: CHILD_COMMIT_ID,
          branchName: 'scenario/active-checkout-state',
          refHeadAtMaterialization: MOVED_COMMIT_ID,
          detached: false,
        },
        statusRevision: 3,
        reason: 'branch-head-advanced',
      },
      {
        activeCheckoutSession: {
          checkedOutCommitId: CHILD_COMMIT_ID,
          detached: true,
        },
        previousActiveCheckoutSession: {
          checkedOutCommitId: MOVED_COMMIT_ID,
          branchName: 'scenario/active-checkout-state',
          refHeadAtMaterialization: MOVED_COMMIT_ID,
          detached: false,
        },
        statusRevision: 4,
        reason: 'checkout-materialized',
      },
    ]);
    expect(service.readActiveCheckoutSession()).toEqual({
      checkedOutCommitId: CHILD_COMMIT_ID,
      detached: true,
    });
  });

  it('falls back to conservative dirty status when the adapter payload is invalid', async () => {
    const readDirtyStatus = jest.fn(() => ({
      checkoutSafe: true,
    }));
    const { version } = createSurfaceReadyVersionWithContext(
      {},
      {
        surfaceStatusService: {
          readDirtyStatus,
        },
      },
    );

    const surface = await version.getSurfaceStatus();

    expect(surface.dirty).toMatchObject({
      source: 'VC-05',
      checkoutSafe: false,
      checkoutPreflightToken: 'VC-05-checkout-preflight-unavailable',
    });
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'version.surfaceStatus.dirtyStatusInvalid',
        'version.surfaceStatus.dirtyTokenUnavailable',
      ]),
    );
  });

  it('redacts capability-free status fields when read and checkout grants are denied', async () => {
    const readDirtyStatus = jest.fn(() => createSensitiveSurfaceDirtyStatus());
    const surfaceReady = createSurfaceReadyVersionWithContext(
      {
        policySnapshot: {
          decisions: [
            { capability: 'version:read', decision: 'denied' },
            { capability: 'version:checkout', decision: 'denied' },
          ],
        },
      },
      {
        surfaceStatusService: {
          readDirtyStatus,
        },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.current).toEqual({ detached: false, stale: true, staleReason: 'unknown' });
    expect(surface.dirty).toMatchObject({
      statusRevision: 'redacted',
      checkoutPreflightToken: 'redacted',
      hasUncommittedLocalChanges: true,
      liveCollaboration: {
        state: 'idle',
        statusRevision: 'redacted',
        roomId: 'redacted',
      },
    });
    for (const capability of ['version:read', 'version:checkout'] as const) {
      expect(capabilityState(surface, capability)).toMatchObject({
        enabled: false,
        dependency: 'hostCapability',
      });
    }
    expect(readDirtyStatus).toHaveBeenCalledTimes(1);
    expect(surfaceReady.readHead).not.toHaveBeenCalled();
    expect(surfaceReady.readRef).not.toHaveBeenCalled();
    expect(JSON.stringify(surface)).not.toMatch(
      /commit:sha256:222|dirty-secret-message|dirty-secret-token|dirty-secret-cursor|dirty:secret-revision|checkout-preflight-secret-token|live:secret-room|room-secret-id/,
    );
  });
});
