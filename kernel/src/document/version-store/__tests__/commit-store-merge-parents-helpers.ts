import {
  createInMemoryWorkbookCommitStore,
  type CreateWorkbookCommitInput,
  type InMemoryWorkbookCommitStore,
  type WorkbookCommit,
} from '../commit-store';
import { InMemoryVersionObjectStore, type VersionObjectRecord } from '../object-store';
import {
  NAMESPACE,
  baseInput,
  expectCreateSuccess,
  objectRecord,
} from './commit-store-test-helpers';

export type MergeParentsHarness = {
  readonly objectStore: InMemoryVersionObjectStore;
  readonly commitStore: InMemoryWorkbookCommitStore;
};

export type MergeParentPair = {
  readonly parentA: WorkbookCommit;
  readonly parentB: WorkbookCommit;
};

export function createMergeParentsHarness(): MergeParentsHarness {
  const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
  const commitStore = createInMemoryWorkbookCommitStore(objectStore);
  return { objectStore, commitStore };
}

export async function workbookCommitInput(label: string): Promise<CreateWorkbookCommitInput> {
  return baseInput(
    await objectRecord('workbook.snapshotRoot.v1', { label }),
    await objectRecord('workbook.semanticChangeSet.v1', { label }),
  );
}

export async function createSuccessfulCommit(
  harness: MergeParentsHarness,
  label: string,
): Promise<WorkbookCommit> {
  const result = await harness.commitStore.createWorkbookCommit(await workbookCommitInput(label));
  expectCreateSuccess(result);
  return result.commit;
}

export async function createMergeParentPair(
  harness: MergeParentsHarness,
): Promise<MergeParentPair> {
  const parentA = await createSuccessfulCommit(harness, 'parent-a');
  const parentB = await createSuccessfulCommit(harness, 'parent-b');
  return { parentA, parentB };
}

export async function resolvedMergeAttemptRecord(): Promise<VersionObjectRecord<unknown>> {
  return objectRecord('workbook.resolvedMergeAttempt.v1', {
    recordKind: 'resolvedMergeAttempt',
  });
}

export async function putResolvedMergeAttemptRecord(
  harness: MergeParentsHarness,
): Promise<VersionObjectRecord<unknown>> {
  const record = await resolvedMergeAttemptRecord();
  expect(await harness.objectStore.putObjects([record])).toMatchObject({ status: 'success' });
  return record;
}
