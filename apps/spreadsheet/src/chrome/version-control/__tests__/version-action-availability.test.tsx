import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionCapabilityState,
  VersionDiagnostic,
  VersionRef,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  getBranchAvailability,
  getCapabilityAvailability,
  getCheckoutAvailability,
  getCommitAvailability,
  getDiffAvailability,
  getRemotePromoteAvailability,
  getRollbackAvailability,
  type VersionActionDisabledReasonId,
  type VersionActionAvailability,
} from '../version-action-availability';

const HEAD_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const TARGET_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
const LATEST_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
const STORAGE_UNAVAILABLE_REASON = 'Version storage is not ready for this workbook.';
const READ_UNAVAILABLE_REASON = 'Version graph read services are not attached.';
const VERSIONING_DISABLED_REASON = 'Versioning is disabled for this workbook.';

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

type VersionActionCapability = Extract<
  VersionCapability,
  | 'version:commit'
  | 'version:branch'
  | 'version:checkout'
  | 'version:diff'
  | 'version:revert'
  | 'version:remotePromote'
>;

type SplitVersionActionCapability = Extract<
  VersionCapability,
  | 'version:reviewRead'
  | 'version:reviewWrite'
  | 'version:proposal'
  | 'version:mergePreview'
  | 'version:mergeApply'
  | 'version:provenance'
>;

type ActionAvailabilityOptions = {
  readonly actionBusy?: boolean;
  readonly loading?: boolean;
  readonly commitMessage?: string;
  readonly branchName?: string;
  readonly rollbackReason?: string;
  readonly refs?: readonly Pick<VersionRef, 'name'>[];
  readonly targetCommitId?: WorkbookCommitId;
};

type ActionCase = {
  readonly capability: VersionActionCapability;
  readonly availability: (
    surface: VersionSurfaceStatus,
    options?: ActionAvailabilityOptions,
  ) => VersionActionAvailability;
};

const ACTION_CASES: readonly ActionCase[] = [
  {
    capability: 'version:commit',
    availability: (surface, options = {}) =>
      getCommitAvailability(
        { surface },
        options.actionBusy ?? false,
        options.loading ?? false,
        options.commitMessage ?? 'Checkpoint',
      ),
  },
  {
    capability: 'version:branch',
    availability: (surface, options = {}) => {
      const data = options.refs ? { surface, refs: options.refs } : { surface };
      return getBranchAvailability(
        data,
        options.actionBusy ?? false,
        options.loading ?? false,
        options.branchName ?? 'scenario/review',
        options.targetCommitId ?? TARGET_COMMIT_ID,
      );
    },
  },
  {
    capability: 'version:checkout',
    availability: (surface, options = {}) =>
      getCheckoutAvailability({ surface }, options.actionBusy ?? false, options.loading ?? false),
  },
  {
    capability: 'version:diff',
    availability: (surface, options = {}) =>
      getDiffAvailability({ surface }, options.actionBusy ?? false, options.loading ?? false),
  },
  {
    capability: 'version:revert',
    availability: (surface, options = {}) =>
      getRollbackAvailability(
        { surface },
        options.actionBusy ?? false,
        options.loading ?? false,
        options.rollbackReason ?? 'Rollback selected commit',
        options.targetCommitId ?? TARGET_COMMIT_ID,
      ),
  },
  {
    capability: 'version:remotePromote',
    availability: (surface, options = {}) =>
      getRemotePromoteAvailability(
        { surface },
        options.actionBusy ?? false,
        options.loading ?? false,
      ),
  },
];

const SPLIT_CAPABILITY_CASES: readonly {
  readonly capability: SplitVersionActionCapability;
  readonly fallbackReason: string;
}[] = [
  { capability: 'version:reviewRead', fallbackReason: 'Review read is unavailable.' },
  { capability: 'version:reviewWrite', fallbackReason: 'Review write is unavailable.' },
  { capability: 'version:proposal', fallbackReason: 'Proposal is unavailable.' },
  { capability: 'version:mergePreview', fallbackReason: 'Merge preview is unavailable.' },
  { capability: 'version:mergeApply', fallbackReason: 'Merge apply is unavailable.' },
  { capability: 'version:provenance', fallbackReason: 'Provenance is unavailable.' },
];

