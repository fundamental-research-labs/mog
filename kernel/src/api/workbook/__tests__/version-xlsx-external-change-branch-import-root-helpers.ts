import { expect } from '@jest/globals';

import type { WorkbookCommit } from '../../../document/version-store/commit-store';
import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph';
import type { WorkbookCommitId } from '../../../document/version-store/object-digest';
import type { XlsxVersionExistingGraphImportResult } from '../../../document/version-store/xlsx-import-root';
import {
  findOnlyImportNewRootBranch,
  type XlsxExternalChangeBranchGraph,
} from './version-xlsx-external-change-branch-test-utils';

type CommittedImportResult = Extract<
  XlsxVersionExistingGraphImportResult,
  { readonly status: 'committed' }
>;

export function expectCommittedImportRootResult(
  result: XlsxVersionExistingGraphImportResult,
  expectedDescription: string,
): asserts result is CommittedImportResult {
  expect(result).toMatchObject({ status: 'committed' });
  if (result.status !== 'committed') {
    throw new Error(`expected ${expectedDescription}, got ${result.status}`);
  }
}

export async function expectMainHeadPreserved(input: {
  readonly graph: XlsxExternalChangeBranchGraph;
  readonly localCommitId: WorkbookCommitId;
}): Promise<void> {
  const headAfter = await input.graph.readHead();
  expect(headAfter).toMatchObject({
    status: 'success',
    head: { id: input.localCommitId, refName: VERSION_GRAPH_MAIN_REF },
  });
}

export async function expectOnlyImportNewRootBranchTargets(input: {
  readonly graph: XlsxExternalChangeBranchGraph;
  readonly commitId: WorkbookCommitId;
}) {
  const branch = await findOnlyImportNewRootBranch(input.graph);
  expect(branch.ref.targetCommitId).toBe(input.commitId);
  return branch;
}

export async function readImportRootCommitAndSemanticPayload(input: {
  readonly graph: XlsxExternalChangeBranchGraph;
  readonly commitId: WorkbookCommitId;
  readonly readableDescription: string;
}): Promise<{
  readonly rootCommit: WorkbookCommit;
  readonly semanticPayload: Record<string, unknown>;
}> {
  const rootCommit = await input.graph.readCommit(input.commitId);
  expect(rootCommit.status).toBe('success');
  if (rootCommit.status !== 'success') {
    throw new Error(
      `expected ${input.readableDescription} readable: ${rootCommit.diagnostics[0]?.code}`,
    );
  }

  const semanticRecord = await input.graph.getObjectRecord({
    kind: 'object',
    objectType: 'workbook.semanticChangeSet.v1',
    digest: rootCommit.commit.payload.semanticChangeSetDigest,
  });
  return {
    rootCommit: rootCommit.commit,
    semanticPayload: semanticRecord.preimage.payload as Record<string, unknown>,
  };
}
