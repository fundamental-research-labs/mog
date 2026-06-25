import { expect, it, jest } from '@jest/globals';

import { createVersion, ROOT_COMMIT_ID } from './version-diff-selector-test-utils';

export function registerSelectorRefStaleScenarios(): void {
  it.each([
    ['base', 'HEAD'],
    ['target', 'refs/heads/main'],
  ] as const)(
    'rejects stale %s ref selectors with redacted diagnostics',
    async (selector, refName) => {
      const hiddenCommit = `commit:sha256:${'9'.repeat(64)}`;
      const diff = jest.fn(async () => ({
        status: 'degraded',
        diagnostics: [
          {
            code: 'VERSION_DANGLING_REF',
            severity: 'error',
            selector,
            message: `${refName} points at ${hiddenCommit}`,
            details: { refName, commitId: hiddenCommit, rawRefDigest: 'sha256-secret' },
          },
        ],
      }));
      const version = createVersion(diff);

      const result = await version.diff(
        selector === 'base' ? { kind: 'ref', name: refName } : ROOT_COMMIT_ID,
        selector === 'target' ? { kind: 'ref', name: refName } : ROOT_COMMIT_ID,
      );

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_DANGLING_REF',
              message: 'The version graph could not validate the requested diff commit closure.',
              data: expect.objectContaining({
                recoverability: 'repair',
                redacted: true,
                payload: expect.objectContaining({
                  operation: 'diff',
                  selector,
                  refName: 'redacted',
                }),
              }),
            }),
          ],
        },
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(hiddenCommit);
      expect(serialized).not.toContain('sha256-secret');
      expect(diff).toHaveBeenCalledTimes(1);
    },
  );
}
