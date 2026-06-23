import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionCapabilityState,
  VersionDiagnostic,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  getCapabilityAvailability,
  getRemotePromoteAvailability,
  getRollbackAvailability,
  type VersionActionAvailability,
  type VersionActionDisabledReasonId,
} from '../version-action-availability';

const HEAD_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const TARGET_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
const LATEST_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;

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

const SPLIT_CAPABILITIES = [
  'version:reviewRead',
  'version:reviewWrite',
  'version:proposal',
  'version:mergePreview',
  'version:mergeApply',
  'version:provenance',
] as const satisfies readonly VersionCapability[];

describe('version action availability W11 hardening', () => {
  it('keeps split host capability denials scoped with stable false reason ids', () => {
    for (const blockedCapability of SPLIT_CAPABILITIES) {
      const reason = `Host policy denies ${blockedCapability}.`;
      const surface = createSurfaceStatus({
        capabilityOverrides: {
          [blockedCapability]: disabledCapability(reason, 'hostCapability', false),
        },
      });

      for (const capability of SPLIT_CAPABILITIES) {
        const availability = getCapabilityAvailability({ surface }, false, false, capability);

        if (capability === blockedCapability) {
          expectDisabled(availability, reason, 'version-capability-host-denied');
        } else {
          expect(availability).toEqual({ enabled: true });
        }
      }
    }
  });

  it('maps stale checkout status to stable false reasons for every split capability', () => {
    const surface = createSurfaceStatus({
      current: {
        checkedOutCommitId: HEAD_COMMIT_ID,
        refHeadAtMaterialization: HEAD_COMMIT_ID,
        currentRefHeadId: LATEST_COMMIT_ID,
        stale: true,
        staleReason: 'activeSessionBehind',
      },
    });
    const prefix =
      'main is stale because the active checkout session is behind the branch head.';
    const expectedReasons: Record<(typeof SPLIT_CAPABILITIES)[number], string> = {
      'version:reviewRead': `${prefix} Refresh before reviewing version changes.`,
      'version:reviewWrite': `${prefix} Refresh before reviewing version changes.`,
      'version:proposal': `${prefix} Refresh before reviewing version changes.`,
      'version:mergePreview': `${prefix} Refresh before merging.`,
      'version:mergeApply': `${prefix} Refresh before merging.`,
      'version:provenance': `${prefix} Refresh before exporting version metadata.`,
    };

    for (const capability of SPLIT_CAPABILITIES) {
      expectDisabled(
        getCapabilityAvailability({ surface }, false, false, capability),
        expectedReasons[capability],
        'version-head-stale',
      );
    }
  });

  it('blocks rollback staging with a stable pending-provider-write reason before local input validation', () => {
    const pendingProviderWrites = diagnostic(
      'Remote sync changes are waiting to be promoted into version history; revert is unsafe.',
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
      getRollbackAvailability({ surface }, false, false, '   ', undefined),
      pendingProviderWrites.message,
      'version-provider-writes-pending',
    );
  });

  it('uses the rollback pending-provider-write fallback when diagnostics are redacted', () => {
    const surface = createSurfaceStatus({
      dirty: {
        pendingProviderWrites: true,
        checkoutSafe: false,
      },
    });

    expectDisabled(
      getRollbackAvailability(
        { surface },
        false,
        false,
        'Rollback selected commit',
        TARGET_COMMIT_ID,
      ),
      'Wait for provider writes to settle before staging rollback.',
      'version-provider-writes-pending',
    );
  });

  it('keeps pending remote promotion available while provider writes are pending', () => {
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

    expect(getRemotePromoteAvailability({ surface }, false, false)).toEqual({ enabled: true });
  });

  it('lets remote promote host capability denial win over pending backlog diagnostics', () => {
    const reason = 'Host policy denies version:remotePromote.';
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
      capabilityOverrides: {
        'version:remotePromote': disabledCapability(reason, 'hostCapability', false),
      },
    });

    expectDisabled(
      getRemotePromoteAvailability({ surface }, false, false),
      reason,
      'version-capability-host-denied',
    );
  });
});

function createSurfaceStatus({
  current = {},
  dirty = {},
  capabilityOverrides = {},
  diagnostics = [],
}: {
  readonly current?: Partial<VersionSurfaceStatus['current']>;
  readonly dirty?: Partial<VersionSurfaceStatus['dirty']>;
  readonly capabilityOverrides?: Partial<Record<VersionCapability, VersionCapabilityState>>;
  readonly diagnostics?: readonly VersionDiagnostic[];
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
      ALL_CAPABILITIES.map((capability) => [
        capability,
        capabilityOverrides[capability] ?? ({ enabled: true } satisfies VersionCapabilityState),
      ]),
    ) as VersionSurfaceStatus['capabilities'],
    diagnostics,
  };
}

function disabledCapability(
  reason: string,
  dependency: VersionCapabilityDependency,
  retryable: boolean,
): VersionCapabilityState {
  return { enabled: false, dependency, reason, retryable };
}

function diagnostic(message: string, code: string): VersionDiagnostic {
  return {
    code,
    severity: 'warning',
    message,
  };
}

function expectDisabled(
  availability: VersionActionAvailability,
  disabledReason: string,
  disabledReasonId: VersionActionDisabledReasonId,
): void {
  expect(availability.enabled).toBe(false);
  if (availability.enabled) return;
  expect(availability.disabledReason).toBe(disabledReason);
  expect(availability.disabledReasonId).toBe(disabledReasonId);
}