describe('version action availability', () => {
  it('disables actions while status data is missing, loading, or another action is running', () => {
    expectDisabled(
      getCommitAvailability(undefined, false, false, 'Checkpoint'),
      'Version status is unavailable.',
    );
    expectDisabled(
      getBranchAvailability(undefined, false, false, 'scenario/review', TARGET_COMMIT_ID),
      'Version status is unavailable.',
    );
    expectDisabled(
      getCheckoutAvailability(undefined, false, false),
      'Version status is unavailable.',
    );
    expectDisabled(getDiffAvailability(undefined, false, false), 'Version status is unavailable.');
    expectDisabled(
      getRollbackAvailability(
        undefined,
        false,
        false,
        'Rollback selected commit',
        TARGET_COMMIT_ID,
      ),
      'Version status is unavailable.',
    );
    expectDisabled(
      getRemotePromoteAvailability(undefined, false, false),
      'Version status is unavailable.',
    );

    for (const action of ACTION_CASES) {
      const surface = createSurfaceStatus();
      expectDisabled(
        action.availability(surface, { actionBusy: true }),
        'Wait for the current version action to finish.',
      );
      expectDisabled(
        action.availability(surface, { loading: true }),
        'Version status is refreshing.',
      );
    }

    for (const action of SPLIT_CAPABILITY_CASES) {
      const surface = createSurfaceStatus();
      expectDisabled(
        getCapabilityAvailability({ surface }, true, false, action.capability),
        'Wait for the current version action to finish.',
      );
      expectDisabled(
        getCapabilityAvailability({ surface }, false, true, action.capability),
        'Version status is refreshing.',
      );
    }
  });

  it('fails closed when the surface status itself is unavailable', () => {
    expectDisabled(
      getCommitAvailability({}, false, false, 'Checkpoint'),
      'Version surface status is unavailable.',
    );
    expectDisabled(
      getBranchAvailability({}, false, false, 'scenario/review', TARGET_COMMIT_ID),
      'Version surface status is unavailable.',
    );
    expectDisabled(
      getCheckoutAvailability({}, false, false),
      'Version surface status is unavailable.',
    );
    expectDisabled(getDiffAvailability({}, false, false), 'Version surface status is unavailable.');
    expectDisabled(
      getRollbackAvailability({}, false, false, 'Rollback selected commit', TARGET_COMMIT_ID),
      'Version surface status is unavailable.',
    );
    expectDisabled(
      getRemotePromoteAvailability({}, false, false),
      'Version surface status is unavailable.',
    );
  });

  it('uses the feature-gate disabled reason for every action', () => {
    const surface = createSurfaceStatus({ featureGateEnabled: false });

    for (const action of ACTION_CASES) {
      expectDisabled(action.availability(surface), VERSIONING_DISABLED_REASON);
    }
  });

  it('uses host capability denial reasons from the action capability state', () => {
    for (const action of ACTION_CASES) {
      const reason = `Host policy denies ${action.capability}.`;
      const surface = createSurfaceStatus({
        capabilityOverrides: {
          [action.capability]: disabledCapability(reason, 'hostCapability', false),
        },
      });

      expectDisabled(action.availability(surface), reason);
    }
  });

  it('keeps review, proposal, and merge-apply capability denials split independently', () => {
    for (const blockedAction of SPLIT_CAPABILITY_CASES) {
      const reason = `Host policy denies ${blockedAction.capability}.`;
      const surface = createSurfaceStatus({
        capabilityOverrides: {
          [blockedAction.capability]: disabledCapability(reason, 'hostCapability', false),
        },
      });

      for (const action of SPLIT_CAPABILITY_CASES) {
        const availability = getCapabilityAvailability(
          { surface },
          false,
          false,
          action.capability,
        );
        if (action.capability === blockedAction.capability) {
          expectDisabled(availability, reason);
        } else {
          expect(availability).toEqual({ enabled: true });
        }
      }
    }
  });

  it('does not let review, proposal, or merge-apply denials disable legacy actions', () => {
    const surface = createSurfaceStatus({
      capabilityOverrides: Object.fromEntries(
        SPLIT_CAPABILITY_CASES.map((action) => [
          action.capability,
          disabledCapability(`Host policy denies ${action.capability}.`, 'hostCapability', false),
        ]),
      ) as Partial<Record<VersionCapability, VersionCapabilityState>>,
    });

    for (const action of ACTION_CASES) {
      expect(action.availability(surface)).toEqual({ enabled: true });
    }
  });

  it('uses public fallback reasons when split capability denial reasons are redacted', () => {
    for (const action of SPLIT_CAPABILITY_CASES) {
      const surface = createSurfaceStatus({
        capabilityOverrides: {
          [action.capability]: redactedDisabledCapability('hostCapability', false),
        },
      });
      const availability = getCapabilityAvailability({ surface }, false, false, action.capability);

      expectDisabled(availability, action.fallbackReason);
      expect(availability.disabledReason).not.toContain('version:');
    }
  });

  it('treats read availability as a shared action prerequisite', () => {
    const surface = createSurfaceStatus({
      capabilityOverrides: {
        'version:read': disabledCapability(READ_UNAVAILABLE_REASON, 'VC-04', true),
      },
    });

    for (const action of ACTION_CASES) {
      expectDisabled(action.availability(surface), READ_UNAVAILABLE_REASON);
    }
  });

  it('uses storage unavailable reasons from surface capabilities', () => {
    const surface = createSurfaceStatus({ storageReady: false });

    for (const action of ACTION_CASES) {
      expectDisabled(action.availability(surface), STORAGE_UNAVAILABLE_REASON);
    }
  });

  it('blocks sensitive actions when public diagnostics report incomplete history', () => {
    const historyDiagnostic = diagnostic(
      'The workbook version graph is not initialized for this document.',
      'VERSION_GRAPH_UNINITIALIZED',
    );
    const surface = createSurfaceStatus({ diagnostics: [historyDiagnostic] });

    expectDisabled(
      getCommitAvailability({ surface }, false, false, 'Checkpoint'),
      historyDiagnostic.message,
      'version-history-incomplete',
    );
    expectDisabled(
      getCheckoutAvailability({ surface }, false, false),
      historyDiagnostic.message,
      'version-history-incomplete',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:reviewRead'),
      historyDiagnostic.message,
      'version-history-incomplete',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:mergePreview'),
      historyDiagnostic.message,
      'version-history-incomplete',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:provenance'),
      historyDiagnostic.message,
      'version-history-incomplete',
    );
    expect(
      getBranchAvailability({ surface }, false, false, 'scenario/review', TARGET_COMMIT_ID),
    ).toEqual({ enabled: true });
    expect(getDiffAvailability({ surface }, false, false)).toEqual({ enabled: true });
    expectDisabled(
      getRemotePromoteAvailability({ surface }, false, false),
      historyDiagnostic.message,
      'version-history-incomplete',
    );
  });

  it('blocks host-denied capability diagnostics even when capability state is enabled', () => {
    const deniedMergeApply = diagnostic(
      'Host policy denies merge apply.',
      'version.surfaceStatus.hostCapabilityDenied',
      'hostCapability',
      { capability: 'version:mergeApply' },
    );
    const deniedRead = diagnostic(
      'Host policy denies version reads.',
      'version.surfaceStatus.hostCapabilityDenied',
      'hostCapability',
      { deniedCapabilities: ['version:read'] },
    );
    const mergeSurface = createSurfaceStatus({ diagnostics: [deniedMergeApply] });
    const readSurface = createSurfaceStatus({ diagnostics: [deniedRead] });

    expectDisabled(
      getCapabilityAvailability({ surface: mergeSurface }, false, false, 'version:mergeApply'),
      deniedMergeApply.message,
      'version-capability-host-denied',
    );
    expect(
      getCapabilityAvailability({ surface: mergeSurface }, false, false, 'version:reviewRead'),
    ).toEqual({ enabled: true });
    expectDisabled(
      getCommitAvailability({ surface: readSurface }, false, false, 'Checkpoint'),
      deniedRead.message,
      'version-capability-host-denied',
    );
  });

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

  it('requires messages, names, and targets after surface capabilities pass', () => {
    const surface = createSurfaceStatus();

    expectDisabled(
      getCommitAvailability({ surface }, false, false, '   '),
      'Enter a commit message.',
    );
    expectDisabled(
      getBranchAvailability({ surface }, false, false, 'scenario/review', undefined),
      'Select a commit target first.',
    );
    expectDisabled(
      getBranchAvailability({ surface }, false, false, '   ', TARGET_COMMIT_ID),
      'Enter a branch name.',
    );
    expectDisabled(
      getRollbackAvailability({ surface }, false, false, 'Rollback selected commit', undefined),
      'Select a commit target first.',
    );
    expectDisabled(
      getRollbackAvailability({ surface }, false, false, '   ', TARGET_COMMIT_ID),
      'Enter a rollback reason.',
    );
  });

  it('validates branch creation names against public refs, protected main, and loaded refs', () => {
    const surface = createSurfaceStatus();
    const refs = [
      ref('refs/heads/main'),
      ref('refs/heads/scenario/budget'),
      ref('refs/heads/review/model-a'),
    ];

    expectDisabled(
      getBranchAvailability({ surface, refs }, false, false, 'main', TARGET_COMMIT_ID),
      'main is protected and cannot be created from the version panel.',
    );
    expectDisabled(
      getBranchAvailability({ surface, refs }, false, false, 'refs/heads/main', TARGET_COMMIT_ID),
      'main is protected and cannot be created from the version panel.',
    );
    expectDisabled(
      getBranchAvailability({ surface, refs }, false, false, 'HEAD', TARGET_COMMIT_ID),
      'HEAD is symbolic and cannot be created as a branch.',
    );
    expectDisabled(
      getBranchAvailability({ surface, refs }, false, false, 'refs/tags/review', TARGET_COMMIT_ID),
      'Branch refs must use refs/heads/<branch>.',
    );
    expectDisabled(
      getBranchAvailability(
        { surface, refs },
        false,
        false,
        'refs/heads/scenario/budget',
        TARGET_COMMIT_ID,
      ),
      'Branch scenario/budget already exists.',
    );
    expectDisabled(
      getBranchAvailability({ surface, refs }, false, false, 'review', TARGET_COMMIT_ID),
      'Branch names must start with scenario/, agent/, import/, or review/.',
    );

    expect(
      getBranchAvailability(
        { surface, refs },
        false,
        false,
        'refs/heads/scenario/forecast-q1',
        TARGET_COMMIT_ID,
      ),
    ).toEqual({ enabled: true });
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

  it('enables actions when surface capabilities and local prerequisites pass', () => {
    const surface = createSurfaceStatus();

    for (const action of ACTION_CASES) {
      expect(action.availability(surface)).toEqual({ enabled: true });
    }
  });
});

function createSurfaceStatus({
  featureGateEnabled = true,
  storageReady = true,
  current = {},
  dirty = {},
  capabilityOverrides = {},
  diagnostics = [],
}: {
  readonly featureGateEnabled?: boolean;
  readonly storageReady?: boolean;
  readonly current?: Partial<VersionSurfaceStatus['current']>;
  readonly dirty?: Partial<VersionSurfaceStatus['dirty']>;
  readonly capabilityOverrides?: Partial<Record<VersionCapability, VersionCapabilityState>>;
  readonly diagnostics?: readonly VersionDiagnostic[];
} = {}): VersionSurfaceStatus {
  return {
    schemaVersion: 1,
    documentId: 'document-1',
    stage: featureGateEnabled ? 'authoring' : 'off',
    featureGateEnabled,
    storage: {
      ready: storageReady,
      backend: storageReady ? 'memory' : 'unknown',
      diagnostics: storageReady
        ? []
        : [
            diagnostic(
              STORAGE_UNAVAILABLE_REASON,
              'version.surfaceStatus.storageUnavailable',
              'storage',
            ),
          ],
    },
    current: {
      headCommitId: HEAD_COMMIT_ID,
      branchName: 'refs/heads/main',
      detached: false,
      stale: false,
      ...current,
    },
    dirty: {
      statusRevision: '1',
      checkoutPreflightToken: 'token-1',
      hasUncommittedLocalChanges: true,
      commitEligibleChanges: true,
      unsupportedDirtyDomains: [],
      pendingProviderWrites: false,
      pendingRecalc: false,
      checkoutSafe: true,
      unsafeReasons: [],
      source: 'VC-05',
      diagnostics: [],
      ...dirty,
    },
    capabilities: Object.fromEntries(
      ALL_CAPABILITIES.map((capability) => {
        const override = capabilityOverrides[capability];
        if (override) return [capability, override];
        if (!featureGateEnabled) {
          return [
            capability,
            disabledCapability(
              'The versionControl feature gate is disabled.',
              'featureGate',
              false,
            ),
          ];
        }
        if (!storageReady) {
          return [capability, disabledCapability(STORAGE_UNAVAILABLE_REASON, 'storage', true)];
        }
        return [capability, { enabled: true } satisfies VersionCapabilityState];
      }),
    ) as VersionSurfaceStatus['capabilities'],
    diagnostics,
  };
}

function disabledCapability(
  reason: string,
  dependency: VersionCapabilityDependency = 'VC-04',
  retryable = true,
): VersionCapabilityState {
  return { enabled: false, dependency, reason, retryable };
}

function redactedDisabledCapability(
  dependency: VersionCapabilityDependency = 'VC-04',
  retryable = true,
): VersionCapabilityState {
  return { enabled: false, dependency, retryable };
}

function ref(name: string): Pick<VersionRef, 'name'> {
  return { name: name as VersionRef['name'] };
}

function diagnostic(
  message: string,
  code = 'test.diagnostic',
  dependency?: VersionCapabilityDependency,
  data?: VersionDiagnostic['data'],
): VersionDiagnostic {
  return {
    code,
    severity: 'warning',
    message,
    ...(dependency ? { dependency } : {}),
    ...(data ? { data } : {}),
  };
}

function expectDisabled(
  availability: VersionActionAvailability,
  disabledReason: string,
  disabledReasonId?: VersionActionDisabledReasonId,
): void {
  expect(availability.enabled).toBe(false);
  if (availability.enabled) return;
  expect(availability.disabledReason).toBe(disabledReason);
  if (disabledReasonId) {
    expect(availability.disabledReasonId).toBe(disabledReasonId);
  } else {
    expect(typeof availability.disabledReasonId).toBe('string');
  }
}
