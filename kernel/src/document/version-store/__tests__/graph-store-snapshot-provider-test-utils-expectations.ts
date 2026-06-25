import type { VersionGraphReadRefResult, VersionGraphWriteResult } from '../graph';
import { versionGraphNamespaceKey, type VersionGraphNamespace } from '../object-store';
import type { VersionDocumentScope, VersionGraphInitializeResult } from '../provider';

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

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

export async function expectReloadErrorRedactsSecretScope(
  promise: Promise<unknown>,
  scope: VersionDocumentScope,
  namespace: VersionGraphNamespace,
): Promise<void> {
  try {
    await promise;
    throw new Error('expected reload failure');
  } catch (error) {
    const serialized = JSON.stringify(error);
    for (const leakedValue of [
      ...Object.values(scope),
      ...Object.values(namespace),
      versionGraphNamespaceKey(namespace),
    ]) {
      expect(serialized).not.toContain(leakedValue);
    }
  }
}
