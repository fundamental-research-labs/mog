import { expect, it, jest } from '@jest/globals';

import {
  BASE,
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  EXPECTED_TARGET_HEAD,
  OURS,
  TARGET_REF,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';

export function describeApplyMergeFastForwardApplyAncestryScenarios(): void {
  it('fast-forwards apply mode without previewing or creating a merge commit', async () => {
    const merge = jest.fn();
    const mergeCommit = jest.fn();
    const fastForwardMerge = jest.fn(async () => ({
      status: 'success',
      commitRef: {
        id: THEIRS,
        refName: TARGET_REF,
        resolvedFrom: TARGET_REF,
        refRevision: { kind: 'counter' as const, value: '2' },
      },
      diagnostics: [],
      mutationGuarantee: 'ref-fast-forwarded',
    }));
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      writeService: { fastForwardMerge, mergeCommit },
    });

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'applied',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        commitRef: {
          id: THEIRS,
          refName: TARGET_REF,
          resolvedFrom: TARGET_REF,
          refRevision: { kind: 'counter', value: '2' },
        },
        changes: [],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-fast-forwarded',
      },
    });
    expect(fastForwardMerge).toHaveBeenCalledWith({
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
    });
    expect(merge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('passes through terminal fast-forward apply metadata from the write service', async () => {
    const merge = jest.fn();
    const mergeCommit = jest.fn();
    const fastForwardMerge = jest.fn(async () => ({
      status: 'fastForwarded',
      commitRef: {
        id: THEIRS,
        refName: TARGET_REF,
        resolvedFrom: TARGET_REF,
        refRevision: { kind: 'counter' as const, value: '2' },
      },
      resultId: `merge-result:${DIGEST_C.digest}`,
      previewArtifactDigest: DIGEST_C,
      resultDigest: DIGEST_A,
      resolutionSetDigest: DIGEST_B,
      resolvedAttemptDigest: DIGEST_C,
      targetRef: TARGET_REF,
      headBefore: OURS,
      headAfter: THEIRS,
      applicationPlanDigest: DIGEST_A,
      diagnostics: [],
      mutationGuarantee: 'ref-fast-forwarded',
    }));
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      writeService: { fastForwardMerge, mergeCommit },
    });

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'fastForwarded',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        commitRef: {
          id: THEIRS,
          refName: TARGET_REF,
          resolvedFrom: TARGET_REF,
          refRevision: { kind: 'counter', value: '2' },
        },
        resultId: `merge-result:${DIGEST_C.digest}`,
        previewArtifactDigest: DIGEST_C,
        resultDigest: DIGEST_A,
        resolutionSetDigest: DIGEST_B,
        resolvedAttemptDigest: DIGEST_C,
        targetRef: TARGET_REF,
        headBefore: OURS,
        headAfter: THEIRS,
        applicationPlanDigest: DIGEST_A,
        changes: [],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-fast-forwarded',
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });
}
