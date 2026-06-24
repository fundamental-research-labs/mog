import type { VersionRecordRevision } from '@mog-sdk/contracts/api';

import {
  type VersionNormalCommitCaptureFinalizeResult,
  type WorkbookVersionCommitServiceCommitResult,
} from '../commit-service';
import { VERSION_GRAPH_MAIN_REF } from '../graph';
import type { WorkbookCommitId } from '../object-digest';
import {
  namespaceForDocumentScope,
  type VersionGraphInitializeResult,
  type VersionStoreDiagnostic,
  type VersionStoreProvider,
} from '../provider';

import { DOCUMENT_SCOPE } from './commit-service-support-fixtures';

export function expectRefRevision(
  result: Extract<WorkbookVersionCommitServiceCommitResult, { status: 'success' }>,
): VersionRecordRevision {
  if (!result.commitRef.refRevision) {
    throw new Error('expected commit ref revision');
  }
  return result.commitRef.refRevision;
}

export function expectCommitSuccess(
  result: WorkbookVersionCommitServiceCommitResult,
): asserts result is Extract<WorkbookVersionCommitServiceCommitResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected commit success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export async function expectMainRefUnchanged(
  provider: VersionStoreProvider,
  initialized: Extract<VersionGraphInitializeResult, { status: 'success' }>,
): Promise<void> {
  await expectMainRefMatches(provider, initialized.rootCommit.id, initialized.initialHead.revision);
}

export async function expectMainRefMatches(
  provider: VersionStoreProvider,
  commitId: WorkbookCommitId,
  revision: VersionRecordRevision,
): Promise<void> {
  const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
  await expect(graph.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
    status: 'success',
    ref: {
      name: VERSION_GRAPH_MAIN_REF,
      commitId,
      revision,
    },
  });
}

export function expectFailedFinalize(
  finalize: { mock: { calls: readonly (readonly unknown[])[] } },
  diagnostics: readonly VersionStoreDiagnostic[],
): void {
  expect(finalize.mock.calls).toHaveLength(1);
  expect(finalize.mock.calls[0]?.[0]).toEqual({
    status: 'failed',
    diagnostics,
  } satisfies VersionNormalCommitCaptureFinalizeResult);
}

export function expectPublicSafeDiagnostics(
  diagnostics: readonly VersionStoreDiagnostic[],
  forbiddenPayload: string,
): void {
  expect(JSON.stringify(diagnostics)).not.toContain(forbiddenPayload);
  expect(JSON.stringify(diagnostics)).not.toContain('Error:');
  for (const diagnostic of diagnostics) {
    expect(diagnostic).toMatchObject({
      redacted: true,
      message: diagnostic.safeMessage,
    });
  }
}
