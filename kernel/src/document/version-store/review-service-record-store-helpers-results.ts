import type { VersionDiagnostic, VersionResult } from '@mog-sdk/contracts/api';

export function ok<T>(value: T): VersionResult<T> {
  return { ok: true, value };
}

export function notFound<T>(reviewId: string): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'not_found',
      target: 'workbook.version.review',
      reason: `Review record ${reviewId} was not found.`,
    },
  };
}

export function staleRevision<T>(
  expectedRevision: number,
  actualRevision: number,
): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'stale_revision', expectedRevision, actualRevision },
  };
}

export function invalidClientRequestReuse<T>(): VersionResult<T> {
  return invalidState(
    'review_client_request_reused',
    ['idempotent_retry'],
    'clientRequestId is already bound to a different review mutation payload.',
  );
}

export function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}

export function diagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
): VersionDiagnostic {
  return { code, severity, message };
}
