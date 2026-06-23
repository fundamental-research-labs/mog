import { expectCreateSuccess, expectReadSuccess } from './commit-store-test-helpers';
import {
  createMergeParentPair,
  createMergeParentsHarness,
  workbookCommitInput,
} from './commit-store-merge-parents-helpers';

export function registerMergeParentDependencyScenarios(): void {
  it('creates and reads a two-parent commit with parent dependency edges', async () => {
    const harness = createMergeParentsHarness();
    const { commitStore } = harness;
    const { parentA, parentB } = await createMergeParentPair(harness);

    const merge = await commitStore.createWorkbookCommit({
      ...(await workbookCommitInput('merge')),
      parentCommitIds: [parentA.id, parentB.id],
    });
    expectCreateSuccess(merge);

    expect(merge.commit.payload.parentCommitIds).toEqual([parentA.id, parentB.id]);
    const parentDependencies = merge.commit.record.preimage.dependencies.filter(
      (dependency) => dependency.kind === 'commit',
    );
    expect(parentDependencies).toHaveLength(2);
    expect(parentDependencies).toEqual(
      expect.arrayContaining([
        {
          kind: 'commit',
          commitId: parentA.id,
          digest: parentA.record.digest,
        },
        {
          kind: 'commit',
          commitId: parentB.id,
          digest: parentB.record.digest,
        },
      ]),
    );

    const read = await commitStore.readCommit(merge.commit.id);
    expectReadSuccess(read);
    expect(read.commit).toEqual(merge.commit);
  });
}
