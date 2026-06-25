import type { VersionGraphReadHeadResult } from '../graph';
import type { VersionGraphInitializeResult, VersionGraphRegistryReadResult } from '../provider';

export function expectRegistryOk(
  result: VersionGraphRegistryReadResult,
): asserts result is Extract<VersionGraphRegistryReadResult, { status: 'ok' }> {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok')
    throw new Error(`expected registry ok: ${result.diagnostics[0]?.code}`);
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectReadHeadSuccess(
  result: VersionGraphReadHeadResult,
): asserts result is Extract<VersionGraphReadHeadResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') throw new Error(`expected readHead success`);
}
