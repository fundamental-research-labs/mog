import type { ObjectDigest } from '@mog-sdk/contracts/api';

import type { MergeResolutionPayloadAuthority } from './version-merge-review-artifacts';
import { isObjectDigest, isRecord } from './version-merge-sealed-payload-utils';

const MERGE_RESOLUTION_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'recordKind',
  'attemptId',
  'resultId',
  'resultDigest',
  'previewArtifactDigest',
  'redactionPolicyDigest',
  'conflictId',
  'conflictDigest',
  'expectedConflictDigest',
  'optionId',
  'kind',
  'targetRef',
  'expectedTargetHead',
  'authority',
  'purpose',
  'resolutionSetDigest',
  'domainPayloadSchema',
  'value',
]);

export type MergeResolutionPayloadRecord = {
  readonly schemaVersion: 1;
  readonly recordKind: 'mergeResolutionPayload';
  readonly attemptId: string;
  readonly resultId: string;
  readonly resultDigest: ObjectDigest;
  readonly previewArtifactDigest: ObjectDigest;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly conflictId: string;
  readonly conflictDigest: ObjectDigest;
  readonly expectedConflictDigest: string;
  readonly optionId: string;
  readonly kind: string;
  readonly targetRef: string;
  readonly expectedTargetHead: unknown;
  readonly authority: MergeResolutionPayloadAuthority;
  readonly purpose: string;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly domainPayloadSchema?: string;
  readonly value: unknown;
};

export function toMergeResolutionPayloadRecord(
  value: unknown,
): MergeResolutionPayloadRecord | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.recordKind !== 'mergeResolutionPayload'
  ) {
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!MERGE_RESOLUTION_PAYLOAD_KEYS.has(key)) return null;
  }
  if (
    typeof value.resultId !== 'string' ||
    typeof value.attemptId !== 'string' ||
    !isObjectDigest(value.resultDigest) ||
    !isObjectDigest(value.previewArtifactDigest) ||
    !isObjectDigest(value.redactionPolicyDigest) ||
    typeof value.conflictId !== 'string' ||
    !isObjectDigest(value.conflictDigest) ||
    typeof value.expectedConflictDigest !== 'string' ||
    typeof value.optionId !== 'string' ||
    typeof value.kind !== 'string' ||
    typeof value.targetRef !== 'string' ||
    !isMergeResolutionPayloadAuthority(value.authority) ||
    typeof value.purpose !== 'string' ||
    (value.resolutionSetDigest !== undefined && !isObjectDigest(value.resolutionSetDigest)) ||
    (value.domainPayloadSchema !== undefined && typeof value.domainPayloadSchema !== 'string') ||
    !('expectedTargetHead' in value) ||
    !('value' in value)
  ) {
    return null;
  }
  return value as unknown as MergeResolutionPayloadRecord;
}

function isMergeResolutionPayloadAuthority(
  value: unknown,
): value is MergeResolutionPayloadAuthority {
  return (
    isRecord(value) &&
    (value.workspaceId === null || typeof value.workspaceId === 'string') &&
    (value.principalScope === null || typeof value.principalScope === 'string')
  );
}
