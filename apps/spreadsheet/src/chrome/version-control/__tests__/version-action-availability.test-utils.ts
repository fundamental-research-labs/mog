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
  getCheckoutAvailability,
  getCommitAvailability,
  getDiffAvailability,
  getRemotePromoteAvailability,
  getRollbackAvailability,
  type VersionActionAvailability,
  type VersionActionDisabledReasonId,
} from '../version-action-availability';

export const HEAD_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
export const TARGET_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
export const LATEST_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
export const STORAGE_UNAVAILABLE_REASON = 'Version storage is not ready for this workbook.';
export const READ_UNAVAILABLE_REASON = 'Version graph read services are not attached.';
export const VERSIONING_DISABLED_REASON = 'Versioning is disabled for this workbook.';

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

export type VersionActionCapability = Extract<
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

export const ACTION_CASES: readonly ActionCase[] = [
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

export const SPLIT_CAPABILITY_CASES: readonly {
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

export function createSurfaceStatus({
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

export function disabledCapability(
  reason: string,
  dependency: VersionCapabilityDependency = 'VC-04',
  retryable = true,
): VersionCapabilityState {
  return { enabled: false, dependency, reason, retryable };
}

export function redactedDisabledCapability(
  dependency: VersionCapabilityDependency = 'VC-04',
  retryable = true,
): VersionCapabilityState {
  return { enabled: false, dependency, retryable };
}

export function ref(name: string): Pick<VersionRef, 'name'> {
  return { name: name as VersionRef['name'] };
}

export function diagnostic(
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

export function expectDisabled(
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
