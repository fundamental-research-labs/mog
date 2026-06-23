import {
  expectCreateFailed,
  expectCreateSuccess,
  expectReadSuccess,
} from './commit-store-test-helpers';
import {
  createMergeParentPair,
  createMergeParentsHarness,
  createSuccessfulCommit,
  putResolvedMergeAttemptRecord,
  resolvedMergeAttemptRecord,
  workbookCommitInput,
} from './commit-store-merge-parents-helpers';

export function registerMergeParentResolvedAttemptScenarios(): void {
  it('binds merge commits to resolved merge-attempt artifact dependencies', async () => {
    const harness = createMergeParentsHarness();
    const { commitStore } = harness;
    const { parentA, parentB } = await createMergeParentPair(harness);
    const resolvedAttempt = await putResolvedMergeAttemptRecord(harness);

    const merge = await commitStore.createWorkbookCommit({
      ...(await workbookCommitInput('merge')),
      parentCommitIds: [parentA.id, parentB.id],
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
    const harness = createMergeParentsHarness();
    const { commitStore } = harness;
    const resolvedAttempt = await putResolvedMergeAttemptRecord(harness);

    const root = await commitStore.createWorkbookCommit({
      ...(await workbookCommitInput('root')),
      resolvedMergeAttemptDigest: resolvedAttempt.digest,
    });
    expectCreateFailed(root);
    expect(root.diagnostics[0]).toMatchObject({
      code: 'VERSION_INVALID_COMMIT_PAYLOAD',
      details: { path: 'resolvedMergeAttemptDigest' },
    });

    const parent = await createSuccessfulCommit(harness, 'parent');
    const child = await commitStore.createWorkbookCommit({
      ...(await workbookCommitInput('child')),
      parentCommitIds: [parent.id],
      resolvedMergeAttemptDigest: resolvedAttempt.digest,
    });
    expectCreateFailed(child);
    expect(child.diagnostics[0]).toMatchObject({
      code: 'VERSION_INVALID_COMMIT_PAYLOAD',
      details: { path: 'resolvedMergeAttemptDigest' },
    });
  });

  it('rejects merge commits bound to missing resolved-attempt artifacts', async () => {
    const harness = createMergeParentsHarness();
    const { commitStore } = harness;
    const { parentA, parentB } = await createMergeParentPair(harness);
    const missingResolvedAttempt = await resolvedMergeAttemptRecord();

    const merge = await commitStore.createWorkbookCommit({
      ...(await workbookCommitInput('merge')),
      parentCommitIds: [parentA.id, parentB.id],
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
}
