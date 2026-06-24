import { expect, it, jest } from '@jest/globals';

import {
  BASE_COMMIT_ID,
  EXPECTED_TARGET_HEAD,
  OURS_COMMIT_ID,
  THEIRS_COMMIT_ID,
  workbookVersionWithMergeService,
} from './version-merge-core-test-utils';

export function registerVersionMergeCoreValidationScenarios(): void {
  it('validates merge inputs before the merge service is called', async () => {
    const merge = jest.fn();
    const version = workbookVersionWithMergeService(merge);

    await expect(
      version.merge(
        {
          base: 'commit:sha256:BAD' as any,
          ours: OURS_COMMIT_ID,
          theirs: THEIRS_COMMIT_ID,
          extra: true,
        } as any,
        { mode: 'apply' as any, includeDiagnostics: 'yes' as any },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({ redacted: true }),
          }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('blocks unsafe target refs and expected-head mismatches before the merge service is called', async () => {
    const merge = jest.fn();
    const version = workbookVersionWithMergeService(merge);
    const input = {
      base: BASE_COMMIT_ID,
      ours: OURS_COMMIT_ID,
      theirs: THEIRS_COMMIT_ID,
    } as any;

    await expect(
      version.merge(input, {
        mode: 'preview',
        targetRef: 'refs/heads/not-applyable.lock' as any,
        expectedTargetHead: EXPECTED_TARGET_HEAD as any,
        persistReviewRecord: true,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({ redacted: true }),
          }),
        ]),
      },
    });

    await expect(
      version.merge(input, {
        mode: 'preview',
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead: {
          commitId: THEIRS_COMMIT_ID,
          revision: { kind: 'counter', value: '1' },
        } as any,
        persistReviewRecord: true,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({ redacted: true }),
          }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });
}
