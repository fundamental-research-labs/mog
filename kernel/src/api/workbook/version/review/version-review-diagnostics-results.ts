import type { VersionResult, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { VersionReviewPublicOperation } from './version-review-operation';
import { hardenReviewDiffPage } from './version-review-diagnostics-diff';
import { sanitizeDiagnosticsInValue } from './version-review-diagnostics-sanitization';
import { versionFailureFromStoreDiagnostics } from '../../version-result';

export function hardenVersionReviewServiceResult<T>(
  operation: VersionReviewPublicOperation,
  result: VersionResult<T>,
): VersionResult<T> {
  if (!result.ok) return sanitizeDiagnosticsInValue(result) as VersionResult<T>;
  if (operation !== 'getReviewDiff') {
    return sanitizeDiagnosticsInValue(result) as VersionResult<T>;
  }

  const hardenedDiff = hardenReviewDiffPage(result.value);
  if (!hardenedDiff.ok) {
    return versionReviewFailureFromDiagnostics(operation, hardenedDiff.diagnostics);
  }
  return {
    ok: true,
    value: sanitizeDiagnosticsInValue(hardenedDiff.value) as T,
  };
}

export function versionReviewFailureFromDiagnostics<T>(
  operation: VersionReviewPublicOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return sanitizeDiagnosticsInValue(versionFailureFromStoreDiagnostics(operation, diagnostics));
}
