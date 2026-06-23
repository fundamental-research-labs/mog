import { workbookCommitIdFromObjectDigest } from '../object-digest';
import { InMemoryVersionObjectStore } from '../object-store';
import { createInMemoryWorkbookCommitStore, type WorkbookCommitPayload } from '../commit-store';
import {
  AUTHOR,
  NAMESPACE,
  OTHER_AUTHOR,
  baseInput,
  expectCreateSuccess,
  expectReadSuccess,
} from './commit-store-test-helpers';
import { rootCommitObjects } from './commit-store-fixtures';

describe('InMemoryWorkbookCommitStore root commits', () => {
  it('creates and reads a root commit with stable id and snapshot/change-set dependencies', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const { snapshotRoot, semanticChangeSet } = await rootCommitObjects();

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

  it('changes the commit digest when authored payload changes', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const commitStore = createInMemoryWorkbookCommitStore(objectStore);
    const { snapshotRoot, semanticChangeSet } = await rootCommitObjects();

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
