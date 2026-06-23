import { jest } from '@jest/globals';

import { createFakeVersionStatusGraphStore as createFakeGraphStore } from './version-status-test-utils';
import { createMockCtx, createWorkbook } from './version-status-workbook-test-utils';

export function registerVersionStatusCommitServiceBoundaryScenarios() {
  it('does not treat a raw graph store commit method as the public write service', async () => {
    const graphStore = {
      ...createFakeGraphStore(),
      initializeGraph: jest.fn(),
      readCommitClosure: jest.fn(),
      commit: jest.fn(),
    };
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    await expect(wb.version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
      },
    });
    expect(graphStore.commit).not.toHaveBeenCalled();
  });
}
