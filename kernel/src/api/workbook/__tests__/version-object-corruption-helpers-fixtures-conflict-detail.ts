import type { ObjectDigest } from '@mog-sdk/contracts/api';

import { conflictDigestObject } from './version-object-corruption-helpers-conflicts';
import type { ObjectCorruptionFixture } from './version-object-corruption-helpers-fixtures-types';

export function conflictDetailInput(
  fixture: ObjectCorruptionFixture,
  options: {
    readonly valueRole: 'base' | 'ours' | 'theirs' | 'resolved';
    readonly resolutionSetDigest?: ObjectDigest;
    readonly resolvedAttemptDigest?: ObjectDigest;
  },
) {
  return {
    resultId: fixture.preview.resultId,
    resultDigest: fixture.preview.resultDigest,
    redactionPolicyDigest: fixture.preview.resultDigest,
    conflictId: fixture.conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(fixture.conflict.conflictDigest),
    valueRole: options.valueRole,
    purpose: 'review',
    ...(options.resolutionSetDigest ? { resolutionSetDigest: options.resolutionSetDigest } : {}),
    ...(options.resolvedAttemptDigest
      ? {
          resolvedAttemptDigest: options.resolvedAttemptDigest,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead: fixture.expectedTargetHead,
        }
      : {}),
  } as const;
}
