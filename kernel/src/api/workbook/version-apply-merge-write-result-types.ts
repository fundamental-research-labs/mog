import type {
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeChange,
  VersionMergeResultId,
  VersionRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

export type VersionApplyMergeWritePlan = {
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly changes: readonly VersionMergeChange[];
  readonly resolutionCount: number;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
  readonly resultId?: VersionMergeResultId;
  readonly previewArtifactDigest?: ObjectDigest;
  readonly resultDigest?: ObjectDigest;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly resolvedAttemptDigest?: ObjectDigest;
};
