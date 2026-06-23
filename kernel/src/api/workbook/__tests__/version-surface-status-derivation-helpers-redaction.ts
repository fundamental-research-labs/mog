import { jest } from '@jest/globals';

import { versionDomainSupportManifestOptions } from './version-domain-support-test-utils';
import {
  REDACTED_BATCH_STATUS_ID,
  REDACTED_CURSOR,
} from './version-surface-status-derivation-helpers-constants';
import { createSurfaceReadyVersionWithContext } from './version-surface-status-test-utils';

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
