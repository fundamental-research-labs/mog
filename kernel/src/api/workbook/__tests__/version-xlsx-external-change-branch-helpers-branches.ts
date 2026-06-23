import { expect } from '@jest/globals';

import type { XlsxExternalChangeBranchGraph } from './version-xlsx-external-change-branch-helpers-graph-fixtures';

export async function findOnlyImportExternalChangeBranch(graph: XlsxExternalChangeBranchGraph) {
  return findOnlyImportBranch(graph, /^import\/external-change\//);
}

export async function findOnlyImportNewRootBranch(graph: XlsxExternalChangeBranchGraph) {
  return findOnlyImportBranch(graph, /^import\/new-root\//);
}

async function findOnlyImportBranch(
  graph: XlsxExternalChangeBranchGraph,
  branchNamePattern: RegExp,
) {
  const branches = await graph.listBranches({ prefix: 'import' });
  expect(branches.ok).toBe(true);
  if (!branches.ok) throw new Error(`expected branch list success: ${branches.error.code}`);
  const matchingBranches = branches.branches.filter((branch) =>
    branchNamePattern.test(branch.name),
  );
  expect(matchingBranches).toHaveLength(1);
  const branch = matchingBranches[0];
  if (!branch) throw new Error('expected import branch');
  expect(branch.name).toMatch(branchNamePattern);
  return branch;
}
