import { expectCreateFailed } from './commit-store-test-helpers';
import {
  createMergeParentsHarness,
  createSuccessfulCommit,
  workbookCommitInput,
} from './commit-store-merge-parents-helpers';

export function registerMergeParentValidationScenarios(): void {
  it('rejects duplicate and more-than-two parent commit payloads', async () => {
    const harness = createMergeParentsHarness();
    const { commitStore } = harness;
    const parent = await createSuccessfulCommit(harness, 'parent');
    const mergeInput = await workbookCommitInput('merge');

    const duplicate = await commitStore.createWorkbookCommit({
      ...mergeInput,
      parentCommitIds: [parent.id, parent.id],
    });
    expectCreateFailed(duplicate);
    expect(duplicate.diagnostics[0]).toMatchObject({
      code: 'VERSION_UNSUPPORTED_PARENT_COMMIT',
    });

    const tooMany = await commitStore.createWorkbookCommit({
      ...mergeInput,
      parentCommitIds: [parent.id, parent.id, parent.id],
    });
    expectCreateFailed(tooMany);
    expect(tooMany.diagnostics[0]).toMatchObject({
      code: 'VERSION_UNSUPPORTED_PARENT_COMMIT',
    });
  });
}
