import { expect, it } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import { BASE_COMMIT_ID, OURS_COMMIT_ID, THEIRS_COMMIT_ID } from './version-merge-core-test-utils';

export function registerVersionMergeCoreAvailabilityScenarios(): void {
  it('blocks without fabricating a preview when no merge service is attached', async () => {
    const version = new WorkbookVersionImpl({ versioning: {} } as any);

    await expect(
      version.merge({
        base: BASE_COMMIT_ID,
        ours: OURS_COMMIT_ID,
        theirs: THEIRS_COMMIT_ID,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MERGE_SERVICE_UNAVAILABLE',
            data: expect.objectContaining({
              recoverability: 'unsupported',
              redacted: true,
            }),
          }),
        ],
      },
    });
  });
}
