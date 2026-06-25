import type { VersionCommitExpectedHead, VersionMergeResult } from '@mog-sdk/contracts/api';

export type PersistedFastForwardMergePreview = Extract<
  VersionMergeResult,
  { readonly status: 'fastForward' }
> &
  Required<Pick<VersionMergeResult, 'resultDigest' | 'resultId'>>;

export type ProviderSelectionReopenFastForwardStage = {
  readonly preview: PersistedFastForwardMergePreview;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly oursCommitId: string;
  readonly theirsCommitId: string;
};
