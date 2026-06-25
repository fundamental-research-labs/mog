import { registerIndexedDbPersistedApplyCleanMergeArtifactReopenReplayScenario } from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-roundtrip-scenario';

export {
  applyPersistedCleanMergeArtifactAfterReopen,
  type IndexedDbCleanMergeReplayAppliedArtifact,
} from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-apply';
export {
  INDEXEDDB_CLEAN_MERGE_REPLAY_BRANCH,
  INDEXEDDB_CLEAN_MERGE_REPLAY_TARGET_REF,
  createPersistedCleanMergeReplayArtifact,
  type IndexedDbCleanMergeReplayArtifact,
} from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-preview-artifact';
export { registerIndexedDbPersistedApplyCleanMergeArtifactReopenReplayScenario } from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-roundtrip-scenario';
export {
  replayFinalizedPersistedCleanMergeIntent,
  verifyPersistedCleanMergeCheckout,
} from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-replay';
export {
  createIndexedDbCleanMergeReplayHandle,
  openIndexedDbCleanMergeReplayWorkbook,
  openInitializedIndexedDbCleanMergeReplayWorkbook,
  type IndexedDbCleanMergeReplayHandle,
  type IndexedDbCleanMergeReplayWorkbook,
} from './version-indexeddb-persisted-apply-clean-merge-artifact-reopen-replay-workbooks';

export function describeIndexedDbPersistedApplyCleanMergeArtifactReopenReplayScenario(): void {
  registerIndexedDbPersistedApplyCleanMergeArtifactReopenReplayScenario();
}
