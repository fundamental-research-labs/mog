import { expect, it } from '@jest/globals';

import {
  createVersionWithoutDiffProvider,
  ROOT_COMMIT_ID,
} from './version-diff-selector-test-utils';

export function registerSelectorRefProviderScenarios(): void {
  it('returns structured diagnostics when no version diff provider is attached', async () => {
    const version = createVersionWithoutDiffProvider();

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.diff',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_GRAPH_UNINITIALIZED',
            data: expect.objectContaining({
              operation: 'diff',
              recoverability: 'unsupported',
              redacted: true,
              payload: expect.objectContaining({ operation: 'diff' }),
            }),
          }),
        ],
      },
    });
  });
}
