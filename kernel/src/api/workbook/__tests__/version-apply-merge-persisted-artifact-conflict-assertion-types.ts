import type { VersionApplyMergeResult, VersionMergeResult } from '@mog-sdk/contracts/api';

type PersistedMergeMetadata = {
  readonly resultId: NonNullable<VersionMergeResult['resultId']>;
  readonly resultDigest: NonNullable<VersionMergeResult['resultDigest']>;
  readonly previewArtifactDigest: NonNullable<VersionMergeResult['previewArtifactDigest']>;
};

export type PersistedConflictedMergePreview = Extract<
  VersionMergeResult,
  { readonly status: 'conflicted' }
> &
  PersistedMergeMetadata;

export type ReplayedPersistedConflictPreview = Extract<
  VersionApplyMergeResult,
  { readonly status: 'conflicted' }
> &
  PersistedMergeMetadata;

export type AppliedPersistedConflictMerge = Extract<
  VersionApplyMergeResult,
  { readonly status: 'applied' }
> &
  PersistedMergeMetadata & {
    readonly resolutionSetDigest: NonNullable<VersionApplyMergeResult['resolutionSetDigest']>;
    readonly resolvedAttemptDigest: NonNullable<VersionApplyMergeResult['resolvedAttemptDigest']>;
  };
