import { jest } from '@jest/globals';

import {
  BASE,
  EXPECTED_TARGET_HEAD,
  OURS,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';

export function registerApplyMergeValidationTargetOptionsTests(): void {
  it('blocks apply mode before preview when target head fencing is incomplete', async () => {
    const merge = jest.fn();
    const version = workbookVersionWithVersioning({ mergeService: { merge } });

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it.each(['refs/heads/review/not-applyable', 'refs/heads/import/not-applyable'])(
    'blocks apply mode targetRef %s before preview or writes',
    async (targetRef) => {
      const merge = jest.fn();
      const fastForwardMerge = jest.fn();
      const mergeCommit = jest.fn();
      const version = workbookVersionWithVersioning({
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
      });

      await expect(
        version.applyMerge(
          { base: BASE, ours: OURS, theirs: THEIRS },
          { targetRef: targetRef as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.applyMerge',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_INVALID_OPTIONS',
              data: expect.objectContaining({
                redacted: true,
                mutationGuarantee: 'no-write-attempted',
              }),
            }),
          ],
        },
      });
      expect(merge).not.toHaveBeenCalled();
      expect(fastForwardMerge).not.toHaveBeenCalled();
      expect(mergeCommit).not.toHaveBeenCalled();
    },
  );
}
