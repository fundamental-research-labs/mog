import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  workbookCommitIdFromObjectDigest,
  type VersionDependencyRef,
  type VersionObjectType,
} from '../object-digest';
import {
  InMemoryVersionObjectStore,
  VersionObjectMemoryBackend,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectPutBatchResult,
  type VersionObjectRecord,
} from '../object-store';
import {
  createInMemoryWorkbookCommitStore,
  type CreateWorkbookCommitInput,
  type CreateWorkbookCommitResult,
  type ReadWorkbookCommitResult,
  type WorkbookCommitPayload,
} from '../commit-store';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const OTHER_AUTHOR: VersionAuthor = {
  authorId: 'user-2',
  actorKind: 'user',
  displayName: 'User Two',
};

function expectCreateSuccess(
  result: CreateWorkbookCommitResult,
): asserts result is Extract<CreateWorkbookCommitResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected commit create success: ${result.diagnostics[0]?.code}`);
  }
}

function expectCreateFailed(
  result: CreateWorkbookCommitResult,
): asserts result is Extract<CreateWorkbookCommitResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected commit create failure');
  }
}

function expectReadSuccess(
  result: ReadWorkbookCommitResult,
): asserts result is Extract<ReadWorkbookCommitResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected commit read success: ${result.diagnostics[0]?.code}`);
  }
}

function expectReadFailed(
  result: ReadWorkbookCommitResult,
): asserts result is Extract<ReadWorkbookCommitResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected commit read failure');
  }
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

