import type { InMemoryWorkbookCommitStore } from '../commit-store';
import type { VersionGraphStoreOperation } from './graph-store-operation';
import {
  collectReachableGraphCommits,
  readCommitFromGraphRef,
  readGraphBranchRef,
  readGraphMainRef,
} from './graph-store-read-helpers';
import type { WorkbookCommitId } from '../object-digest';
import type { RefName } from '../refs/ref-name';
import type { InMemoryRefStore, LiveRefRecord } from '../refs/ref-store';

export type GraphStoreRefHelpers = {
  readCommitFromRef(
    ref: LiveRefRecord,
    operation: VersionGraphStoreOperation,
  ): ReturnType<typeof readCommitFromGraphRef>;
  collectReachableCommits(
    rootCommitId: WorkbookCommitId,
    operation: VersionGraphStoreOperation,
  ): ReturnType<typeof collectReachableGraphCommits>;
  readMainRef(operation?: VersionGraphStoreOperation): ReturnType<typeof readGraphMainRef>;
  readBranchRef(
    refName: RefName,
    operation?: VersionGraphStoreOperation,
  ): ReturnType<typeof readGraphBranchRef>;
};

export function createGraphStoreRefHelpers(options: {
  readonly commitStore: InMemoryWorkbookCommitStore;
  readonly refStore: InMemoryRefStore;
}): GraphStoreRefHelpers {
  return {
    readCommitFromRef: (ref, operation) =>
      readCommitFromGraphRef(options.commitStore, ref, operation),
    collectReachableCommits: (rootCommitId, operation) =>
      collectReachableGraphCommits(options.commitStore, rootCommitId, operation),
    readMainRef: (operation) => readGraphMainRef(options.refStore, operation),
    readBranchRef: (refName, operation) => readGraphBranchRef(options.refStore, refName, operation),
  };
}
