import type { VersionGraphWriteResult } from '../../../document/version-store/graph';
import type { VersionObjectPutBatchResult } from '../../../document/version-store/object-store';
import type { VersionGraphInitializeResult } from '../../../document/version-store/provider';
import type { VersionGraphWriteSuccess } from './version-apply-merge-idempotency-stale-ordering-helpers-core';

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectGraphWriteSuccess(
  result: VersionGraphWriteResult,
): asserts result is VersionGraphWriteSuccess {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectObjectPutSuccess(
  result: VersionObjectPutBatchResult,
): asserts result is Extract<VersionObjectPutBatchResult, { readonly status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected object put success: ${result.diagnostics[0]?.code}`);
  }
}
