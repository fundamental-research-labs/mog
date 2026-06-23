import './provider-indexeddb-graph-writes-test-utils';

import { registerIndexedDbGraphCommitScenarios } from './provider-indexeddb-graph-writes-commit-scenarios';
import { registerIndexedDbGraphMergeScenarios } from './provider-indexeddb-graph-writes-merge-scenarios';
import { registerIndexedDbGraphObjectScenarios } from './provider-indexeddb-graph-writes-object-scenarios';

describe('IndexedDbVersionStoreProvider graph writes', () => {
  registerIndexedDbGraphCommitScenarios();
  registerIndexedDbGraphMergeScenarios();
  registerIndexedDbGraphObjectScenarios();
});
