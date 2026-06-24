import { jest } from '@jest/globals';

import {
  DIGEST_A,
  DIGEST_B,
  EXPECTED_TARGET_HEAD,
  TARGET_REF,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';

export function registerApplyMergeValidationPersistedResultTests(): void {
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
          targetRef: 'refs/heads/not-applyable.lock' as any,
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
