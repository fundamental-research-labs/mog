import type {
  VersionDiagnosticPublicPayload,
  VersionResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { VersionReviewPublicOperation } from './version-review-operation';
import {
  hardenVersionReviewServiceResult,
  versionReviewFailureFromDiagnostics,
} from './version-review-diagnostics';

export function mapReviewServiceResult<T>(
  operation: VersionReviewPublicOperation,
  value: unknown,
): VersionResult<T> {
  if (isVersionResult(value)) {
    return hardenVersionReviewServiceResult(operation, value as VersionResult<T>);
  }
  if (isRecord(value)) {
    return hardenVersionReviewServiceResult(operation, { ok: true, value: value as T });
  }
  return reviewFailure(operation, [providerInvalidPayloadDiagnostic(operation)]);
}

export function invalidStateResult<T>(
  operation: VersionReviewPublicOperation,
  state: string,
  reason: string,
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'invalid_state',
      state,
      allowed: ['valid_review_contract'],
      reason,
    },
  };
}

export function reviewFailure<T>(
  operation: VersionReviewPublicOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return versionReviewFailureFromDiagnostics(operation, diagnostics);
}

export function serviceUnavailableDiagnostic(
  operation: VersionReviewPublicOperation,
): VersionStoreDiagnostic {
  return reviewDiagnostic(
    operation,
    'VERSION_REVIEW_SERVICE_UNAVAILABLE',
    'No document-scoped version review service is attached; no review records are fabricated.',
    { recoverability: 'unsupported' },
  );
}

export function methodUnavailableDiagnostic(
  operation: VersionReviewPublicOperation,
): VersionStoreDiagnostic {
  return reviewDiagnostic(
    operation,
    'VERSION_REVIEW_METHOD_UNAVAILABLE',
    `The attached version review service does not implement ${operation}.`,
    { recoverability: 'unsupported' },
  );
}

export function providerErrorDiagnostic(
  operation: VersionReviewPublicOperation,
): VersionStoreDiagnostic {
  return reviewDiagnostic(
    operation,
    'VERSION_PROVIDER_ERROR',
    'The version review service failed before returning a usable public result.',
    { recoverability: 'retry', severity: 'error' },
  );
}

export function invalidOptionDiagnostic(
  operation: VersionReviewPublicOperation,
  option: string,
  safeMessage: string,
): VersionStoreDiagnostic {
  return reviewDiagnostic(operation, 'VERSION_INVALID_OPTIONS', safeMessage, {
    payload: { option },
  });
}

function isVersionResult(value: unknown): boolean {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok === true) return 'value' in value;
  return value.ok === false && isRecord(value.error);
}

function providerInvalidPayloadDiagnostic(
  operation: VersionReviewPublicOperation,
): VersionStoreDiagnostic {
  return reviewDiagnostic(
    operation,
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'The version review service did not return a valid public review result.',
    { recoverability: 'repair', severity: 'error' },
  );
}

function reviewDiagnostic(
  operation: VersionReviewPublicOperation,
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? 'none',
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    payload: { operation, ...(options.payload ?? {}) },
    redacted: true,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
