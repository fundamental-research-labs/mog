import type { WorkbookCommitId } from '../object-digest';
import type { VersionGraphStore } from '../provider';
import type { RefVersion } from '../refs/ref-store';

export async function expectReadHeadSuccess(graph: VersionGraphStore): Promise<{
  readonly commitId: WorkbookCommitId;
  readonly revision: RefVersion;
}> {
  const result = await graph.readHead();
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readHead success: ${result.diagnostics[0]?.code}`);
  }
  return { commitId: result.main.commitId, revision: result.main.revision };
}

export async function expectGraphHead(
  graph: VersionGraphStore,
  expected: { readonly commitId: WorkbookCommitId; readonly revision: RefVersion },
): Promise<void> {
  const result = await expectReadHeadSuccess(graph);
  expect(result).toEqual(expected);
}

export function expectSingleCommit(commitIds: readonly WorkbookCommitId[]): WorkbookCommitId {
  expect(commitIds).toHaveLength(1);
  const commitId = commitIds[0];
  if (commitId === undefined) throw new Error('expected single commit id');
  return commitId;
}