function baseInput(
  snapshotRootRecord: VersionObjectRecord<unknown>,
  semanticChangeSetRecord: VersionObjectRecord<unknown>,
): CreateWorkbookCommitInput {
  return {
    documentId: NAMESPACE.documentId,
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

function assertCreateInputRejectsMessage(
  snapshotRootRecord: VersionObjectRecord<unknown>,
  semanticChangeSetRecord: VersionObjectRecord<unknown>,
): CreateWorkbookCommitInput {
  return {
    documentId: NAMESPACE.documentId,
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
    // @ts-expect-error messages live in mutable commit annotations, not immutable payloads.
    message: 'annotation text',
  };
}

describe('InMemoryWorkbookCommitStore root commits', () => {
  it('creates and reads a root commit with stable id and snapshot/change-set dependencies', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', { sheets: [] });
    const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
      changes: [],
    });

    const created = await commitStore.createWorkbookCommit(
      baseInput(snapshotRoot, semanticChangeSet),
    );
    expectCreateSuccess(created);

    expect(created.commit.id).toBe(workbookCommitIdFromObjectDigest(created.commit.record.digest));
    expect(created.commit.payload).toMatchObject({
      schemaVersion: 1,
      documentId: NAMESPACE.documentId,
      parentCommitIds: [],
      snapshotRootDigest: snapshotRoot.digest,
      semanticChangeSetDigest: semanticChangeSet.digest,
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    } satisfies Partial<WorkbookCommitPayload>);
    expect(created.commit.payload).not.toHaveProperty('message');
    expect(created.commit.record.preimage.dependencies).toEqual([
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
    ]);

    const read = await commitStore.readCommit(created.commit.id);
    expectReadSuccess(read);
    expect(read.commit).toEqual(created.commit);

    const repeated = await commitStore.createWorkbookCommit(
      baseInput(snapshotRoot, semanticChangeSet),
    );
    expectCreateSuccess(repeated);
    expect(repeated.commit.id).toBe(created.commit.id);
  });

  it('rejects missing snapshot and change-set object records before writing', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);

    const result = await commitStore.createWorkbookCommit({
      ...baseInput(
        undefined as unknown as VersionObjectRecord<unknown>,
        undefined as unknown as VersionObjectRecord<unknown>,
      ),
    });

    expectCreateFailed(result);
    expect(result.mutationGuarantee).toBe('no-objects-written');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_MISSING_DEPENDENCY',
      'VERSION_MISSING_DEPENDENCY',
    ]);
  });

  it('rejects malformed authored metadata before writing commit objects', async () => {
    class CapturingObjectStore extends InMemoryVersionObjectStore {
      putCount = 0;

      override async putObjects(
        batch: readonly VersionObjectRecord<unknown>[],
      ): Promise<VersionObjectPutBatchResult> {
        this.putCount += 1;
        return super.putObjects(batch);
      }
    }

    const objectStore = new CapturingObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', { sheets: [] });
    const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
      changes: [],
    });

    const result = await commitStore.createWorkbookCommit({
      ...baseInput(snapshotRoot, semanticChangeSet),
      author: { ...AUTHOR, actorKind: 'bot' } as unknown as VersionAuthor,
      createdAt: 123 as unknown as string,
    });

    expectCreateFailed(result);
    expect(result.mutationGuarantee).toBe('no-objects-written');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_INVALID_COMMIT_PAYLOAD',
        details: { path: 'author.actorKind' },
      }),
      expect.objectContaining({
        code: 'VERSION_INVALID_COMMIT_PAYLOAD',
        details: { path: 'createdAt' },
      }),
    ]);
    expect(objectStore.putCount).toBe(0);
  });

  it('writes the dependency records and commit object in one object-store batch', async () => {
    class CapturingObjectStore extends InMemoryVersionObjectStore {
      readonly batches: readonly VersionObjectRecord<unknown>[][] = [];

      override async putObjects(
        batch: readonly VersionObjectRecord<unknown>[],
      ): Promise<VersionObjectPutBatchResult> {
        (this.batches as VersionObjectRecord<unknown>[][]).push([...batch]);
        return super.putObjects(batch);
      }
    }

    const objectStore = new CapturingObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', { sheets: [] });
    const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
      changes: [],
    });
    const mutationSegment = await objectRecord('workbook.mutationSegment.v1', {
      segmentId: 'segment-1',
    });

    const created = await commitStore.createWorkbookCommit({
      ...baseInput(snapshotRoot, semanticChangeSet),
      mutationSegmentRecords: [mutationSegment],
    });

    expectCreateSuccess(created);
    expect(objectStore.batches).toHaveLength(1);
    expect(objectStore.batches[0].map((record) => record.preimage.objectType)).toEqual([
      'workbook.snapshotRoot.v1',
      'workbook.semanticChangeSet.v1',
      'workbook.mutationSegment.v1',
      'workbook.commit.v1',
    ]);
    expect(created.objectBatch.map((record) => record.digest)).toEqual(
      objectStore.batches[0].map((record) => record.digest),
    );
  });

  it('returns object-store diagnostics when the dependency batch cannot be written', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const missingSnapshotChunk = await objectRecord('workbook.snapshotChunk.v1', {
      chunk: 'not-written',
    });
    const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', { sheets: [] }, [
      {
        kind: 'object',
        objectType: 'workbook.snapshotChunk.v1',
        digest: missingSnapshotChunk.digest,
      },
    ]);
    const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
      changes: [],
    });

    const result = await commitStore.createWorkbookCommit(
      baseInput(snapshotRoot, semanticChangeSet),
    );

    expectCreateFailed(result);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_OBJECT_STORE_FAILURE',
        sourceDiagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_DEPENDENCY',
          }),
        ],
      }),
    ]);
  });

  it('validates commit id grammar and payload document id on read', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', { sheets: [] });
    const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
      changes: [],
    });
    const wrongDocumentPayload: WorkbookCommitPayload = {
      schemaVersion: 1,
      documentId: 'document-2',
      parentCommitIds: [],
      snapshotRootDigest: snapshotRoot.digest,
      semanticChangeSetDigest: semanticChangeSet.digest,
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    };
    const wrongDocumentRecord = await createVersionObjectRecord(NAMESPACE, {
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
      payload: wrongDocumentPayload,
    });

    const putResult = await objectStore.putObjects([
      snapshotRoot,
      semanticChangeSet,
      wrongDocumentRecord,
    ]);
    expect(putResult.status).toBe('success');

    const invalidId = await commitStore.readCommit('not-a-commit-id');
    expectReadFailed(invalidId);
    expect(invalidId.diagnostics[0]).toMatchObject({ code: 'VERSION_INVALID_COMMIT_ID' });

    const wrongDocument = await commitStore.readCommit(
      workbookCommitIdFromObjectDigest(wrongDocumentRecord.digest),
    );
    expectReadFailed(wrongDocument);
    expect(wrongDocument.diagnostics[0]).toMatchObject({
      code: 'VERSION_WRONG_DOCUMENT',
      documentId: 'document-2',
      expectedDocumentId: NAMESPACE.documentId,
    });
  });

  it('returns structured diagnostics when a persisted dependency object is missing on read', async () => {
    const backend = new VersionObjectMemoryBackend();
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE, { backend });
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', { sheets: [] });
    const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
      changes: [],
    });
    const payload: WorkbookCommitPayload = {
      schemaVersion: 1,
      documentId: NAMESPACE.documentId,
      parentCommitIds: [],
      snapshotRootDigest: snapshotRoot.digest,
      semanticChangeSetDigest: semanticChangeSet.digest,
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    };
    const record = await createVersionObjectRecord(NAMESPACE, {
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
    backend.putCorruptRecordForTesting(NAMESPACE, record.digest, record);
    const commitId = workbookCommitIdFromObjectDigest(record.digest);

    const read = await commitStore.readCommit(commitId);

    expectReadFailed(read);
    expect(read.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_MISSING_DEPENDENCY',
        commitId,
        objectDigest: semanticChangeSet.digest,
        dependency: {
          kind: 'object',
          objectType: 'workbook.semanticChangeSet.v1',
          digest: semanticChangeSet.digest,
        },
        sourceDiagnostics: [
          expect.objectContaining({
            code: 'VERSION_OBJECT_NOT_FOUND',
            digest: semanticChangeSet.digest,
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(read.diagnostics)).not.toContain('"path"');
  });

  it('returns structured diagnostics when a dependency object digest is corrupted on read', async () => {
    const backend = new VersionObjectMemoryBackend();
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE, { backend });
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', { sheets: [] });
    const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
      changes: [],
    });
    const corruptSemanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
      changes: ['corrupt'],
    });
    const payload: WorkbookCommitPayload = {
      schemaVersion: 1,
      documentId: NAMESPACE.documentId,
      parentCommitIds: [],
      snapshotRootDigest: snapshotRoot.digest,
      semanticChangeSetDigest: semanticChangeSet.digest,
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    };
    const record = await createVersionObjectRecord(NAMESPACE, {
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
    backend.putCorruptRecordForTesting(NAMESPACE, semanticChangeSet.digest, {
      ...corruptSemanticChangeSet,
      digest: semanticChangeSet.digest,
    });
    backend.putCorruptRecordForTesting(NAMESPACE, record.digest, record);
    const commitId = workbookCommitIdFromObjectDigest(record.digest);

    const read = await commitStore.readCommit(commitId);

    expectReadFailed(read);
    expect(read.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_OBJECT_STORE_FAILURE',
        severity: 'corruption',
        commitId,
        objectDigest: semanticChangeSet.digest,
        dependency: {
          kind: 'object',
          objectType: 'workbook.semanticChangeSet.v1',
          digest: semanticChangeSet.digest,
        },
        sourceDiagnostics: [
          expect.objectContaining({
            code: 'VERSION_OBJECT_CORRUPTION',
            digest: semanticChangeSet.digest,
            details: expect.objectContaining({ cause: 'VERSION_DIGEST_MISMATCH' }),
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(read.diagnostics)).not.toContain('"path"');
  });

  it('rejects malformed persisted commit payload fields on read', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', { sheets: [] });
    const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
      changes: [],
    });
    const validPayload = {
      schemaVersion: 1,
      documentId: NAMESPACE.documentId,
      parentCommitIds: [],
      snapshotRootDigest: snapshotRoot.digest,
      semanticChangeSetDigest: semanticChangeSet.digest,
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    };
    const invalidPayloads = [
      ['author', { ...validPayload, author: 'user-1' }],
      ['createdAt', { ...validPayload, createdAt: 123 }],
      [
        'completenessDiagnostics',
        {
          ...validPayload,
          completenessDiagnostics: [{ code: 'incomplete', severity: 'fatal', message: 'bad' }],
        },
      ],
      ['message', { ...validPayload, message: 'must be an annotation' }],
    ] as const;

    for (const [_label, payload] of invalidPayloads) {
      const record = await createVersionObjectRecord(NAMESPACE, {
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

      const putResult = await objectStore.putObjects([snapshotRoot, semanticChangeSet, record]);
      expect(putResult.status).toBe('success');

      const read = await commitStore.readCommit(workbookCommitIdFromObjectDigest(record.digest));
      expectReadFailed(read);
      expect(read.diagnostics[0]).toMatchObject({ code: 'VERSION_INVALID_COMMIT_PAYLOAD' });
    }
  });

  it('changes the commit digest when authored payload changes', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', { sheets: [] });
    const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
      changes: [],
    });

    const first = await commitStore.createWorkbookCommit(
      baseInput(snapshotRoot, semanticChangeSet),
    );
    const second = await commitStore.createWorkbookCommit({
      ...baseInput(snapshotRoot, semanticChangeSet),
      author: OTHER_AUTHOR,
    });

    expectCreateSuccess(first);
    expectCreateSuccess(second);
    expect(second.commit.id).not.toBe(first.commit.id);
    expect(second.commit.record.digest.digest).not.toBe(first.commit.record.digest.digest);
  });
});

