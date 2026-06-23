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
  getCheckoutAvailability,
  getCommitAvailability,
  getDiffAvailability,
  getRemotePromoteAvailability,
  getRollbackAvailability,
  type VersionActionAvailability,
  type VersionActionDisabledReasonId,
} from '../version-action-availability';

const HEAD_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const TARGET_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
const LATEST_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
const DIRTY_STATUS_UNAVAILABLE_REASON =
  'Dirty status is unavailable; refresh version status before continuing.';
const RAW_PRIVATE_REF = 'refs/provider-internal/sync/private-main';
const RAW_PRIVATE_PRINCIPAL = 'alice@example.com';
const PRIVATE_COMMIT_ID = `commit:sha256:${'d'.repeat(64)}`;

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
    const prefix = 'main is stale because the active checkout session is behind the branch head.';
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

  it('blocks dirty-dependent actions when the VC-05 dirty snapshot is unavailable', () => {
    const surface = createSurfaceStatus({
      dirty: {
        source: undefined as never,
        checkoutPreflightToken: '',
        diagnostics: undefined as never,
      },
    });

    expectDisabled(
      getCommitAvailability({ surface }, false, false, 'Checkpoint'),
      DIRTY_STATUS_UNAVAILABLE_REASON,
      'version-dirty-status-unavailable',
    );
    expectDisabled(
      getCheckoutAvailability({ surface }, false, false),
      DIRTY_STATUS_UNAVAILABLE_REASON,
      'version-dirty-status-unavailable',
    );
    expectDisabled(
      getRollbackAvailability(
        { surface },
        false,
        false,
        'Rollback selected commit',
        TARGET_COMMIT_ID,
      ),
      DIRTY_STATUS_UNAVAILABLE_REASON,
      'version-dirty-status-unavailable',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:mergeApply'),
      DIRTY_STATUS_UNAVAILABLE_REASON,
      'version-dirty-status-unavailable',
    );
    expectDisabled(
      getRemotePromoteAvailability({ surface }, false, false),
      DIRTY_STATUS_UNAVAILABLE_REASON,
      'version-dirty-status-unavailable',
    );
    expect(getDiffAvailability({ surface }, false, false)).toEqual({ enabled: true });
    expect(getCapabilityAvailability({ surface }, false, false, 'version:reviewRead')).toEqual({
      enabled: true,
    });
  });

  it('blocks split write capabilities while provider writes are pending', () => {
    const pendingProviderWrites = diagnostic(
      'Provider writes are still settling before write actions can continue.',
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

    for (const capability of [
      'version:reviewWrite',
      'version:proposal',
      'version:mergeApply',
      'version:provenance',
    ] as const satisfies readonly VersionCapability[]) {
      expectDisabled(
        getCapabilityAvailability({ surface }, false, false, capability),
        pendingProviderWrites.message,
        'version-provider-writes-pending',
      );
    }
    expect(getCapabilityAvailability({ surface }, false, false, 'version:reviewRead')).toEqual({
      enabled: true,
    });
    expect(getCapabilityAvailability({ surface }, false, false, 'version:mergePreview')).toEqual({
      enabled: true,
    });
    expect(getRemotePromoteAvailability({ surface }, false, false)).toEqual({ enabled: true });
  });

  it('sanitizes private diagnostic and capability-owner details in disabled reasons', () => {
    const surfaceDiagnostic = diagnostic(
      `Checkout blocked for ${RAW_PRIVATE_REF} principalId=${RAW_PRIVATE_PRINCIPAL} at ${PRIVATE_COMMIT_ID}.`,
      'version.surfaceStatus.pendingProviderWrites',
    );
    const capabilityReason =
      'Proposal is disabled by owner note /Users/private/mog-internal/plans/active/version-control.md token=private-token.';
    const surface = createSurfaceStatus({
      dirty: {
        pendingProviderWrites: true,
        checkoutSafe: false,
        unsafeReasons: [surfaceDiagnostic],
        diagnostics: [surfaceDiagnostic],
      },
      capabilityOverrides: {
        'version:proposal': disabledCapability(capabilityReason, 'VC-05', true),
      },
    });

    expectDisabled(
      getCheckoutAvailability({ surface }, false, false),
      'Checkout blocked for [version ref] principal [principal] at [commit].',
      'version-provider-writes-pending',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:proposal'),
      'Proposal is disabled by owner note [internal reference] token [secret]',
      'version-capability-unavailable',
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
