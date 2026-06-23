import { createInMemoryWorkbookCommitStore } from '../commit-store';
import { InMemoryVersionObjectStore } from '../object-store';
import {
  NAMESPACE,
  baseInput,
  expectCreateFailed,
  expectCreateSuccess,
  expectReadSuccess,
  objectRecord,
} from './commit-store-test-helpers';

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
