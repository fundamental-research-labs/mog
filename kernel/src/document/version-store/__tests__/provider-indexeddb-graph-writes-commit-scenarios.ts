import { registerIndexedDbGraphCommitBranchScenarios } from './provider-indexeddb-graph-writes-commit-branch-scenarios';
import { registerIndexedDbGraphCommitMainRefScenarios } from './provider-indexeddb-graph-writes-commit-main-ref-scenarios';

export function registerIndexedDbGraphCommitScenarios(): void {
  registerIndexedDbGraphCommitMainRefScenarios();
  registerIndexedDbGraphCommitBranchScenarios();
}
