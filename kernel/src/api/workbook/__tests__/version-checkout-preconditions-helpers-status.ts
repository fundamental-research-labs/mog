export function cleanDirtyStatus(statusRevision: string) {
  return {
    statusRevision,
    checkoutPreflightToken: `token:${statusRevision}`,
    hasUncommittedLocalChanges: false,
    commitEligibleChanges: false,
    unsupportedDirtyDomains: [],
    pendingProviderWrites: false,
    pendingRecalc: false,
    checkoutSafe: true,
    unsafeReasons: [],
    source: 'VC-05',
    diagnostics: [],
  };
}

export function unsafeAdmissionDirtyStatus() {
  const reason = {
    code: 'version.surfaceStatus.checkoutAdmissionDenied',
    severity: 'warning',
    message: 'Injected checkout admission denial.',
  };
  return {
    ...cleanDirtyStatus('generic-admission-denied'),
    checkoutSafe: false,
    unsafeReasons: [reason],
    diagnostics: [reason],
  };
}

export function unsupportedDomainDirtyStatus() {
  const reason = {
    code: 'version.surfaceStatus.unsupportedDirtyDomain',
    severity: 'warning' as const,
    message: 'Workbook has unsupported dirty domain state: secret-unsupported-domain-value.',
    dependency: 'VC-05' as const,
    data: {
      domainId: 'private-macros',
      path: 'private.unsupported.domains[0]',
      raw: 'secret-unsupported-domain-value',
    },
  };
  return {
    ...cleanDirtyStatus('unsupported-domain-admission-denied'),
    unsupportedDirtyDomains: ['private-macros'],
    checkoutSafe: false,
    unsafeReasons: [reason],
    diagnostics: [reason],
  };
}
