import type { VersionDependencyRef, WorkbookCommitId } from '../object-digest';
import type { CommitVersionGraphInput, InitializeVersionGraphInput } from '../graph';
import type { VersionGraphNamespace } from '../object-store';
import type { RefVersion } from '../refs/ref-store';
import { AUTHOR, NAMESPACE } from './graph-store-test-utils-constants';
import { objectRecord } from './graph-store-test-utils-object-records';

export async function graphInput(
  label: string,
  namespace: VersionGraphNamespace = NAMESPACE,
  snapshotDependencies: readonly VersionDependencyRef[] = [],
): Promise<InitializeVersionGraphInput> {
  const snapshotRootRecord = await objectRecord(
    'workbook.snapshotRoot.v1',
    { label, sheets: [] },
    namespace,
    snapshotDependencies,
  );
  const semanticChangeSetRecord = await objectRecord(
    'workbook.semanticChangeSet.v1',
    { label, changes: [] },
    namespace,
  );

  return {
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

export function commitInput(
  input: InitializeVersionGraphInput,
  expectedHeadCommitId: WorkbookCommitId,
  expectedMainRefVersion: RefVersion,
  parentCommitIds?: readonly WorkbookCommitId[],
): CommitVersionGraphInput {
  return {
    ...input,
    expectedHeadCommitId,
    expectedMainRefVersion,
    ...(parentCommitIds === undefined ? {} : { parentCommitIds }),
  };
}
