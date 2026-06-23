import { registerIndexedDbGraphMergeCommitScenarios } from './provider-indexeddb-graph-writes-merge-commit-scenarios';
import { registerIndexedDbGraphMergeFastForwardScenarios } from './provider-indexeddb-graph-writes-merge-fast-forward-scenarios';

export function registerIndexedDbGraphMergeScenarios(): void {
  registerIndexedDbGraphMergeCommitScenarios();
  registerIndexedDbGraphMergeFastForwardScenarios();
}
