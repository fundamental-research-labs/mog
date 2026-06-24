import { jest } from '@jest/globals';

import { createWorkbookVersionSurfaceStatusService } from '../version/surface-status/version-surface-status-service';
import { createSurfaceReadyVersionWithContext } from './version-surface-status-test-utils';

export function createMalformedProviderWriteActivityStatusService() {
  return createWorkbookVersionSurfaceStatusService({
    readDirtyState: () => ({
      hasUncommittedLocalChanges: false,
      calculationState: 'done',
      checkoutInProgress: false,
      revision: 1,
      contextGeneration: 1,
    }),
    readPendingProviderWrites: () => ({
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
