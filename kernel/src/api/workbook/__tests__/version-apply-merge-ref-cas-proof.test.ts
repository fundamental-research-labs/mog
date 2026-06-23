import { jest } from '@jest/globals';

import type {
  VersionCommitExpectedHead,
  VersionMergeResult,
  VersionRefName,
} from '@mog-sdk/contracts/api';

import { applyMergeWorkbookVersion } from '../version-apply-merge';
import {
  BASE,
  EXPECTED_TARGET_HEAD,
  OURS,
  TARGET_REF,
  THEIRS,
  cleanMergePreview,
  publicApplyContext,
} from './version-apply-merge-ref-cas-proof-test-utils';

describe('applyMergeWorkbookVersion target-ref CAS proof validation', () => {
  it('fails closed before fast-forward writes when the concrete target head is stale', async () => {
    const fastForwardMerge = jest.fn();
    const ctx = await publicApplyContext({
      targetCommitId: THEIRS,
      targetRevision: { kind: 'counter', value: '2' },
      fastForwardMerge,
    });

    const result = await applyMergeWorkbookVersion(
      ctx,
      { base: BASE, ours: OURS, theirs: THEIRS },
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'staleTargetHead',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'ref-not-mutated',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          recoverability: 'retry',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'staleTargetHead',
            targetRef: TARGET_REF,
            expectedHead: OURS,
            actualHead: THEIRS,
          }),
        }),
      ],
    });
    expect(fastForwardMerge).not.toHaveBeenCalled();
  });

  it('fails closed before writes when targetRef mismatches the current symbolic HEAD target', async () => {
    const fastForwardMerge = jest.fn();
    const expectedTargetHead: VersionCommitExpectedHead = {
      ...EXPECTED_TARGET_HEAD,
      symbolicHeadRevision: { kind: 'counter', value: 'head-1' },
    };
    const ctx = await publicApplyContext({
      symbolicTarget: 'refs/heads/scenario/current' as VersionRefName,
      symbolicRevision: expectedTargetHead.symbolicHeadRevision,
      fastForwardMerge,
    });

    const result = await applyMergeWorkbookVersion(
      ctx,
      { base: BASE, ours: OURS, theirs: THEIRS },
      { targetRef: TARGET_REF, expectedTargetHead },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          recoverability: 'retry',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'symbolicTargetMismatch',
            expectedTargetRef: TARGET_REF,
            actualTargetRef: 'refs/heads/scenario/current',
          }),
        }),
      ],
    });
    expect(fastForwardMerge).not.toHaveBeenCalled();
  });

  it('fails closed before writes when symbolicHeadRevision is stale', async () => {
    const mergeCommit = jest.fn();
    const merge = jest.fn(async (): Promise<VersionMergeResult> => cleanMergePreview());
    const ctx = await publicApplyContext({
      symbolicRevision: { kind: 'counter', value: 'head-2' },
      merge,
      mergeCommit,
    });

    const result = await applyMergeWorkbookVersion(
      ctx,
      { base: BASE, ours: OURS, theirs: THEIRS },
      {
        targetRef: TARGET_REF,
        expectedTargetHead: {
          ...EXPECTED_TARGET_HEAD,
          symbolicHeadRevision: { kind: 'counter', value: 'head-1' },
        },
      },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          recoverability: 'retry',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'staleSymbolicHead',
            targetRef: TARGET_REF,
            expectedRevision: 'head-1',
            actualRevision: 'head-2',
          }),
        }),
      ],
    });
    expect(merge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });
});
