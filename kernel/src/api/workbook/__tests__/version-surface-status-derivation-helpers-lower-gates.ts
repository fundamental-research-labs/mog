import { jest } from '@jest/globals';

import { createSurfaceReadyVersionWithContext } from './version-surface-status-test-utils';

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
      revertService: { revert: jest.fn() },
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
      revertService: { revert: jest.fn() },
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
