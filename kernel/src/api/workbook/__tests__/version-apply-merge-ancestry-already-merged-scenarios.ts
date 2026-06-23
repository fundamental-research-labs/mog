import { expect, it, jest } from '@jest/globals';

import {
  ancestryResult,
  BASE,
  EXPECTED_TARGET_HEAD,
  OURS,
  TARGET_REF,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';

export function describeApplyMergeAlreadyMergedAncestryScenarios(): void {
  it('plans already-merged previews as zero-change plans', async () => {
    const merge = jest.fn(async () => ancestryResult('alreadyMerged'));
    const version = workbookVersionWithVersioning({ mergeService: { merge } });

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }, { mode: 'preview' }),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'planned',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        changes: [],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'preview-only',
      },
    });
  });

  it('returns alreadyMerged in apply mode without writing', async () => {
    const merge = jest.fn(async () => ancestryResult('alreadyMerged'));
    const mergeCommit = jest.fn();
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      writeService: { mergeCommit },
    });

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'alreadyMerged',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        commitRef: {
          id: OURS,
          refName: TARGET_REF,
          resolvedFrom: TARGET_REF,
          refRevision: EXPECTED_TARGET_HEAD.revision,
        },
        changes: [],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-not-mutated',
      },
    });
    expect(mergeCommit).not.toHaveBeenCalled();
  });
}