describe('InMemoryWorkbookCommitStore merge commit parents', () => {
  it('creates and reads a two-parent commit with parent dependency edges', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const parentA = await commitStore.createWorkbookCommit(
      baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'parent-a' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'parent-a' }),
      ),
    );
    const parentB = await commitStore.createWorkbookCommit(
      baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'parent-b' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'parent-b' }),
      ),
    );
    expectCreateSuccess(parentA);
    expectCreateSuccess(parentB);

    const merge = await commitStore.createWorkbookCommit({
      ...baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'merge' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'merge' }),
      ),
      parentCommitIds: [parentA.commit.id, parentB.commit.id],
    });
    expectCreateSuccess(merge);

    expect(merge.commit.payload.parentCommitIds).toEqual([parentA.commit.id, parentB.commit.id]);
    const parentDependencies = merge.commit.record.preimage.dependencies.filter(
      (dependency) => dependency.kind === 'commit',
    );
    expect(parentDependencies).toHaveLength(2);
    expect(parentDependencies).toEqual(
      expect.arrayContaining([
        {
          kind: 'commit',
          commitId: parentA.commit.id,
          digest: parentA.commit.record.digest,
        },
        {
          kind: 'commit',
          commitId: parentB.commit.id,
          digest: parentB.commit.record.digest,
        },
      ]),
    );

    const read = await commitStore.readCommit(merge.commit.id);
    expectReadSuccess(read);
    expect(read.commit).toEqual(merge.commit);
  });

  it('binds merge commits to resolved merge-attempt artifact dependencies', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const parentA = await commitStore.createWorkbookCommit(
      baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'parent-a' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'parent-a' }),
      ),
    );
    const parentB = await commitStore.createWorkbookCommit(
      baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'parent-b' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'parent-b' }),
      ),
    );
    expectCreateSuccess(parentA);
    expectCreateSuccess(parentB);
    const resolvedAttempt = await objectRecord('workbook.resolvedMergeAttempt.v1', {
      recordKind: 'resolvedMergeAttempt',
    });
    expect(await objectStore.putObjects([resolvedAttempt])).toMatchObject({ status: 'success' });

    const merge = await commitStore.createWorkbookCommit({
      ...baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'merge' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'merge' }),
      ),
      parentCommitIds: [parentA.commit.id, parentB.commit.id],
      resolvedMergeAttemptDigest: resolvedAttempt.digest,
    });
    expectCreateSuccess(merge);

    expect(merge.commit.payload.resolvedMergeAttemptDigest).toEqual(resolvedAttempt.digest);
    expect(merge.commit.record.preimage.dependencies).toEqual(
      expect.arrayContaining([
        {
          kind: 'object',
          objectType: 'workbook.resolvedMergeAttempt.v1',
          digest: resolvedAttempt.digest,
        },
      ]),
    );

    const read = await commitStore.readCommit(merge.commit.id);
    expectReadSuccess(read);
    expect(read.commit.payload.resolvedMergeAttemptDigest).toEqual(resolvedAttempt.digest);
  });

  it('rejects resolved merge-attempt identity on non-merge commits', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const resolvedAttempt = await objectRecord('workbook.resolvedMergeAttempt.v1', {
      recordKind: 'resolvedMergeAttempt',
    });
    expect(await objectStore.putObjects([resolvedAttempt])).toMatchObject({ status: 'success' });

    const root = await commitStore.createWorkbookCommit({
      ...baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'root' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'root' }),
      ),
      resolvedMergeAttemptDigest: resolvedAttempt.digest,
    });
    expectCreateFailed(root);
    expect(root.diagnostics[0]).toMatchObject({
      code: 'VERSION_INVALID_COMMIT_PAYLOAD',
      details: { path: 'resolvedMergeAttemptDigest' },
    });

    const parent = await commitStore.createWorkbookCommit(
      baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'parent' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'parent' }),
      ),
    );
    expectCreateSuccess(parent);
    const child = await commitStore.createWorkbookCommit({
      ...baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'child' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'child' }),
      ),
      parentCommitIds: [parent.commit.id],
      resolvedMergeAttemptDigest: resolvedAttempt.digest,
    });
    expectCreateFailed(child);
    expect(child.diagnostics[0]).toMatchObject({
      code: 'VERSION_INVALID_COMMIT_PAYLOAD',
      details: { path: 'resolvedMergeAttemptDigest' },
    });
  });

  it('rejects merge commits bound to missing resolved-attempt artifacts', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const parentA = await commitStore.createWorkbookCommit(
      baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'parent-a' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'parent-a' }),
      ),
    );
    const parentB = await commitStore.createWorkbookCommit(
      baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'parent-b' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'parent-b' }),
      ),
    );
    expectCreateSuccess(parentA);
    expectCreateSuccess(parentB);
    const missingResolvedAttempt = await objectRecord('workbook.resolvedMergeAttempt.v1', {
      recordKind: 'resolvedMergeAttempt',
    });

    const merge = await commitStore.createWorkbookCommit({
      ...baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'merge' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'merge' }),
      ),
      parentCommitIds: [parentA.commit.id, parentB.commit.id],
      resolvedMergeAttemptDigest: missingResolvedAttempt.digest,
    });
    expectCreateFailed(merge);
    expect(merge.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_OBJECT_STORE_FAILURE',
        sourceDiagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_DEPENDENCY',
          }),
        ],
      }),
    ]);
  });

  it('rejects duplicate and more-than-two parent commit payloads', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const parent = await commitStore.createWorkbookCommit(
      baseInput(
        await objectRecord('workbook.snapshotRoot.v1', { label: 'parent' }),
        await objectRecord('workbook.semanticChangeSet.v1', { label: 'parent' }),
      ),
    );
    expectCreateSuccess(parent);
    const mergeInput = baseInput(
      await objectRecord('workbook.snapshotRoot.v1', { label: 'merge' }),
      await objectRecord('workbook.semanticChangeSet.v1', { label: 'merge' }),
    );

    const duplicate = await commitStore.createWorkbookCommit({
      ...mergeInput,
      parentCommitIds: [parent.commit.id, parent.commit.id],
    });
    expectCreateFailed(duplicate);
    expect(duplicate.diagnostics[0]).toMatchObject({
      code: 'VERSION_UNSUPPORTED_PARENT_COMMIT',
    });

    const tooMany = await commitStore.createWorkbookCommit({
      ...mergeInput,
      parentCommitIds: [parent.commit.id, parent.commit.id, parent.commit.id],
    });
    expectCreateFailed(tooMany);
    expect(tooMany.diagnostics[0]).toMatchObject({
      code: 'VERSION_UNSUPPORTED_PARENT_COMMIT',
    });
  });
});
