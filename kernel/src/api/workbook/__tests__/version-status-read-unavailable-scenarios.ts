import {
  VERSION_STATUS_CHILD_COMMIT_ID as CHILD_COMMIT_ID,
  VERSION_STATUS_ROOT_COMMIT_ID as ROOT_COMMIT_ID,
} from './version-status-test-utils';
import { createWorkbook, versionUnavailable } from './version-status-workbook-test-utils';

export function registerVersionStatusReadUnavailableScenarios(): void {
  it('degrades read and diff APIs and rejects commit before graph services are attached', async () => {
    const wb = createWorkbook();

    await expect(wb.version.getHead()).resolves.toMatchObject({
      ...versionUnavailable('getHead', 'VERSION_GRAPH_UNINITIALIZED'),
    });

    await expect(wb.version.listCommits()).resolves.toMatchObject({
      ...versionUnavailable('listCommits', 'VERSION_GRAPH_UNINITIALIZED'),
    });

    await expect(wb.version.readRef('HEAD')).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_GRAPH_UNINITIALIZED',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });

    await expect(wb.version.diff(ROOT_COMMIT_ID, CHILD_COMMIT_ID)).resolves.toMatchObject({
      ...versionUnavailable('diff', 'VERSION_UNMATERIALIZABLE_COMMIT'),
    });

    await expect(wb.version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_GRAPH_UNINITIALIZED',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              redacted: true,
            }),
          }),
        ],
      },
    });
  });
}
