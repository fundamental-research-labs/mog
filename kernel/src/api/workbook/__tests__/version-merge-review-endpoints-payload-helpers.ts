import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeConflict,
  VersionPutMergeResolutionPayloadRequest,
  VersionSealedResolutionPayloadRef,
  Workbook,
} from '@mog-sdk/contracts/api';

import {
  conflictDigestObject,
  type PersistedConflictPreview,
} from './version-merge-review-endpoints-test-utils';

export const MAIN_TARGET_REF = 'refs/heads/main' as VersionMainRefName;

export function firstPreviewConflict(preview: PersistedConflictPreview): VersionMergeConflict {
  const conflict = preview.conflicts[0];
  if (!conflict) throw new Error('expected persisted conflict preview to contain a conflict');
  return conflict;
}

export function acceptTheirsOption(
  conflict: VersionMergeConflict,
): VersionMergeConflict['resolutionOptions'][number] {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === 'acceptTheirs');
  if (!option) throw new Error('expected acceptTheirs option');
  return option;
}

export function mergeResolutionPayloadRequest(input: {
  readonly preview: PersistedConflictPreview;
  readonly conflict: VersionMergeConflict;
  readonly option: VersionMergeConflict['resolutionOptions'][number];
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly value: VersionPutMergeResolutionPayloadRequest['value'];
}): VersionPutMergeResolutionPayloadRequest {
  return {
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    redactionPolicyDigest: input.preview.resultDigest,
    conflictId: input.conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(input.conflict.conflictDigest),
    optionId: input.option.optionId,
    kind: input.option.kind,
    targetRef: MAIN_TARGET_REF,
    expectedTargetHead: input.expectedTargetHead,
    value: input.value,
    purpose: 'chooseValue',
  };
}

export async function putAcceptTheirsPayload(input: {
  readonly sourceWb: Workbook;
  readonly preview: PersistedConflictPreview;
  readonly conflict: VersionMergeConflict;
  readonly expectedTargetHead: VersionCommitExpectedHead;
}): Promise<{
  readonly option: VersionMergeConflict['resolutionOptions'][number];
  readonly payload: VersionSealedResolutionPayloadRef;
}> {
  const option = acceptTheirsOption(input.conflict);
  const payload = await input.sourceWb.version.putMergeResolutionPayload(
    mergeResolutionPayloadRequest({
      preview: input.preview,
      conflict: input.conflict,
      option,
      expectedTargetHead: input.expectedTargetHead,
      value: option.value as any,
    }),
  );
  if (!payload.ok) throw new Error(`expected payload put success: ${payload.error.code}`);
  return { option, payload: payload.value };
}
