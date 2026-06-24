import type { VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import {
  getBranchAvailability,
  getCapabilityAvailability,
  getCheckoutAvailability,
  getCommitAvailability,
  getDiffAvailability,
  getRemotePromoteAvailability,
  getRollbackAvailability,
} from '../version-action-availability';

import {
  HEAD_COMMIT_ID,
  LATEST_COMMIT_ID,
  TARGET_COMMIT_ID,
  type VersionActionCapability,
  createSurfaceStatus,
  diagnostic,
  disabledCapability,
  expectDisabled,
} from './version-action-availability.test-utils';

describe('version action availability dirty state contract', () => {
  it('disables commit, checkout, and rollback while provider writes are pending', () => {
    const surface = createSurfaceStatus({
      dirty: {
        pendingProviderWrites: true,
        checkoutSafe: false,
      },
    });

    expectDisabled(
      getCommitAvailability({ surface }, false, false, 'Checkpoint'),
      'Wait for provider writes to settle before committing.',
    );
    expectDisabled(
      getCheckoutAvailability({ surface }, false, false),
      'Wait for provider writes to settle before checking out.',
    );
    expectDisabled(
      getRollbackAvailability(
        { surface },
        false,
        false,
        'Rollback selected commit',
        TARGET_COMMIT_ID,
      ),
      'Wait for provider writes to settle before staging rollback.',
    );
    expect(
      getBranchAvailability({ surface }, false, false, 'scenario/review', TARGET_COMMIT_ID),
    ).toEqual({ enabled: true });
    expect(getDiffAvailability({ surface }, false, false)).toEqual({ enabled: true });
    expect(getRemotePromoteAvailability({ surface }, false, false)).toEqual({ enabled: true });
  });

  it('uses pending-provider-write diagnostics for blocked checkout when available', () => {
    const pendingProviderWrites = diagnostic(
      'Remote sync changes are waiting to be promoted into version history; checkout is unsafe.',
      'version.surfaceStatus.pendingProviderWrites',
    );
    const surface = createSurfaceStatus({
      dirty: {
        pendingProviderWrites: true,
        checkoutSafe: false,
        unsafeReasons: [pendingProviderWrites],
        diagnostics: [pendingProviderWrites],
      },
    });

    expectDisabled(
      getCheckoutAvailability({ surface }, false, false),
      pendingProviderWrites.message,
    );
    expect(getRemotePromoteAvailability({ surface }, false, false)).toEqual({ enabled: true });
  });

  it('disables commit and checkout for unsupported dirty domains', () => {
    const surface = createSurfaceStatus({
      dirty: {
        hasUncommittedLocalChanges: true,
        commitEligibleChanges: false,
        unsupportedDirtyDomains: ['charts', 'pivotTables'],
        checkoutSafe: false,
      },
    });

    expectDisabled(
      getCommitAvailability({ surface }, false, false, 'Checkpoint'),
      'Changes in charts, pivotTables cannot be committed yet.',
    );
    expectDisabled(
      getCheckoutAvailability({ surface }, false, false),
      'Commit or discard changes in charts, pivotTables before checking out.',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:reviewWrite'),
      'Changes in charts, pivotTables cannot be reviewed yet.',
      'version-unsupported-domain',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:mergeApply'),
      'Changes in charts, pivotTables cannot be merged yet.',
      'version-unsupported-domain',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:provenance'),
      'Changes in charts, pivotTables cannot be exported with version metadata yet.',
      'version-unsupported-domain',
    );
  });

  it('uses diagnostics for unknown dirty domains', () => {
    const dirtyDiagnostic = diagnostic(
      'A provider reported unclassified local changes.',
      'version.surfaceStatus.dirtyWorkingState',
    );
    const surface = createSurfaceStatus({
      dirty: {
        hasUncommittedLocalChanges: true,
        commitEligibleChanges: false,
        unsupportedDirtyDomains: ['unknown'],
        checkoutSafe: false,
        unsafeReasons: [dirtyDiagnostic],
        diagnostics: [dirtyDiagnostic],
      },
    });

    expectDisabled(
      getCommitAvailability({ surface }, false, false, 'Checkpoint'),
      dirtyDiagnostic.message,
    );
    expectDisabled(getCheckoutAvailability({ surface }, false, false), dirtyDiagnostic.message);
  });

  it('uses unsafe checkout diagnostics before fallback checkout reasons', () => {
    const unsafeReason = diagnostic(
      'Workbook has uncommitted local changes; checkout would discard them.',
      'version.surfaceStatus.dirtyWorkingState',
    );
    const surface = createSurfaceStatus({
      dirty: {
        hasUncommittedLocalChanges: true,
        checkoutSafe: false,
        unsafeReasons: [unsafeReason],
      },
    });

    expectDisabled(getCheckoutAvailability({ surface }, false, false), unsafeReason.message);
  });

  it('does not let local prerequisites hide disabled surface capabilities', () => {
    const actionCapabilityReasons: Record<VersionActionCapability, string> = {
      'version:commit': 'Commit is disabled by the surface contract.',
      'version:branch': 'Branch is disabled by the surface contract.',
      'version:checkout': 'Checkout is disabled by the surface contract.',
      'version:diff': 'Diff is disabled by the surface contract.',
      'version:revert': 'Rollback is disabled by the surface contract.',
      'version:remotePromote': 'Remote promote is disabled by the surface contract.',
    };
    const dirty = {
      hasUncommittedLocalChanges: true,
      commitEligibleChanges: false,
      unsupportedDirtyDomains: ['charts'],
      checkoutSafe: false,
      unsafeReasons: [diagnostic('Checkout would discard local changes.')],
    } satisfies Partial<VersionSurfaceStatus['dirty']>;

    expectDisabled(
      getCommitAvailability(
        {
          surface: createSurfaceStatus({
            dirty,
            capabilityOverrides: {
              'version:commit': disabledCapability(actionCapabilityReasons['version:commit']),
            },
          }),
        },
        false,
        false,
        '',
      ),
      actionCapabilityReasons['version:commit'],
    );
    expectDisabled(
      getBranchAvailability(
        {
          surface: createSurfaceStatus({
            capabilityOverrides: {
              'version:branch': disabledCapability(actionCapabilityReasons['version:branch']),
            },
          }),
        },
        false,
        false,
        '',
        undefined,
      ),
      actionCapabilityReasons['version:branch'],
    );
    expectDisabled(
      getCheckoutAvailability(
        {
          surface: createSurfaceStatus({
            dirty,
            capabilityOverrides: {
              'version:checkout': disabledCapability(actionCapabilityReasons['version:checkout']),
            },
          }),
        },
        false,
        false,
      ),
      actionCapabilityReasons['version:checkout'],
    );
    expectDisabled(
      getDiffAvailability(
        {
          surface: createSurfaceStatus({
            capabilityOverrides: {
              'version:diff': disabledCapability(actionCapabilityReasons['version:diff']),
            },
          }),
        },
        false,
        false,
      ),
      actionCapabilityReasons['version:diff'],
    );
    expectDisabled(
      getRollbackAvailability(
        {
          surface: createSurfaceStatus({
            capabilityOverrides: {
              'version:revert': disabledCapability(actionCapabilityReasons['version:revert']),
            },
          }),
        },
        false,
        false,
        '',
        undefined,
      ),
      actionCapabilityReasons['version:revert'],
    );
    expectDisabled(
      getRemotePromoteAvailability(
        {
          surface: createSurfaceStatus({
            capabilityOverrides: {
              'version:remotePromote': disabledCapability(
                actionCapabilityReasons['version:remotePromote'],
              ),
            },
          }),
        },
        false,
        false,
      ),
      actionCapabilityReasons['version:remotePromote'],
    );
  });

  it('disables stale-head-sensitive actions when the current checkout session is stale', () => {
    const surface = createSurfaceStatus({
      current: {
        checkedOutCommitId: HEAD_COMMIT_ID,
        refHeadAtMaterialization: HEAD_COMMIT_ID,
        currentRefHeadId: LATEST_COMMIT_ID,
        stale: true,
        staleReason: 'refMoved',
      },
      dirty: {
        hasUncommittedLocalChanges: false,
        commitEligibleChanges: true,
        checkoutSafe: true,
      },
    });

    expectDisabled(
      getCommitAvailability({ surface }, false, false, 'Checkpoint'),
      'main is stale because the branch head moved. Refresh before committing.',
    );
    expectDisabled(
      getCheckoutAvailability({ surface }, false, false),
      'main is stale because the branch head moved. Checkout is blocked until the active checkout session is refreshed.',
    );
    expectDisabled(
      getRollbackAvailability(
        { surface },
        false,
        false,
        'Rollback selected commit',
        TARGET_COMMIT_ID,
      ),
      'main is stale because the branch head moved. Refresh before staging rollback.',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:reviewRead'),
      'main is stale because the branch head moved. Refresh before reviewing version changes.',
      'version-head-stale',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:mergePreview'),
      'main is stale because the branch head moved. Refresh before merging.',
      'version-head-stale',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:provenance'),
      'main is stale because the branch head moved. Refresh before exporting version metadata.',
      'version-head-stale',
    );
    expect(
      getBranchAvailability({ surface }, false, false, 'scenario/review', TARGET_COMMIT_ID),
    ).toEqual({ enabled: true });
    expect(getDiffAvailability({ surface }, false, false)).toEqual({ enabled: true });
    expectDisabled(
      getRemotePromoteAvailability({ surface }, false, false),
      'main is stale because the branch head moved. Refresh before promoting remote changes.',
      'version-head-stale',
    );
  });

  it('fails closed from restored active checkout metadata when stale was not precomputed', () => {
    const cases = [
      {
        current: {
          checkedOutCommitId: HEAD_COMMIT_ID,
          refHeadAtMaterialization: HEAD_COMMIT_ID,
          currentRefHeadId: LATEST_COMMIT_ID,
          stale: false,
        },
        prefix: 'main is stale because the branch head moved.',
      },
      {
        current: {
          checkedOutCommitId: HEAD_COMMIT_ID,
          refHeadAtMaterialization: LATEST_COMMIT_ID,
          currentRefHeadId: LATEST_COMMIT_ID,
          stale: false,
        },
        prefix: 'main is stale because the active checkout session is behind the branch head.',
      },
    ] as const satisfies readonly {
      readonly current: Partial<VersionSurfaceStatus['current']>;
      readonly prefix: string;
    }[];

    for (const item of cases) {
      const surface = createSurfaceStatus({
        current: item.current,
        dirty: {
          hasUncommittedLocalChanges: false,
          commitEligibleChanges: true,
          checkoutSafe: true,
        },
      });

      expectDisabled(
        getCommitAvailability({ surface }, false, false, 'Checkpoint'),
        `${item.prefix} Refresh before committing.`,
        'version-head-stale',
      );
      expectDisabled(
        getCheckoutAvailability({ surface }, false, false),
        `${item.prefix} Checkout is blocked until the active checkout session is refreshed.`,
        'version-head-stale',
      );
      expectDisabled(
        getCapabilityAvailability({ surface }, false, false, 'version:mergePreview'),
        `${item.prefix} Refresh before merging.`,
        'version-head-stale',
      );
      expectDisabled(
        getCapabilityAvailability({ surface }, false, false, 'version:mergeApply'),
        `${item.prefix} Refresh before merging.`,
        'version-head-stale',
      );
    }
  });
});
