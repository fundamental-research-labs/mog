import type { VersionRefName } from '@mog-sdk/contracts/api';

import {
  createMergePreviewArtifactRecord,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
} from '../merge-attempt-artifacts';

import {
  commitSet,
  mergeConflict,
  NAMESPACE,
  resolutionFor,
  reverseConflictOptions,
  TARGET_REF,
} from './merge-attempt-artifacts-test-helpers';

export function registerMergeAttemptArtifactsConflictedScenarios(): void {
  it('canonicalizes conflict options and non-empty resolution-set ordering', async () => {
    const commits = await commitSet('conflict');
    const firstConflict = mergeConflict('Sheet1!A1', 'base', 'ours', 'theirs');
    const secondConflict = mergeConflict('Sheet1!B1', 'old', 'left', 'right');

    const first = await createMergePreviewArtifactRecord(NAMESPACE, {
      status: 'conflicted',
      base: commits.base.id,
      ours: commits.ours.id,
      theirs: commits.theirs.id,
      conflicts: [reverseConflictOptions(secondConflict), reverseConflictOptions(firstConflict)],
    });
    const reordered = await createMergePreviewArtifactRecord(NAMESPACE, {
      status: 'conflicted',
      base: commits.base.id,
      ours: commits.ours.id,
      theirs: commits.theirs.id,
      conflicts: [firstConflict, secondConflict],
    });
    const changed = await createMergePreviewArtifactRecord(NAMESPACE, {
      status: 'conflicted',
      base: commits.base.id,
      ours: commits.ours.id,
      theirs: commits.theirs.id,
      conflicts: [mergeConflict('Sheet1!A1', 'base', 'ours', 'other'), secondConflict],
    });

    expect(first.digest).toEqual(reordered.digest);
    expect(changed.digest.digest).not.toBe(first.digest.digest);
    expect(
      first.preimage.payload.conflicts.map((conflict) => conflict.structural.entityId),
    ).toEqual(['Sheet1!A1', 'Sheet1!B1']);
    expect(
      first.preimage.payload.conflicts[0].resolutionOptions.map((option) => option.optionId),
    ).toEqual([
      'option:Sheet1!A1:acceptBase',
      'option:Sheet1!A1:acceptOurs',
      'option:Sheet1!A1:acceptTheirs',
    ]);

    const acceptA = resolutionFor(firstConflict, 'acceptTheirs');
    const acceptB = resolutionFor(secondConflict, 'acceptOurs');
    const resolutionSet = await createMergeResolutionSetArtifactRecord(NAMESPACE, [
      acceptB,
      acceptA,
    ]);
    const reorderedResolutionSet = await createMergeResolutionSetArtifactRecord(NAMESPACE, [
      acceptA,
      acceptB,
    ]);
    const changedResolutionSet = await createMergeResolutionSetArtifactRecord(NAMESPACE, [
      resolutionFor(firstConflict, 'acceptBase'),
      acceptB,
    ]);

    expect(resolutionSet.digest).toEqual(reorderedResolutionSet.digest);
    expect(changedResolutionSet.digest.digest).not.toBe(resolutionSet.digest.digest);
    expect(
      resolutionSet.preimage.payload.resolutions.map((resolution) => resolution.conflictId),
    ).toEqual([firstConflict.conflictId, secondConflict.conflictId]);

    const resolved = await createResolvedMergeAttemptArtifactRecord(NAMESPACE, {
      resultDigest: first.digest,
      resolutionSetDigest: resolutionSet.digest,
      targetRef: TARGET_REF,
      expectedTargetHead: {
        commitId: commits.ours.id,
        revision: { kind: 'counter', value: '7' },
      },
    });
    const changedTarget = await createResolvedMergeAttemptArtifactRecord(NAMESPACE, {
      resultDigest: first.digest,
      resolutionSetDigest: resolutionSet.digest,
      targetRef: 'refs/heads/other' as VersionRefName,
      expectedTargetHead: {
        commitId: commits.ours.id,
        revision: { kind: 'counter', value: '7' },
      },
    });
    expect(changedTarget.digest.digest).not.toBe(resolved.digest.digest);
  });
}
