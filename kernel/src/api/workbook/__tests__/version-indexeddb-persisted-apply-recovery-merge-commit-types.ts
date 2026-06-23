import type {
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMergeResult,
} from '@mog-sdk/contracts/api';

import type { ObjectDigest as StoreObjectDigest } from '../../../document/version-store/object-digest';
import type { VersionGraphNamespace } from '../../../document/version-store/object-store';

export type PersistedConflictedMergePreview = Extract<
  VersionMergeResult,
  { readonly status: 'conflicted' }
> &
  Required<Pick<VersionMergeResult, 'previewArtifactDigest' | 'resultDigest' | 'resultId'>>;

export type MergeCommitRecoveryStage = {
  readonly namespace: VersionGraphNamespace;
  readonly preview: PersistedConflictedMergePreview;
  readonly resolution: VersionApplyMergeResolution;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly oursCommitId: string;
  readonly theirsCommitId: string;
  readonly mergeCommitId: string;
  readonly resolvedAttemptDigest: StoreObjectDigest;
};
