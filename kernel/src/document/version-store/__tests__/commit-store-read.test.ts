import { workbookCommitIdFromObjectDigest } from '../object-digest';
import { InMemoryVersionObjectStore, VersionObjectMemoryBackend } from '../object-store';
import { createInMemoryWorkbookCommitStore } from '../commit-store';
import { NAMESPACE, expectReadFailed, objectRecord } from './commit-store-test-helpers';
import { rootCommitObjects, rootCommitPayload, rootCommitRecord } from './commit-store-fixtures';

describe('InMemoryWorkbookCommitStore read validation', () => {
  it('validates commit id grammar and payload document id on read', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const { snapshotRoot, semanticChangeSet } = await rootCommitObjects();
    const wrongDocumentRecord = await rootCommitRecord(
      snapshotRoot,
      semanticChangeSet,
      rootCommitPayload(snapshotRoot, semanticChangeSet, {
        documentId: 'document-2',
      }),
    );

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
    const { snapshotRoot, semanticChangeSet } = await rootCommitObjects();
    const record = await rootCommitRecord(snapshotRoot, semanticChangeSet);
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
    const { snapshotRoot, semanticChangeSet } = await rootCommitObjects();
    const corruptSemanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
      changes: ['corrupt'],
    });
    const record = await rootCommitRecord(snapshotRoot, semanticChangeSet);
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
    const { snapshotRoot, semanticChangeSet } = await rootCommitObjects();
    const validPayload = rootCommitPayload(snapshotRoot, semanticChangeSet);
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
      const record = await rootCommitRecord(snapshotRoot, semanticChangeSet, payload);

      const putResult = await objectStore.putObjects([snapshotRoot, semanticChangeSet, record]);
      expect(putResult.status).toBe('success');

      const read = await commitStore.readCommit(workbookCommitIdFromObjectDigest(record.digest));
      expectReadFailed(read);
      expect(read.diagnostics[0]).toMatchObject({ code: 'VERSION_INVALID_COMMIT_PAYLOAD' });
    }
  });
});
