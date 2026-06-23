import { jest } from '@jest/globals';

import {
  BASE,
  OURS,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';

export function registerApplyMergeValidationInputTests(): void {
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
}
