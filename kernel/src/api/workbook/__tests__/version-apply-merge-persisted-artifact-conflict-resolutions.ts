import type {
  VersionApplyMergeResolution,
  VersionMergeConflict,
  VersionSealedResolutionPayloadRef,
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
}): Promise<{
  readonly sealedResolution: VersionApplyMergeResolution;
  readonly sealedPayloadRef: VersionSealedResolutionPayloadRef;
}> {
  const { fixture, preview, conflict } = input;
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === 'acceptTheirs');
  if (!option) throw new Error('expected acceptTheirs option');

  const payload = await fixture.sourceWb.version.putMergeResolutionPayload({
    resultId: preview.resultId,
    resultDigest: preview.resultDigest,
    redactionPolicyDigest: preview.resultDigest,
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
    optionId: option.optionId,
    kind: option.kind,
    targetRef: PERSISTED_ARTIFACT_TARGET_REF,
    expectedTargetHead: fixture.expectedTargetHead,
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
