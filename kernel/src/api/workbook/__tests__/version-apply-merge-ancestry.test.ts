import { jest } from '@jest/globals';

import {
  ancestryResult,
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

describe('WorkbookVersion applyMerge ancestry fast paths', () => {
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

  it('plans fast-forward previews as zero-change plans', async () => {
    const merge = jest.fn(async () => ancestryResult('fastForward'));
    const mergeCommit = jest.fn();
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      writeService: { mergeCommit },
    });

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
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('blocks fast-forward apply previews when no fast-forward writer is available', async () => {
    const merge = jest.fn(async () => ancestryResult('fastForward'));
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
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_STORE_UNAVAILABLE',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });
    expect(mergeCommit).not.toHaveBeenCalled();
  });

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
});
