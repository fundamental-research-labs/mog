import { checkoutAccessDeniedDiagnosticDetails } from './checkout-access-diagnostics';
import type { RefName } from './refs/ref-name';
import type {
  CheckoutMaterializationDiagnostic,
  CheckoutMaterializationDiagnosticCode,
  CheckoutMaterializationDiagnosticSource,
  CheckoutMaterializationErrorCode,
  CheckoutMaterializationResult,
} from './checkout-service';

export function checkoutFailure(
  code: CheckoutMaterializationErrorCode,
  message: string,
  diagnostics: readonly CheckoutMaterializationDiagnostic[],
): CheckoutMaterializationResult {
  const frozenDiagnostics = freezeCheckoutDiagnostics(diagnostics);
  return {
    ok: false,
    error: Object.freeze({
      code,
      message,
      diagnostics: frozenDiagnostics,
    }),
    diagnostics: frozenDiagnostics,
    mutationGuarantee: 'no-workbook-mutation',
  };
}

export function checkoutDiagnostic(
  code: CheckoutMaterializationDiagnosticCode,
  message: string,
  options: Omit<CheckoutMaterializationDiagnostic, 'code' | 'severity' | 'message'> & {
    readonly severity?: CheckoutMaterializationDiagnostic['severity'];
  } = {},
): CheckoutMaterializationDiagnostic {
  const { severity = 'error', ...rest } = options;
  return Object.freeze({
    code,
    severity,
    message,
    ...rest,
  });
}

export function freezeCheckoutDiagnostics(
  diagnostics: readonly CheckoutMaterializationDiagnostic[],
): readonly CheckoutMaterializationDiagnostic[] {
  return Object.freeze([...diagnostics]);
}

export function diagnosticsContainCode(
  diagnostics: readonly CheckoutMaterializationDiagnosticSource[],
  code: string,
): boolean {
  return diagnostics.some((entry) => {
    if (entry.code === code) return true;
    if ('sourceDiagnostics' in entry && entry.sourceDiagnostics !== undefined) {
      return diagnosticsContainCode(entry.sourceDiagnostics, code);
    }
    return false;
  });
}

export function checkoutAccessDeniedDiagnosticFromSources(
  diagnostics: readonly CheckoutMaterializationDiagnosticSource[],
  message: string,
  refName?: RefName,
): CheckoutMaterializationDiagnostic | null {
  const details = checkoutAccessDeniedDiagnosticDetails(diagnostics);
  if (!details) return null;
  return checkoutDiagnostic('VERSION_PERMISSION_DENIED', message, {
    ...(refName ? { refName } : {}),
    sourceDiagnostics: diagnostics,
    details,
  });
}

export function errorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}

export function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
