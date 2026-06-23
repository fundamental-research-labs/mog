import { jest } from '@jest/globals';

import { createWorkbookVersionSurfaceStatusService } from '../version-surface-status-service';
import {
  freshVersionDomainSupportManifest,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_ONE_MINUTE_MS,
  versionDomainSupportManifestOptions,
} from './version-domain-support-test-utils';
import {
  createSurfaceReadyVersionWithContext,
} from './version-surface-status-test-utils';

export { capabilityState } from './version-surface-status-test-utils';

export const REDACTED_BATCH_STATUS_ID = `sync-batch-status:sha256:${'9'.repeat(64)}`;
export const REDACTED_CURSOR = 'mog-pending-remote-v1.pending.cursor-secret';

export const READ_ONLY_PROVIDER_BACKED_CAPABILITIES = [
  'version:read',
  'version:diff',
  'version:checkout',
  'version:mergePreview',
] as const;

export const PROVIDER_WRITE_CAPABILITIES = [
  'version:commit',
  'version:branch',
  'version:mergeApply',
] as const;

export const FEATURE_GATE_SIBLING_CAPABILITIES = [
  'version:read',
  'version:commit',
  'version:mergePreview',
  'version:mergeApply',
] as const;

export const MANIFEST_OPERATION_CAPABILITIES = [
  'version:commit',
  'version:checkout',
  'version:mergePreview',
  'version:mergeApply',
] as const;

export const PROMOTED_SURFACE_CAPABILITIES = [
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:mergePreview',
  'version:mergeApply',
  'version:refAdmin',
  'version:provenance',
  'version:remotePromote',
] as const;

export const READ_ONLY_PROVIDER_DIAGNOSTIC_CODES = [
  'version.surfaceStatus.commitUnavailable',
  'version.surfaceStatus.branchUnavailable',
  'version.surfaceStatus.mergeApplyUnavailable',
  'version.surfaceStatus.refAdminUnavailable',
] as const;

export const FEATURE_GATE_DIAGNOSTIC_CODES = [
  'version.surfaceStatus.checkoutCapabilityDisabled',
  'version.surfaceStatus.revertCapabilityDisabled',
] as const;

export function createReadOnlyProviderBackedSurfaceVersion() {
  return createSurfaceReadyVersionWithContext(
    {},
    {
      provider: {
        kind: 'memory',
        documentScope: { documentId: 'document-1' },
        capabilities: {
          readOnlyHistory: true,
          reads: {
            graphRegistry: true,
            objects: true,
            refs: true,
            commits: true,
          },
          writes: {
            commitGraphWrite: false,
            putObjects: false,
            updateRefs: false,
          },
        },
      },
      captureMergeCommit: jest.fn(),
      mergeCommitMaterializer: { kind: 'test-materializer' },
    },
  );
}

export function createCheckoutAndRevertFeatureGateVersion() {
  return createSurfaceReadyVersionWithContext(
    {
      featureGates: {
        capabilities: {
          'versionControl.checkout': false,
          'versionControl.revert': false,
        },
      },
    },
    {
      captureMergeCommit: jest.fn(),
      mergeCommitMaterializer: { kind: 'test-materializer' },
    },
  );
}

export function createStaleManifestSurfaceVersion() {
  return createSurfaceReadyVersionWithContext(
    {},
    {
      domainSupportManifest: freshVersionDomainSupportManifest({
        generatedAt: '2026-06-20T00:00:00.000Z',
      }),
      domainSupportManifestOptions: versionDomainSupportManifestOptions({
        now: VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW,
        maxAgeMs: VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_ONE_MINUTE_MS,
      }),
      captureMergeCommit: jest.fn(),
      mergeCommitMaterializer: { kind: 'test-materializer' },
    },
  );
}

export function createMixedLowerGateEvidenceSurfaceVersion() {
  const promotePendingRemoteSegments = jest.fn();
  const surfaceReady = createSurfaceReadyVersionWithContext(
    {
      policySnapshot: {
        decisions: [
          { capability: 'version:remotePromote', decision: 'allowed' },
          { capability: 'version:provenance', decision: 'allowed' },
        ],
      },
    },
    {
      captureMergeCommit: jest.fn(),
      mergeCommitMaterializer: { kind: 'test-materializer' },
      provenanceTruthService: {
        vc09ProvenanceTruthComplete: true,
      },
      pendingRemotePromotionService: {
        promotePendingRemoteSegments,
      },
      surfaceStatusLowerGateEvidence: {
        promotionStatus: 'pass',
        rolloutStage: 'ui-beta',
        requiredLowerGates: [
          'g1-shadow-only-stage-entry',
          'gate5-corpus-shadow-threshold',
          'g7-merge-shadow-apply-proof',
        ],
        lowerGateResults: [
          {
            gateId: 'g1-shadow-only-stage-entry',
            status: 'pass',
            currentForTarget: true,
          },
          {
            gateId: 'gate5-corpus-shadow-threshold',
            status: 'blocked',
            currentForTarget: false,
          },
        ],
        sourceRepos: [{ repoId: 'mog', status: 'dirtyBlocked' }],
        capabilityGateCas: {
          status: 'pass',
          readbackStage: 'ui-beta',
        },
      },
    },
  );

  return {
    ...surfaceReady,
    promotePendingRemoteSegments,
  };
}

