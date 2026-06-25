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
const RAW_DIAGNOSTIC_PAYLOAD = 'rawPayload={"cell":"A1","value":"secret"}';

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
      getCapabilityAvailability({ surface }, false, false, 'version:reviewWrite'),
      DIRTY_STATUS_UNAVAILABLE_REASON,
      'version-dirty-status-unavailable',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:proposal'),
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
    expect(getCapabilityAvailability({ surface }, false, false, 'version:mergePreview')).toEqual({
      enabled: true,
    });
  });

  it('distinguishes disabled backing services for VC-08 G4 review, proposal, merge, revert, and remote actions', () => {
    const cases = [
      {
        capability: 'version:reviewRead',
        reason: 'Review metadata read services are not attached.',
        availability: (surface: VersionSurfaceStatus) =>
          getCapabilityAvailability({ surface }, false, false, 'version:reviewRead'),
      },
      {
        capability: 'version:reviewWrite',
        reason: 'Review metadata write services are not attached.',
        availability: (surface: VersionSurfaceStatus) =>
          getCapabilityAvailability({ surface }, false, false, 'version:reviewWrite'),
      },
      {
        capability: 'version:proposal',
        reason: 'Agent proposal workflows require an attached proposal service.',
        availability: (surface: VersionSurfaceStatus) =>
          getCapabilityAvailability({ surface }, false, false, 'version:proposal'),
      },
      {
        capability: 'version:mergePreview',
        reason: 'Version merge preview services are not attached.',
        availability: (surface: VersionSurfaceStatus) =>
          getCapabilityAvailability({ surface }, false, false, 'version:mergePreview'),
      },
      {
        capability: 'version:mergeApply',
        reason: 'Version merge apply requires merge preview and merge-commit write services.',
        availability: (surface: VersionSurfaceStatus) =>
          getCapabilityAvailability({ surface }, false, false, 'version:mergeApply'),
      },
      {
        capability: 'version:revert',
        reason: 'Authored revert is reserved until an upstream revert contract exists.',
        availability: (surface: VersionSurfaceStatus) =>
          getRollbackAvailability(
            { surface },
            false,
            false,
            'Rollback selected commit',
            TARGET_COMMIT_ID,
          ),
      },
      {
        capability: 'version:remotePromote',
        reason: 'No document-scoped pending remote promotion service is attached.',
        availability: (surface: VersionSurfaceStatus) =>
          getRemotePromoteAvailability({ surface }, false, false),
      },
    ] as const satisfies readonly {
      readonly capability: VersionCapability;
      readonly reason: string;
      readonly availability: (surface: VersionSurfaceStatus) => VersionActionAvailability;
    }[];

    for (const item of cases) {
      const surface = createSurfaceStatus({
        capabilityOverrides: {
          [item.capability]: disabledCapability(item.reason, 'storage', true),
        },
      });

      expectDisabled(item.availability(surface), item.reason, 'version-capability-unavailable');
    }
  });

  it('uses generic incomplete review and merge diff reasons without raw diagnostic payloads', () => {
    const incompleteReviewDiff = diagnostic(
      `Review diff incomplete for ${RAW_PRIVATE_REF} ${PRIVATE_COMMIT_ID} ${RAW_DIAGNOSTIC_PAYLOAD}.`,
      'VERSION_REVIEW_DIFF_INCOMPLETE',
    );
    const surface = createSurfaceStatus({ diagnostics: [incompleteReviewDiff] });
    const reason =
      'Review or merge diff diagnostics are incomplete; refresh version status before continuing.';

    for (const capability of [
      'version:reviewRead',
      'version:reviewWrite',
      'version:proposal',
      'version:mergePreview',
      'version:mergeApply',
    ] as const satisfies readonly VersionCapability[]) {
      const availability = getCapabilityAvailability({ surface }, false, false, capability);
      expectDisabled(availability, reason, 'version-diff-incomplete');
      expectNoRawDiagnosticPayload(availability);
    }

    expect(
      getRollbackAvailability(
        { surface },
        false,
        false,
        'Rollback selected commit',
        TARGET_COMMIT_ID,
      ),
    ).toEqual({ enabled: true });
    expect(getRemotePromoteAvailability({ surface }, false, false)).toEqual({ enabled: true });
  });

  it('uses stable capability-denied copy for host diagnostics without raw diagnostic payloads', () => {
    const surface = createSurfaceStatus({
      diagnostics: [
        diagnostic(
          `Host denied ${RAW_PRIVATE_PRINCIPAL} for ${RAW_PRIVATE_REF} ${RAW_DIAGNOSTIC_PAYLOAD}.`,
          'version.surfaceStatus.hostCapabilityDenied',
          { deniedCapabilities: ['version:remotePromote'] },
        ),
      ],
    });

    const availability = getRemotePromoteAvailability({ surface }, false, false);
    expectDisabled(
      availability,
      'Host policy denies this version capability.',
      'version-capability-host-denied',
    );
    expectNoRawDiagnosticPayload(availability);
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
      'Proposal is disabled by owner note internal-workstream/version-control.md token=fixture-token.';
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

function diagnostic(
  message: string,
  code: string,
  data?: VersionDiagnostic['data'],
): VersionDiagnostic {
  return {
    code,
    severity: 'warning',
    message,
    ...(data ? { data } : {}),
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

function expectNoRawDiagnosticPayload(availability: VersionActionAvailability): void {
  expect(availability.enabled).toBe(false);
  if (availability.enabled) return;
  expect(availability.disabledReason).not.toContain(RAW_PRIVATE_REF);
  expect(availability.disabledReason).not.toContain(RAW_PRIVATE_PRINCIPAL);
  expect(availability.disabledReason).not.toContain(PRIVATE_COMMIT_ID);
  expect(availability.disabledReason).not.toContain('rawPayload');
  expect(availability.disabledReason).not.toContain('secret');
}
