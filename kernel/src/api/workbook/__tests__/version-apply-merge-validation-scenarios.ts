import { jest } from '@jest/globals';

import {
  BASE,
  DIGEST_A,
  DIGEST_B,
  EXPECTED_TARGET_HEAD,
  OURS,
  TARGET_REF,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';

export function registerApplyMergeValidationTests(): void {
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

  it('validates applyMerge input before merge preview is requested', async () => {
    const merge = jest.fn();
    const version = workbookVersionWithVersioning({ mergeService: { merge } });

    await expect(
      version.applyMerge({
        base: 'commit:sha256:BAD' as any,
        ours: OURS,
        theirs: THEIRS,
        resolutions: 'bad' as any,
        extra: true,
      } as any),
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

  it('validates persisted result inputs before merge preview is requested', async () => {
    const merge = jest.fn();
    const version = workbookVersionWithVersioning({ mergeService: { merge } });

    await expect(
      version.applyMerge(
        {
          resultId: 'merge-result:not-a-digest',
          resultDigest: DIGEST_A,
        } as any,
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
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

    await expect(
      version.applyMerge(
        {
          resultId: `merge-result:${DIGEST_A.digest}`,
          resultDigest: DIGEST_A,
        } as any,
        {
          targetRef: 'refs/heads/review/not-applyable' as any,
          expectedTargetHead: EXPECTED_TARGET_HEAD,
        },
      ),
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

    await expect(
      version.applyMerge(
        {
          resultId: `merge-result:${'a'.repeat(64)}`,
          previewArtifactDigest: { algorithm: 'sha256', digest: 'not-a-digest' },
          resultDigest: DIGEST_A,
        } as any,
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
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

    await expect(
      version.applyMerge(
        {
          resultId: `merge-result:${DIGEST_B.digest}`,
          previewArtifactDigest: DIGEST_B,
          resultDigest: DIGEST_A,
        } as any,
        { mode: 'preview' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'VERSION_MERGE_RESOLUTION_MISMATCH' }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });
}
