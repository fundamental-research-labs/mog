import type { VersionGraphCommitPageResult, VersionGraphWriteResult } from '../graph';
import { versionGraphNamespaceKey } from '../object-store';
import type { VersionGraphNamespace } from '../object-store';
import type { VersionDocumentScope, VersionStoreDiagnostic } from '../provider';

export function expectGraphWriteSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectListCommitsSuccess(
  result: VersionGraphCommitPageResult,
): asserts result is Extract<VersionGraphCommitPageResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') throw new Error('expected listCommits success');
}

export function expectNoSecretLeak(
  diagnostic: VersionStoreDiagnostic,
  documentScope: VersionDocumentScope,
  namespace: VersionGraphNamespace,
): void {
  const serialized = JSON.stringify(diagnostic);
  for (const secret of [
    documentScope.workspaceId,
    documentScope.documentId,
    documentScope.principalScope,
    namespace.graphId,
    versionGraphNamespaceKey(namespace),
  ]) {
    if (secret !== undefined) expect(serialized).not.toContain(secret);
  }
}
