import type { ObjectDigest } from '@mog-sdk/contracts/api';

import { resolutionFor } from './version-object-corruption-helpers-conflicts';
import type { ObjectCorruptionFixture } from './version-object-corruption-helpers-fixtures-types';

export async function saveResolution(fixture: ObjectCorruptionFixture): Promise<{
  readonly resolutionSetDigest: ObjectDigest;
  readonly resolvedAttemptDigest?: ObjectDigest;
}> {
  const saved = await fixture.version.saveMergeResolutions({
    resultId: fixture.preview.resultId,
    resultDigest: fixture.preview.resultDigest,
    redactionPolicyDigest: fixture.preview.resultDigest,
    targetRef: 'refs/heads/main' as any,
    expectedTargetHead: fixture.expectedTargetHead,
    resolutions: [resolutionFor(fixture.conflict, 'acceptTheirs')],
  });
  if (!saved.ok || !saved.value.resolutionSetDigest) {
    throw new Error(`expected saved resolution artifacts: ${JSON.stringify(saved)}`);
  }
  return {
    resolutionSetDigest: saved.value.resolutionSetDigest,
    ...(saved.value.resolvedAttemptDigest
      ? { resolvedAttemptDigest: saved.value.resolvedAttemptDigest }
      : {}),
  };
}
