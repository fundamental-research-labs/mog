import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { workbookCommitIdFromObjectDigest } from '../object-digest';
import {
  InMemoryVersionObjectStore,
  VersionObjectMemoryBackend,
  createVersionObjectRecord,
  type VersionObjectPutBatchResult,
  type VersionObjectRecord,
} from '../object-store';
import {
  createInMemoryWorkbookCommitStore,
  type WorkbookCommitPayload,
} from '../commit-store';
import {
  AUTHOR,
  NAMESPACE,
  OTHER_AUTHOR,
  baseInput,
  expectCreateFailed,
  expectCreateSuccess,
  expectReadFailed,
  expectReadSuccess,
  objectRecord,
} from './commit-store-test-helpers';

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
