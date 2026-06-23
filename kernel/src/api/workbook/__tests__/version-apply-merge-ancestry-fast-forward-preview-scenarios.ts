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

export function describeApplyMergeFastForwardPreviewAncestryScenarios(): void {
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
}
