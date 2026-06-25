import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionDependencyRef, VersionObjectType, WorkbookCommitId } from '../object-digest';
import type {
  CommitVersionGraphInput,
  InitializeVersionGraphInput,
  VersionGraphWriteResult,
} from '../graph';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { RefVersion } from '../refs/ref-store';

export const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-object-batch',
  documentId: 'document-object-batch',
  graphId: 'graph-object-batch',
  principalScope: 'principal-object-batch',
};

export const OTHER_NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-secret-other',
  documentId: 'document-secret-other',
  graphId: 'graph-secret-other',
  principalScope: 'principal-secret-other',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

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

export async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace = NAMESPACE,
  dependencies: readonly VersionDependencyRef[] = [],
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
}

export async function graphInput(
  label: string,
  namespace: VersionGraphNamespace = NAMESPACE,
  snapshotDependencies: readonly VersionDependencyRef[] = [],
): Promise<InitializeVersionGraphInput> {
  const snapshotRootRecord = await objectRecord(
    'workbook.snapshotRoot.v1',
    { label, sheets: [] },
    namespace,
    snapshotDependencies,
  );
  const semanticChangeSetRecord = await objectRecord(
    'workbook.semanticChangeSet.v1',
    { label, changes: [] },
    namespace,
  );

  return {
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

export function commitInput(
  input: InitializeVersionGraphInput,
  expectedHeadCommitId: WorkbookCommitId,
  expectedMainRefVersion: RefVersion,
): CommitVersionGraphInput {
  return {
    ...input,
    expectedHeadCommitId,
    expectedMainRefVersion,
  };
}
