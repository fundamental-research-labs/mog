import { expect, it, jest } from '@jest/globals';

import {
  mergeInput,
  OURS,
  THEIRS,
  workbookVersionWithMergeService,
  workbookVersionWithoutMergeService,
} from './version-merge-provider-test-utils';

export function describeMergeProviderAvailabilityScenarios(): void {
  it('returns a blocked preview result when merge input is malformed', async () => {
    const merge = jest.fn();
    const version = workbookVersionWithMergeService(merge);

    await expect(
      version.merge({ base: 'not-a-commit', ours: OURS, theirs: THEIRS } as any),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: [expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' })],
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('reports merge as pending when no merge service is attached', async () => {
    const version = workbookVersionWithoutMergeService();

    await expect(version.merge(mergeInput())).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: [expect.objectContaining({ code: 'VERSION_MERGE_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(version.getStatus()).resolves.toMatchObject({
      merge: {
        stage: 'pending',
        available: false,
      },
    });
  });
}
