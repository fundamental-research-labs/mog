import type {
  ObjectDigest,
  VersionMergeResult,
  VersionMergeResultId,
  Workbook,
} from '@mog-sdk/contracts/api';

export type PersistedConflictPreview = VersionMergeResult & {
  readonly status: 'conflicted';
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
};

export type ConflictDetailSuccess = Extract<
  Awaited<ReturnType<Workbook['version']['getMergeConflictDetail']>>,
  { ok: true }
>;
