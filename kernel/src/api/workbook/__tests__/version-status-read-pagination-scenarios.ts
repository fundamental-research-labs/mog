import {
  VERSION_STATUS_LIST_PAGE_TOKEN as LIST_PAGE_TOKEN,
  createFakeVersionStatusGraphStore as createFakeGraphStore,
} from './version-status-test-utils';
import { createMockCtx, createWorkbook } from './version-status-workbook-test-utils';

export function registerVersionStatusReadPaginationScenarios(): void {
  it('passes valid listCommits page tokens to the graph service', async () => {
    const graphStore = createFakeGraphStore();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    await expect(wb.version.listCommits({ pageToken: LIST_PAGE_TOKEN })).resolves.toMatchObject({
      ok: true,
      value: {
        limit: 50,
      },
    });
    expect(graphStore.listCommits).toHaveBeenCalledWith({ pageToken: LIST_PAGE_TOKEN });
  });
}
