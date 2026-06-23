export function createCleanSurfaceDirtyStatus() {
  return {
    statusRevision: 'dirty-revision-clean',
    checkoutPreflightToken: 'checkout-preflight-token-clean',
    hasUncommittedLocalChanges: false,
    commitEligibleChanges: false,
    unsupportedDirtyDomains: [],
    pendingProviderWrites: false,
    pendingRecalc: false,
    checkoutSafe: true,
    unsafeReasons: [],
    source: 'VC-05' as const,
    diagnostics: [],
  };
}

export function createSurfaceDirtyStatus() {
  return {
    statusRevision: 'dirty-revision-1',
    checkoutPreflightToken: 'checkout-preflight-token-1',
    hasUncommittedLocalChanges: false,
    commitEligibleChanges: false,
    unsupportedDirtyDomains: [],
    pendingProviderWrites: false,
    pendingRecalc: false,
    checkoutSafe: true,
    unsafeReasons: [],
    source: 'VC-05' as const,
    diagnostics: [],
  };
}

export function createSensitiveSurfaceDirtyDiagnostic() {
  return {
    code: 'version.surfaceStatus.dirtyWorkingState',
    severity: 'warning' as const,
    message: 'Workbook dirty-secret-message has uncommitted local changes.',
    dependency: 'VC-05' as const,
    data: {
      safeCount: 1,
      secretToken: 'dirty-secret-token',
      cursor: 'dirty-secret-cursor',
    },
  };
}

export function createSensitiveSurfaceDirtyStatus() {
  const sensitiveDirtyDiagnostic = createSensitiveSurfaceDirtyDiagnostic();

  return {
    statusRevision: 'dirty:secret-revision',
    checkoutPreflightToken: 'checkout-preflight-secret-token',
    hasUncommittedLocalChanges: true,
    commitEligibleChanges: true,
    unsupportedDirtyDomains: [],
    pendingProviderWrites: false,
    pendingRecalc: false,
    liveCollaboration: {
      state: 'idle',
      statusRevision: 'live:secret-room',
      roomId: 'room-secret-id',
    },
    checkoutSafe: false,
    unsafeReasons: [sensitiveDirtyDiagnostic],
    source: 'VC-05' as const,
    diagnostics: [sensitiveDirtyDiagnostic],
  };
}
