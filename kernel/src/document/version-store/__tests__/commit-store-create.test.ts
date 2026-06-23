import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  InMemoryVersionObjectStore,
  type VersionObjectPutBatchResult,
  type VersionObjectRecord,
} from '../object-store';
import { createInMemoryWorkbookCommitStore } from '../commit-store';
import {
  AUTHOR,
  NAMESPACE,
  baseInput,
  expectCreateFailed,
  expectCreateSuccess,
  objectRecord,
} from './commit-store-test-helpers';
import { rootCommitObjects } from './commit-store-fixtures';

describe('InMemoryWorkbookCommitStore create validation', () => {
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
    const { snapshotRoot, semanticChangeSet } = await rootCommitObjects();

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
    const { snapshotRoot, semanticChangeSet } = await rootCommitObjects();
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
});