export function createLowerGateRedactionSurfaceVersion(rawGateId: string, rawRepoId: string) {
  return createSurfaceReadyVersionWithContext(
    {},
    {
      provenanceTruthService: {
        vc09ProvenanceTruthComplete: true,
      },
      surfaceStatusLowerGateEvidence: {
        status: 'blockedByLowerGateEvidence',
        lowerGateResults: [
          {
            gateId: rawGateId,
            status: 'blocked',
            currentForTarget: false,
          },
        ],
        sourceRepos: [{ repoId: rawRepoId, status: 'dirtyBlocked' }],
      },
    },
  );
}

export function createMalformedManifestAndDirtyStatusSurfaceVersion() {
  const readDirtyStatus = jest.fn(() => ({
    statusRevision: 'dirty-redacted',
    checkoutPreflightToken: 'checkout-preflight-redacted',
    hasUncommittedLocalChanges: false,
    commitEligibleChanges: false,
    unsupportedDirtyDomains: [],
    pendingProviderWrites: false,
    pendingRecalc: false,
    checkoutSafe: false,
    unsafeReasons: [
      {
        code: 'version.surfaceStatus.pendingProviderWrites',
        severity: 'warning',
        message: 'Provider writes are not settled.',
        dependency: 'VC-09',
        data: {
          cursor: REDACTED_CURSOR,
          batchStatusId: REDACTED_BATCH_STATUS_ID,
          hiddenSheetId: 'sheet-secret',
          safeCount: 2,
          nested: { raw: 'not-public' },
        },
      },
    ],
    source: 'VC-05' as const,
    diagnostics: [
      {
        code: 'version.surfaceStatus.pendingProviderWrites',
        severity: 'warning',
        message: 'Provider writes are not settled.',
        dependency: 'VC-09',
        data: {
          cursor: REDACTED_CURSOR,
          batchStatusId: REDACTED_BATCH_STATUS_ID,
          secretToken: 'token-secret',
          safeCount: 2,
        },
      },
    ],
  }));
  const surfaceReady = createSurfaceReadyVersionWithContext(
    {},
    {
      domainSupportManifest: {
        schemaVersion: 'not-public-secret-schema',
        generatedAt: 'not-public-secret-date',
        domains: [],
      },
      domainSupportManifestOptions: versionDomainSupportManifestOptions(),
      surfaceStatusService: {
        readDirtyStatus,
      },
    },
  );

  return {
    ...surfaceReady,
    readDirtyStatus,
  };
}

export function pendingProviderWriteDiagnostic() {
  return {
    code: 'version.surfaceStatus.pendingProviderWrites',
    severity: 'warning' as const,
    message:
      'Remote sync changes are waiting to be promoted into version history; checkout is unsafe.',
    dependency: 'VC-09' as const,
    data: { pendingRemoteSegmentCount: 2 },
  };
}

export function createAuthorizedPendingRemotePromotionSurfaceVersion() {
  const promotePendingRemoteSegments = jest.fn();
  const pendingProviderDiagnostic = pendingProviderWriteDiagnostic();
  const surfaceReady = createSurfaceReadyVersionWithContext(
    {
      policySnapshot: {
        decisions: [
          { capability: 'version:remotePromote', decision: 'allowed' },
          { capability: 'version:provenance', decision: 'allowed' },
        ],
      },
    },
    {
      provenanceTruthService: {
        vc09ProvenanceTruthComplete: true,
      },
      pendingRemotePromotionService: {
        promotePendingRemoteSegments,
      },
      surfaceStatusService: {
        readDirtyStatus: () => ({
          statusRevision: 'pendingRemote:2',
          checkoutPreflightToken: 'token:pendingRemote:2',
          hasUncommittedLocalChanges: false,
          commitEligibleChanges: false,
          unsupportedDirtyDomains: [],
          pendingProviderWrites: true,
          pendingRecalc: false,
          checkoutSafe: false,
          unsafeReasons: [pendingProviderDiagnostic],
          source: 'VC-05' as const,
          diagnostics: [pendingProviderDiagnostic],
        }),
      },
    },
  );

  return {
    ...surfaceReady,
    pendingProviderDiagnostic,
    promotePendingRemoteSegments,
  };
}

export function createMalformedProviderWriteActivityStatusService() {
  return createWorkbookVersionSurfaceStatusService({
    readDirtyState: () => ({
      hasUncommittedLocalChanges: false,
      calculationState: 'done',
      checkoutInProgress: false,
      revision: 1,
      contextGeneration: 1,
    }),
    readPendingProviderWrites: () =>
      ({
        pendingProviderWrites: false,
        statusRevision: 'providerActivity:stale secret cursor',
        unsafeReasons: [],
        diagnostics: [],
      }),
  });
}

export function createProviderFailureClaimedSafeSurfaceVersion() {
  const providerReadFailed = {
    code: 'version.surfaceStatus.pendingProviderWritesReadFailed',
    severity: 'warning' as const,
    message: 'Version provider write activity could not be proven settled.',
    dependency: 'VC-09' as const,
    data: { safeCount: 1 },
  };
  const readDirtyStatus = jest.fn(() => ({
    statusRevision: 'dirty-provider-unknown',
    checkoutPreflightToken: 'checkout-provider-unknown',
    hasUncommittedLocalChanges: false,
    commitEligibleChanges: false,
    unsupportedDirtyDomains: [],
    pendingProviderWrites: false,
    pendingRecalc: false,
    checkoutSafe: true,
    unsafeReasons: [],
    source: 'VC-05' as const,
    diagnostics: [providerReadFailed],
  }));
  const surfaceReady = createSurfaceReadyVersionWithContext(
    {},
    { surfaceStatusService: { readDirtyStatus } },
  );

  return {
    ...surfaceReady,
    providerReadFailed,
    readDirtyStatus,
  };
}
