type DiagnosticLike = {
  readonly code?: unknown;
  readonly issueCode?: unknown;
  readonly details?: unknown;
  readonly payload?: unknown;
  readonly sourceDiagnostics?: readonly unknown[];
};

type PublicDiagnosticDetails = Readonly<Record<string, string | number | boolean | null>>;

export function checkoutAccessDeniedDiagnosticDetails(
  diagnostics: readonly unknown[],
): PublicDiagnosticDetails | null {
  for (const entry of diagnostics) {
    if (!isDiagnosticLike(entry)) continue;
    if (diagnosticCode(entry) === 'VERSION_PERMISSION_DENIED') {
      return Object.freeze({
        cause: 'VERSION_PERMISSION_DENIED',
        accessCategory: safeAccessCategory(entry) ?? 'access-denied',
      });
    }
    if (entry.sourceDiagnostics) {
      const nested = checkoutAccessDeniedDiagnosticDetails(entry.sourceDiagnostics);
      if (nested) return nested;
    }
  }
  return null;
}

export function hasCheckoutAccessDeniedDiagnostic(diagnostics: readonly unknown[]): boolean {
  return checkoutAccessDeniedDiagnosticDetails(diagnostics) !== null;
}

function diagnosticCode(diagnostic: DiagnosticLike): string | null {
  return typeof diagnostic.code === 'string'
    ? diagnostic.code
    : typeof diagnostic.issueCode === 'string'
      ? diagnostic.issueCode
      : null;
}

function safeAccessCategory(diagnostic: DiagnosticLike): string | null {
  const details = isRecord(diagnostic.details) ? diagnostic.details : null;
  const payload = isRecord(diagnostic.payload) ? diagnostic.payload : null;
  const category =
    details?.category ??
    details?.accessCategory ??
    details?.reason ??
    payload?.category ??
    payload?.accessCategory ??
    payload?.reason;
  return typeof category === 'string' && isSafeAccessCategory(category) ? category : null;
}

function isSafeAccessCategory(value: string): boolean {
  return (
    value === 'access-denied' ||
    value === 'permission-denied' ||
    value === 'redaction-policy' ||
    value === 'historical-acl-unavailable' ||
    value === 'subset-hidden'
  );
}

function isDiagnosticLike(value: unknown): value is DiagnosticLike {
  return typeof value === 'object' && value !== null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
