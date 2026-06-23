import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  type VersionDependencyRef,
  type VersionObjectType,
  type WorkbookCommitId,
} from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { RefVersion } from '../ref-store';
import {
  createInMemoryVersionGraphStore,
  type CommitVersionGraphInput,
  type InitializeVersionGraphInput,
  type VersionGraphWriteResult,
} from '../graph-store';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-object-batch',
  documentId: 'document-object-batch',
  graphId: 'graph-object-batch',
  principalScope: 'principal-object-batch',
};

const OTHER_NAMESPACE: VersionGraphNamespace = {
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

function expectGraphSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

function expectGraphFailed(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected graph write failure');
  }
}

async function objectRecord(
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

async function graphInput(
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

function commitInput(
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

describe('InMemoryVersionGraphStore object batch atomicity', () => {
  it('redacts wrong-namespace object preflight diagnostics before object writes', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const refsBefore = graph.refStore.exportSnapshot();
    const objectsBefore = graph.objectStore.listObjectRecords();

    const result = await graph.commit(
      commitInput(
        await graphInput('wrong-namespace', OTHER_NAMESPACE),
        initialized.commit.id,
        initialized.main.revision,
      ),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_WRONG_NAMESPACE',
      details: { path: 'snapshotRootRecord', namespace: 'redacted' },
    });
    expect(result.diagnostics[0]).not.toHaveProperty('namespace');

    const diagnosticText = JSON.stringify(result.diagnostics);
    for (const leakedValue of Object.values(OTHER_NAMESPACE)) {
      expect(diagnosticText).not.toContain(leakedValue);
    }
    expect(graph.refStore.exportSnapshot()).toEqual(refsBefore);
    expect(graph.objectStore.listObjectRecords()).toEqual(objectsBefore);
  });

  it('rejects dependency validation failures without partial object writes or ref mutation', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const refsBefore = graph.refStore.exportSnapshot();
    const objectsBefore = graph.objectStore.listObjectRecords();
    const missingSnapshotDependency = await objectRecord('workbook.snapshotRoot.v1', {
      label: 'missing-snapshot-dependency',
      sheets: [],
    });
    const input = await graphInput('dependency-gap', NAMESPACE, [
      {
        kind: 'object',
        objectType: 'workbook.snapshotRoot.v1',
        digest: missingSnapshotDependency.digest,
      },
    ]);

    const result = await graph.commit(
      commitInput(input, initialized.commit.id, initialized.main.revision),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('ref-not-mutated');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_OBJECT_STORE_FAILURE',
      sourceDiagnostics: [
        expect.objectContaining({
          code: 'VERSION_OBJECT_STORE_FAILURE',
          sourceDiagnostics: [
            expect.objectContaining({
              code: 'VERSION_MISSING_DEPENDENCY',
              objectType: 'workbook.snapshotRoot.v1',
              details: {
                dependencyKind: 'object',
                dependencyObjectType: 'workbook.snapshotRoot.v1',
              },
            }),
          ],
        }),
      ],
    });
    expect(graph.refStore.exportSnapshot()).toEqual(refsBefore);
    expect(graph.objectStore.listObjectRecords()).toEqual(objectsBefore);
  });
});
