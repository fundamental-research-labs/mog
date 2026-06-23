import type {
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionMergeConflict,
} from '@mog-sdk/contracts/api';

import type { WorkbookVersionImpl } from '../version';
import { conflictDigestObject } from './version-merge-conflict-detail-authorization-helpers-digests';
import { TARGET_REF } from './version-merge-conflict-detail-authorization-helpers-review-artifact-constants';
import type { ReviewFixture } from './version-merge-conflict-detail-authorization-helpers-review-artifact-types';

export async function putResolutionPayload(input: {
  readonly version: WorkbookVersionImpl;
  readonly preview: ReviewFixture['preview'];
  readonly conflict: VersionMergeConflict;
  readonly option: VersionMergeConflict['resolutionOptions'][number];
  readonly redactionPolicyDigest: ObjectDigest;
  readonly target: VersionCommitExpectedHead;
  readonly value: any;
  readonly purpose: 'chooseValue' | 'custom';
  readonly domainPayloadSchema?: string;
}) {
  const result = await input.version.putMergeResolutionPayload({
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    redactionPolicyDigest: input.redactionPolicyDigest,
    conflictId: input.conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(input.conflict.conflictDigest),
    optionId: input.option.optionId,
    kind: input.option.kind,
    targetRef: TARGET_REF,
    expectedTargetHead: input.target,
    value: input.value,
    purpose: input.purpose,
    ...(input.domainPayloadSchema ? { domainPayloadSchema: input.domainPayloadSchema } : {}),
  });
  if (!result.ok) throw new Error(`expected payload put success: ${result.error.code}`);
  return result.value;
}
