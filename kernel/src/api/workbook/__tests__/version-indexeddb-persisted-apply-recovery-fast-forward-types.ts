import type { VersionCommitExpectedHead, VersionMergeResult } from '@mog-sdk/contracts/api';

import type { MergeApplyIntentId } from '../../../document/version-store/merge-apply-intent-store';
import type { VersionGraphNamespace } from '../../../document/version-store/object-store';

export type PersistedFastForwardMergePreview = Extract<
  VersionMergeResult,
  { readonly status: 'fastForward' }
> &
  Required<Pick<VersionMergeResult, 'resultDigest' | 'resultId'>>;

export type FastForwardRecoveryStage = {
  readonly namespace: VersionGraphNamespace;
  readonly preview: PersistedFastForwardMergePreview;
  readonly intentId: MergeApplyIntentId;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly oursCommitId: string;
  readonly theirsCommitId: string;
};
