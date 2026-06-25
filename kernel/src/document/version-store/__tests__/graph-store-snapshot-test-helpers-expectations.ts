import type { VersionGraphReadRefResult, VersionGraphWriteResult } from '../graph';

export function expectGraphSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectReadRefSuccess(
  result: VersionGraphReadRefResult,
): asserts result is Extract<VersionGraphReadRefResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readRef success: ${result.diagnostics[0]?.code}`);
  }
}
