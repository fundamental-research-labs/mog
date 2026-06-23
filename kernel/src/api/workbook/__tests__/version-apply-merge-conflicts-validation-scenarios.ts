import { expect, it, jest } from '@jest/globals';

import {
  BASE,
  conflictedResult,
  OURS,
  resolutionFor,
  sameCellConflict,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';

export function describeApplyMergeConflictValidationScenarios(): void {
  it('blocks resolution sets with stale conflict digests', async () => {
    const conflict = sameCellConflict();
    const merge = jest.fn(async () => conflictedResult(conflict));
    const version = workbookVersionWithVersioning({ mergeService: { merge } });
    const resolution = {
      ...resolutionFor(conflict, 'acceptOurs'),
      expectedConflictDigest: 'sha256:stale',
    };

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS, resolutions: [resolution] },
        { mode: 'preview' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
            data: expect.objectContaining({
              redacted: true,
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ],
      },
    });
  });
}
