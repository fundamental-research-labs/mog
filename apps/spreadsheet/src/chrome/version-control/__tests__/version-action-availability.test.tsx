import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionCapabilityState,
  VersionDiagnostic,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  getBranchAvailability,
  getCheckoutAvailability,
  getCommitAvailability,
  getDiffAvailability,
  type VersionActionAvailability,
} from '../version-action-availability';

const HEAD_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const TARGET_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
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
];

type VersionActionCapability = Extract<
  VersionCapability,
  'version:commit' | 'version:branch' | 'version:checkout' | 'version:diff'
>;

type ActionAvailabilityOptions = {
  readonly actionBusy?: boolean;
  readonly loading?: boolean;
  readonly commitMessage?: string;
  readonly branchName?: string;
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
    availability: (surface, options = {}) =>
      getBranchAvailability(
        { surface },
        options.actionBusy ?? false,
        options.loading ?? false,
        options.branchName ?? 'refs/heads/review',
        options.targetCommitId ?? TARGET_COMMIT_ID,
      ),
  },
  {
    capability: 'version:checkout',
    availability: (surface, options = {}) =>
      getCheckoutAvailability(
        { surface },
        options.actionBusy ?? false,
        options.loading ?? false,
      ),
  },
  {
    capability: 'version:diff',
    availability: (surface, options = {}) =>
      getDiffAvailability(
        { surface },
        options.actionBusy ?? false,
        options.loading ?? false,
      ),
  },
];

describe('version action availability', () => {
  it('disables actions while status data is missing, loading, or another action is running', () => {
    expectDisabled(
      getCommitAvailability(undefined, false, false, 'Checkpoint'),
      'Version status is unavailable.',
    );
    expectDisabled(
      getBranchAvailability(undefined, false, false, 'refs/heads/review', TARGET_COMMIT_ID),
      'Version status is unavailable.',
    );
    expectDisabled(
      getCheckoutAvailability(undefined, false, false),
      'Version status is unavailable.',
    );
    expectDisabled(getDiffAvailability(undefined, false, false), 'Version status is unavailable.');

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
  });

  it('fails closed when the surface status itself is unavailable', () => {
    expectDisabled(
      getCommitAvailability({}, false, false, 'Checkpoint'),
      'Version surface status is unavailable.',
    );
    expectDisabled(
      getBranchAvailability({}, false, false, 'refs/heads/review', TARGET_COMMIT_ID),
      'Version surface status is unavailable.',
    );
    expectDisabled(
      getCheckoutAvailability({}, false, false),
      'Version surface status is unavailable.',
    );
    expectDisabled(getDiffAvailability({}, false, false), 'Version surface status is unavailable.');
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

  it('disables commit and checkout while provider writes are pending', () => {
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
    expect(
      getBranchAvailability({ surface }, false, false, 'refs/heads/review', TARGET_COMMIT_ID),
    ).toEqual({ enabled: true });
    expect(getDiffAvailability({ surface }, false, false)).toEqual({ enabled: true });
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
      getBranchAvailability({ surface }, false, false, 'refs/heads/review', undefined),
      'Select a commit target first.',
    );
    expectDisabled(
      getBranchAvailability({ surface }, false, false, '   ', TARGET_COMMIT_ID),
      'Enter a branch name.',
    );
  });

  it('does not let local prerequisites hide disabled surface capabilities', () => {
    const actionCapabilityReasons: Record<VersionActionCapability, string> = {
      'version:commit': 'Commit is disabled by the surface contract.',
      'version:branch': 'Branch is disabled by the surface contract.',
      'version:checkout': 'Checkout is disabled by the surface contract.',
      'version:diff': 'Diff is disabled by the surface contract.',
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
}: {
  readonly featureGateEnabled?: boolean;
  readonly storageReady?: boolean;
  readonly current?: Partial<VersionSurfaceStatus['current']>;
  readonly dirty?: Partial<VersionSurfaceStatus['dirty']>;
  readonly capabilityOverrides?: Partial<Record<VersionCapability, VersionCapabilityState>>;
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
    diagnostics: [],
  };
}

function disabledCapability(
  reason: string,
  dependency: VersionCapabilityDependency = 'VC-04',
  retryable = true,
): VersionCapabilityState {
  return { enabled: false, dependency, reason, retryable };
}

function diagnostic(
  message: string,
  code = 'test.diagnostic',
  dependency?: VersionCapabilityDependency,
): VersionDiagnostic {
  return {
    code,
    severity: 'warning',
    message,
    ...(dependency ? { dependency } : {}),
  };
}

function expectDisabled(availability: VersionActionAvailability, disabledReason: string): void {
  expect(availability).toEqual({ enabled: false, disabledReason });
}
