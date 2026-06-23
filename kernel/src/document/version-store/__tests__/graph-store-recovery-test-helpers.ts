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
  type VersionObjectMemoryBackend,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { InMemoryRefStore, RefVersion } from '../ref-store';
import {
  type CommitVersionGraphInput,
  type InitializeVersionGraphInput,
  type VersionGraphClosureReadResult,
  type VersionGraphReadHeadResult,
  type VersionGraphStoreDiagnostic,
  type VersionGraphWriteResult,
} from '../graph-store';
import { mapGraphDiagnostics } from '../provider-indexeddb-internal';

export const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-secret-recovery',
  documentId: 'document-secret-recovery',
  graphId: 'graph-secret-recovery',
  principalScope: 'principal-secret-recovery',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
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

export async function graphInput(label: string): Promise<InitializeVersionGraphInput> {
  const snapshotRootRecord = await objectRecord('workbook.snapshotRoot.v1', {
    label,
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord('workbook.semanticChangeSet.v1', {
    label,
    changes: [],
  });

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

export async function persistRootCommitWithSemanticDependencyGap(
  backend: VersionObjectMemoryBackend,
  objectStore: InMemoryVersionObjectStore,
  mode: 'missing' | 'corrupt',
): Promise<{
  readonly commitId: WorkbookCommitId;
  readonly semanticDependency: VersionDependencyRef;
}> {
  const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', {
    label: `${mode}-snapshot`,
    sheets: [],
  });
  const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
    label: `${mode}-semantic`,
    changes: [],
  });
  const semanticDependency: VersionDependencyRef = {
    kind: 'object',
    objectType: 'workbook.semanticChangeSet.v1',
    digest: semanticChangeSet.digest,
  };
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
      semanticDependency,
      {
        kind: 'object',
        objectType: 'workbook.snapshotRoot.v1',
        digest: snapshotRoot.digest,
      },
    ],
    payload,
  });

  expect(await objectStore.putObjects([snapshotRoot])).toMatchObject({ status: 'success' });
  if (mode === 'corrupt') {
    const corruptSemantic = await objectRecord('workbook.semanticChangeSet.v1', {
      label: 'corrupt-semantic',
      changes: ['digest-mismatch'],
    });
    backend.putCorruptRecordForTesting(NAMESPACE, semanticChangeSet.digest, {
      ...corruptSemantic,
      digest: semanticChangeSet.digest,
    });
  }
  backend.putCorruptRecordForTesting(NAMESPACE, commitRecord.digest, commitRecord);

  return {
    commitId: workbookCommitIdFromObjectDigest(commitRecord.digest),
    semanticDependency,
  };
}

export function initializeMainAt(refStore: InMemoryRefStore, commitId: WorkbookCommitId): void {
  expect(refStore.initializeMain({ targetCommitId: commitId, createdBy: AUTHOR })).toMatchObject({
    ok: true,
  });
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

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  dependencies: readonly VersionDependencyRef[] = [],
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(NAMESPACE, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
}
