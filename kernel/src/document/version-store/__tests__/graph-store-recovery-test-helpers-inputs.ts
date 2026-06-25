import type { CommitVersionGraphInput, InitializeVersionGraphInput } from '../graph';
import type { WorkbookCommitId } from '../object-digest';
import type { RefVersion } from '../refs/ref-store';
import { AUTHOR, objectRecord } from './graph-store-recovery-test-helpers-fixtures';

export async function graphInput(label: string): Promise<InitializeVersionGraphInput> {
  const snapshotRootRecord = await objectRecord('workbook.snapshotRoot.v1', {
    label,
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord('workbook.semanticChangeSet.v1', {
    label,
    changes: [],
  });

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
): CommitVersionGraphInput {
  return {
    ...input,
    expectedHeadCommitId,
    expectedMainRefVersion,
  };
}
