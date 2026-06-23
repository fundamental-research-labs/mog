import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  parseWorkbookCommitId,
  workbookCommitIdFromObjectDigest,
  type VersionDependencyRef,
  type VersionObjectType,
  type WorkbookCommitId,
} from '../object-digest';
import {
  createVersionObjectRecord,
  type InMemoryVersionObjectStore,
  type VersionGraphNamespace,
  type VersionObjectMemoryBackend,
  type VersionObjectRecord,
} from '../object-store';
import type { RefVersion } from '../ref-store';
import type {
  CommitVersionGraphInput,
  InitializeVersionGraphInput,
  VersionGraphCommitPageResult,
  VersionGraphReadHeadResult,
  VersionGraphReadRefResult,
  VersionGraphWriteResult,
} from '../graph-store';

export const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

export const OTHER_NAMESPACE: VersionGraphNamespace = {
  ...NAMESPACE,
  documentId: 'document-2',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
}

export function refVersion(value: string): RefVersion {
  return { kind: 'counter', value };
}

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

export function expectReadHeadSuccess(
  result: VersionGraphReadHeadResult,
): asserts result is Extract<VersionGraphReadHeadResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readHead success: ${result.diagnostics[0]?.code}`);
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

export function expectReadRefSuccess(
  result: VersionGraphReadRefResult,
): asserts result is Extract<VersionGraphReadRefResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readRef success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectReadRefDegraded(
  result: VersionGraphReadRefResult,
): asserts result is Extract<VersionGraphReadRefResult, { status: 'degraded' }> {
  expect(result.status).toBe('degraded');
  if (result.status !== 'degraded') {
    throw new Error('expected readRef degraded result');
  }
}

export function expectListSuccess(
  result: VersionGraphCommitPageResult,
): asserts result is Extract<VersionGraphCommitPageResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected listCommits success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectListFailed(
  result: VersionGraphCommitPageResult,
): asserts result is Extract<VersionGraphCommitPageResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected listCommits failure');
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

export async function persistRootCommitForReadDiagnostics(
  backend: VersionObjectMemoryBackend,
  objectStore: InMemoryVersionObjectStore,
  label: string,
): Promise<{
  readonly commitId: WorkbookCommitId;
  readonly semanticChangeSet: VersionObjectRecord<unknown>;
}> {
  const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', { label, sheets: [] });
  const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
    label,
    changes: [],
  });
  const payload = {
    schemaVersion: 1,
    documentId: NAMESPACE.documentId,
    parentCommitIds: [],
    snapshotRootDigest: snapshotRoot.digest,
    semanticChangeSetDigest: semanticChangeSet.digest,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
  const commitRecord = await createVersionObjectRecord(NAMESPACE, {
    objectType: 'workbook.commit.v1',
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [
      {
        kind: 'object',
        objectType: 'workbook.semanticChangeSet.v1',
        digest: semanticChangeSet.digest,
      },
      {
        kind: 'object',
        objectType: 'workbook.snapshotRoot.v1',
        digest: snapshotRoot.digest,
      },
    ],
    payload,
  });
  expect(await objectStore.putObjects([snapshotRoot])).toMatchObject({ status: 'success' });
  backend.putCorruptRecordForTesting(NAMESPACE, commitRecord.digest, commitRecord);
  return {
    commitId: workbookCommitIdFromObjectDigest(commitRecord.digest),
    semanticChangeSet,
  };
}

export function commitInput(
  input: InitializeVersionGraphInput,
  expectedHeadCommitId: WorkbookCommitId,
  expectedMainRefVersion: RefVersion,
  parentCommitIds?: readonly WorkbookCommitId[],
): CommitVersionGraphInput {
  return {
    ...input,
    expectedHeadCommitId,
    expectedMainRefVersion,
    ...(parentCommitIds === undefined ? {} : { parentCommitIds }),
  };
}
