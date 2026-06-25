import type {
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeResultId,
  VersionRefName,
  WorkbookCommitId as PublicWorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { compareMergeChanges, compareMergeConflicts } from './merge-preview-evidence';
import {
  type ObjectDigest,
  objectDigestFromWorkbookCommitId,
  parseWorkbookCommitId,
  type VersionDependencyRef,
  type VersionObjectType,
} from './object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from './object-store';

export const MERGE_PREVIEW_OBJECT_TYPE = 'workbook.mergePreview.v1' satisfies VersionObjectType;
export const MERGE_RESOLUTION_SET_V1_OBJECT_TYPE =
  'workbook.mergeResolutionSet.v1' satisfies VersionObjectType;
export const MERGE_RESOLUTION_SET_OBJECT_TYPE = MERGE_RESOLUTION_SET_V1_OBJECT_TYPE;
export const MERGE_RESOLUTION_SET_V2_OBJECT_TYPE =
  'workbook.mergeResolutionSet.v2' satisfies VersionObjectType;
export const RESOLVED_MERGE_ATTEMPT_OBJECT_TYPE =
  'workbook.resolvedMergeAttempt.v1' satisfies VersionObjectType;

export type MergePreviewArtifactStatus = 'clean' | 'conflicted' | 'fastForward' | 'alreadyMerged';

export type MergePreviewArtifactPayload = {
  readonly schemaVersion: 1;
  readonly recordKind: 'mergePreview';
  readonly status: MergePreviewArtifactStatus;
  readonly base: PublicWorkbookCommitId;
  readonly ours: PublicWorkbookCommitId;
  readonly theirs: PublicWorkbookCommitId;
  readonly changes: readonly VersionMergeChange[];
  readonly conflicts: readonly VersionMergeConflict[];
};

export type MergeResolutionSetArtifactPayloadV1 = {
  readonly schemaVersion: 1;
  readonly recordKind: 'mergeResolutionSet';
  readonly resolutions: readonly VersionApplyMergeResolution[];
};

export type MergeResolutionSetArtifactPayloadV2 = {
  readonly schemaVersion: 2;
  readonly recordKind: 'mergeResolutionSet';
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly previewArtifactDigest: ObjectDigest;
  readonly resolutions: readonly VersionApplyMergeResolution[];
};

export type MergeResolutionSetArtifactPayload =
  | MergeResolutionSetArtifactPayloadV1
  | MergeResolutionSetArtifactPayloadV2;

export type ResolvedMergeAttemptArtifactPayload = {
  readonly schemaVersion: 1;
  readonly recordKind: 'resolvedMergeAttempt';
  readonly resultDigest: ObjectDigest;
  readonly resolutionSetDigest: ObjectDigest;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
};

export type MergePreviewArtifactRecord = VersionObjectRecord<MergePreviewArtifactPayload>;
export type MergeResolutionSetArtifactRecordV1 =
  VersionObjectRecord<MergeResolutionSetArtifactPayloadV1>;
export type MergeResolutionSetArtifactRecordV2 =
  VersionObjectRecord<MergeResolutionSetArtifactPayloadV2>;
export type MergeResolutionSetArtifactRecord =
  VersionObjectRecord<MergeResolutionSetArtifactPayload>;
export type ResolvedMergeAttemptArtifactRecord =
  VersionObjectRecord<ResolvedMergeAttemptArtifactPayload>;

export type CreateMergeResolutionSetArtifactV2Input = {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly previewArtifactDigest: ObjectDigest;
  readonly resolutions?: readonly VersionApplyMergeResolution[];
};

export async function createMergePreviewArtifactRecord(
  namespace: VersionGraphNamespace,
  input: {
    readonly status: MergePreviewArtifactStatus;
    readonly base: PublicWorkbookCommitId;
    readonly ours: PublicWorkbookCommitId;
    readonly theirs: PublicWorkbookCommitId;
    readonly changes?: readonly VersionMergeChange[];
    readonly conflicts?: readonly VersionMergeConflict[];
  },
): Promise<MergePreviewArtifactRecord> {
  return createVersionObjectRecord(namespace, {
    objectType: MERGE_PREVIEW_OBJECT_TYPE,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [
      commitDependency(input.base),
      commitDependency(input.ours),
      commitDependency(input.theirs),
    ],
    payload: {
      schemaVersion: 1,
      recordKind: 'mergePreview',
      status: input.status,
      base: input.base,
      ours: input.ours,
      theirs: input.theirs,
      changes: sortedMergeChanges(input.changes ?? []),
      conflicts: sortedMergeConflicts(input.conflicts ?? []),
    },
  }) as Promise<MergePreviewArtifactRecord>;
}

export async function createMergeResolutionSetArtifactRecord(
  namespace: VersionGraphNamespace,
  resolutions?: readonly VersionApplyMergeResolution[],
): Promise<MergeResolutionSetArtifactRecordV1>;
export async function createMergeResolutionSetArtifactRecord(
  namespace: VersionGraphNamespace,
  input: CreateMergeResolutionSetArtifactV2Input,
): Promise<MergeResolutionSetArtifactRecordV2>;
export async function createMergeResolutionSetArtifactRecord(
  namespace: VersionGraphNamespace,
  input: readonly VersionApplyMergeResolution[] | CreateMergeResolutionSetArtifactV2Input = [],
): Promise<MergeResolutionSetArtifactRecord> {
  if (isCreateMergeResolutionSetArtifactV2Input(input)) {
    return createMergeResolutionSetArtifactRecordV2(namespace, input);
  }

  return createVersionObjectRecord(namespace, {
    objectType: MERGE_RESOLUTION_SET_V1_OBJECT_TYPE,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload: {
      schemaVersion: 1,
      recordKind: 'mergeResolutionSet',
      resolutions: sortedResolutions(input),
    },
  }) as Promise<MergeResolutionSetArtifactRecordV1>;
}

function isCreateMergeResolutionSetArtifactV2Input(
  input: readonly VersionApplyMergeResolution[] | CreateMergeResolutionSetArtifactV2Input,
): input is CreateMergeResolutionSetArtifactV2Input {
  return !Array.isArray(input);
}

async function createMergeResolutionSetArtifactRecordV2(
  namespace: VersionGraphNamespace,
  input: CreateMergeResolutionSetArtifactV2Input,
): Promise<MergeResolutionSetArtifactRecordV2> {
  return createVersionObjectRecord(namespace, {
    objectType: MERGE_RESOLUTION_SET_V2_OBJECT_TYPE,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [mergePreviewArtifactRef(input.previewArtifactDigest)],
    payload: {
      schemaVersion: 2,
      recordKind: 'mergeResolutionSet',
      resultId: input.resultId,
      resultDigest: cloneDigest(input.resultDigest),
      previewArtifactDigest: cloneDigest(input.previewArtifactDigest),
      resolutions: sortedResolutions(input.resolutions ?? []),
    },
  }) as Promise<MergeResolutionSetArtifactRecordV2>;
}

export async function createResolvedMergeAttemptArtifactRecord(
  namespace: VersionGraphNamespace,
  input: {
    readonly resultDigest: ObjectDigest;
    readonly resolutionSetDigest: ObjectDigest;
    readonly targetRef: VersionMainRefName | VersionRefName;
    readonly expectedTargetHead: VersionCommitExpectedHead;
  },
): Promise<ResolvedMergeAttemptArtifactRecord> {
  return createVersionObjectRecord(namespace, {
    objectType: RESOLVED_MERGE_ATTEMPT_OBJECT_TYPE,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [
      mergePreviewArtifactRef(input.resultDigest),
      mergeResolutionSetArtifactRef(input.resolutionSetDigest),
    ],
    payload: {
      schemaVersion: 1,
      recordKind: 'resolvedMergeAttempt',
      resultDigest: input.resultDigest,
      resolutionSetDigest: input.resolutionSetDigest,
      targetRef: input.targetRef,
      expectedTargetHead: input.expectedTargetHead,
    },
  }) as Promise<ResolvedMergeAttemptArtifactRecord>;
}

export function mergePreviewArtifactRef(digest: ObjectDigest): VersionDependencyRef {
  return {
    kind: 'object',
    objectType: MERGE_PREVIEW_OBJECT_TYPE,
    digest,
  };
}

export function mergeResolutionSetArtifactRef(digest: ObjectDigest): VersionDependencyRef {
  return {
    kind: 'object',
    objectType: MERGE_RESOLUTION_SET_V1_OBJECT_TYPE,
    digest,
  };
}

export function mergeResolutionSetV2ArtifactRef(digest: ObjectDigest): VersionDependencyRef {
  return {
    kind: 'object',
    objectType: MERGE_RESOLUTION_SET_V2_OBJECT_TYPE,
    digest,
  };
}

export function resolvedMergeAttemptArtifactRef(digest: ObjectDigest): VersionDependencyRef {
  return {
    kind: 'object',
    objectType: RESOLVED_MERGE_ATTEMPT_OBJECT_TYPE,
    digest,
  };
}

export function mergeResultIdForPreviewDigest(digest: ObjectDigest): VersionMergeResultId {
  return `merge-result:${digest.digest}` as VersionMergeResultId;
}

function commitDependency(commitId: PublicWorkbookCommitId): VersionDependencyRef {
  const parsed = parseWorkbookCommitId(commitId);
  return {
    kind: 'commit',
    commitId: parsed,
    digest: objectDigestFromWorkbookCommitId(parsed),
  };
}

function sortedMergeChanges(changes: readonly VersionMergeChange[]): readonly VersionMergeChange[] {
  return [...changes].sort(compareMergeChanges).map(cloneJson);
}

function sortedMergeConflicts(
  conflicts: readonly VersionMergeConflict[],
): readonly VersionMergeConflict[] {
  return [...conflicts].sort(compareMergeConflicts).map((conflict) => ({
    ...cloneJson(conflict),
    resolutionOptions: [...conflict.resolutionOptions]
      .sort(compareResolutionOptions)
      .map(cloneJson),
  }));
}

function sortedResolutions(
  resolutions: readonly VersionApplyMergeResolution[],
): readonly VersionApplyMergeResolution[] {
  return [...resolutions].sort(compareResolutions).map(cloneJson);
}

function compareResolutionOptions(
  left: VersionMergeConflict['resolutionOptions'][number],
  right: VersionMergeConflict['resolutionOptions'][number],
): number {
  return compareStrings(
    [left.conflictId, left.optionId, left.kind].join('\u0000'),
    [right.conflictId, right.optionId, right.kind].join('\u0000'),
  );
}

function compareResolutions(
  left: VersionApplyMergeResolution,
  right: VersionApplyMergeResolution,
): number {
  return compareStrings(
    [left.conflictId, left.expectedConflictDigest, left.optionId, left.kind].join('\u0000'),
    [right.conflictId, right.expectedConflictDigest, right.optionId, right.kind].join('\u0000'),
  );
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneDigest(digest: ObjectDigest): ObjectDigest {
  return {
    algorithm: digest.algorithm,
    digest: digest.digest,
  };
}
