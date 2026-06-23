import { expect, it } from '@jest/globals';

import {
  COMMIT_A,
  createWorkbookVersionWithBranchService,
  refVersion,
} from './version-refs-test-utils';

export function registerPublicRefSymbolicHeadScenario(): void {
  it('reports symbolic HEAD from the attached branch service target', async () => {
    const { version } = createWorkbookVersionWithBranchService('scenario/attached');
    await version.createBranch({ name: 'scenario/attached' as any, targetCommitId: COMMIT_A });

    await expect(version.getRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/scenario/attached',
          revision: refVersion('0'),
        },
        diagnostics: [],
      },
    });
  });
}
