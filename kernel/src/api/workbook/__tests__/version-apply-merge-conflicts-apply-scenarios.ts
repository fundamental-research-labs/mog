import { expect, it, jest } from '@jest/globals';

import {
  BASE,
  conflictedResult,
  EXPECTED_TARGET_HEAD,
  MERGE,
  OURS,
  resolutionFor,
  sameCellConflict,
  TARGET_REF,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';

export function describeApplyMergeConflictApplyScenarios(): void {
  it('applies resolved conflicts through the merge commit write service', async () => {
    const conflict = sameCellConflict();
    const merge = jest.fn(async () => conflictedResult(conflict));
    const mergeCommit = jest.fn(async () => ({
      status: 'success',
      commitRef: {
        id: MERGE,
        refName: TARGET_REF,
        resolvedFrom: TARGET_REF,
        refRevision: { kind: 'counter' as const, value: '2' },
      },
      diagnostics: [],
    }));
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      writeService: { mergeCommit },
    });
    const resolution = resolutionFor(conflict, 'acceptTheirs');
    const resolvedChange = {
      structural: conflict.structural,
      base: conflict.base,
      ours: conflict.ours,
      theirs: conflict.theirs,
      merged: { kind: 'value' as const, value: 'theirs' },
    };

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS, resolutions: [resolution] },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'applied',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        commitRef: {
          id: MERGE,
          refName: TARGET_REF,
          resolvedFrom: TARGET_REF,
          refRevision: { kind: 'counter', value: '2' },
        },
        changes: [resolvedChange],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 1,
        mutationGuarantee: 'merge-commit-created',
      },
    });
    expect(mergeCommit).toHaveBeenCalledWith({
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      changes: [resolvedChange],
      resolutionCount: 1,
    });
  });
}
