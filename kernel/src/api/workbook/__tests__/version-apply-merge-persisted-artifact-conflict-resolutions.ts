import type {
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMergeConflict,
  VersionSealedResolutionPayloadRef,
  Workbook,
} from '@mog-sdk/contracts/api';

import type { PersistedConflictedMergePreview } from './version-apply-merge-persisted-artifact-conflict-assertions';
import {
  conflictDigestObject,
  PERSISTED_ARTIFACT_TARGET_REF,
  resolutionFor,
  type PersistedMergeScenario,
} from './version-apply-merge-persisted-artifact-test-utils';

export async function sealAcceptTheirsResolution(input: {
  readonly fixture: PersistedMergeScenario;
  readonly preview: PersistedConflictedMergePreview;
  readonly conflict: VersionMergeConflict;
  readonly workbook?: Workbook;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
}): Promise<{
  readonly sealedResolution: VersionApplyMergeResolution;
  readonly sealedPayloadRef: VersionSealedResolutionPayloadRef;
}> {
  const { fixture, preview, conflict } = input;
  const workbook = input.workbook ?? fixture.sourceWb;
  const expectedTargetHead = input.expectedTargetHead ?? fixture.expectedTargetHead;
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === 'acceptTheirs');
  if (!option) throw new Error('expected acceptTheirs option');

  const payload = await workbook.version.putMergeResolutionPayload({
    resultId: preview.resultId,
    resultDigest: preview.resultDigest,
    redactionPolicyDigest: preview.resultDigest,
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
    optionId: option.optionId,
    kind: option.kind,
    targetRef: PERSISTED_ARTIFACT_TARGET_REF,
    expectedTargetHead,
    value: option.value as any,
    purpose: 'chooseValue',
  });
  if (!payload.ok) throw new Error(`expected payload put success: ${payload.error.code}`);

  return {
    sealedResolution: {
      ...resolutionFor(conflict, 'acceptTheirs'),
      sealedPayloadRef: payload.value,
    },
    sealedPayloadRef: payload.value,
  };
}
