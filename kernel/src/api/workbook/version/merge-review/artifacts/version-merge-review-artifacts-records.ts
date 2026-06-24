import type { JsonValue, ObjectDigest } from '@mog-sdk/contracts/api';

import { mergePreviewArtifactRef } from '../../../../../document/version-store/merge-attempt-artifacts';
import type { ObjectDigest as InternalObjectDigest } from '../../../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../../../document/version-store/object-store';
import { objectDigestFromConflictDigest } from './version-merge-review-artifacts-digests';

export const REVIEW_EXTENSION_OBJECT_TYPE = 'workbook.reviewExtension.v1' as const;

export type MergeResolutionPayloadAuthority = {
  readonly workspaceId: string | null;
  readonly principalScope: string | null;
};

export async function createMergeReviewPayloadRecord(
  namespace: VersionGraphNamespace,
  input: {
    readonly resultId: string;
    readonly resultDigest: InternalObjectDigest;
    readonly redactionPolicyDigest: ObjectDigest;
    readonly conflictId: string;
    readonly expectedConflictDigest: string;
    readonly optionId: string;
    readonly kind: string;
    readonly targetRef: string;
    readonly expectedTargetHead: JsonValue;
    readonly resolutionSetDigest?: ObjectDigest;
    readonly purpose: string;
    readonly domainPayloadSchema?: string;
    readonly value: JsonValue;
  },
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType: REVIEW_EXTENSION_OBJECT_TYPE,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [mergePreviewArtifactRef(input.resultDigest)],
    payload: {
      schemaVersion: 1,
      recordKind: 'mergeResolutionPayload',
      attemptId: input.resultId,
      resultId: input.resultId,
      resultDigest: input.resultDigest,
      previewArtifactDigest: input.resultDigest,
      redactionPolicyDigest: input.redactionPolicyDigest,
      conflictId: input.conflictId,
      conflictDigest: objectDigestFromConflictDigest(input.expectedConflictDigest),
      expectedConflictDigest: input.expectedConflictDigest,
      optionId: input.optionId,
      kind: input.kind,
      targetRef: input.targetRef,
      expectedTargetHead: input.expectedTargetHead,
      authority: mergeResolutionPayloadAuthorityForNamespace(namespace),
      ...(input.resolutionSetDigest === undefined
        ? {}
        : { resolutionSetDigest: input.resolutionSetDigest }),
      purpose: input.purpose,
      ...(input.domainPayloadSchema === undefined
        ? {}
        : { domainPayloadSchema: input.domainPayloadSchema }),
      value: input.value,
    },
  });
}

export function mergeResolutionPayloadAuthorityForNamespace(
  namespace: VersionGraphNamespace,
): MergeResolutionPayloadAuthority {
  return {
    workspaceId: namespace.workspaceId ?? null,
    principalScope: namespace.principalScope ?? null,
  };
}
