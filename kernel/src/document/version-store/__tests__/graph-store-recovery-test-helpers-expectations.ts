import type {
  VersionGraphClosureReadResult,
  VersionGraphReadHeadResult,
  VersionGraphStoreDiagnostic,
  VersionGraphWriteResult,
} from '../graph';
import { mapGraphDiagnostics } from '../provider-indexeddb/internal';
import { NAMESPACE } from './graph-store-recovery-test-helpers-fixtures';

export function expectGraphSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectGraphFailed(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected graph write failure');
  }
}

export function expectReadHeadDegraded(
  result: VersionGraphReadHeadResult,
): asserts result is Extract<VersionGraphReadHeadResult, { status: 'degraded' }> {
  expect(result.status).toBe('degraded');
  if (result.status !== 'degraded') {
    throw new Error('expected readHead degraded result');
  }
}

export function expectClosureFailed(
  result: VersionGraphClosureReadResult,
): asserts result is Extract<VersionGraphClosureReadResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected readCommitClosure failure');
  }
}

export function expectMappedRecoverability(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  recoverability: 'repair' | 'retry',
): void {
  expect(
    mapGraphDiagnostics(diagnostics, 'openGraph').map((diagnostic) => diagnostic.recoverability),
  ).toEqual(diagnostics.map(() => recoverability));
}

export function expectNoRawNamespaceLeak(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
): void {
  const serialized = JSON.stringify(diagnostics);
  expect(serialized).not.toContain('"path":');
  expect(serialized).not.toContain('"namespace":');
  expect(serialized).not.toContain(NAMESPACE.workspaceId);
  expect(serialized).not.toContain(NAMESPACE.documentId);
  expect(serialized).not.toContain(NAMESPACE.graphId);
  expect(serialized).not.toContain(NAMESPACE.principalScope);
}
