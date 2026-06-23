import type {
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionMergeConflict,
} from '@mog-sdk/contracts/api';

import type { ReviewFixture } from './version-merge-review-saved-resolution-helpers-fixture';
import { conflictDigestObject } from './version-merge-review-saved-resolution-helpers-conflicts';

export function resolvedDetailInput(
  preview: ReviewFixture['preview'],
  conflict: VersionMergeConflict,
  saved: {
    readonly resolutionSetDigest: ObjectDigest;
    readonly resolvedAttemptDigest: ObjectDigest;
  },
) {
  return {
    resultId: preview.resultId,
    resultDigest: preview.resultDigest,
    redactionPolicyDigest: preview.resultDigest,
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
    valueRole: 'resolved' as const,
    purpose: 'resolution' as const,
    resolutionSetDigest: saved.resolutionSetDigest,
    resolvedAttemptDigest: saved.resolvedAttemptDigest,
  };
}

export function driftExpectedHead(target: VersionCommitExpectedHead): VersionCommitExpectedHead {
  return {
    ...target,
    revision: { kind: 'counter', value: '999' },
  };
}
