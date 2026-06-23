import { expect, it, jest } from '@jest/globals';

import {
  VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
  VERSION_DIFF_PUBLIC_CURSOR_PREFIX,
} from '@mog-sdk/contracts/versioning';

import { createVersion, ROOT_COMMIT_ID } from './version-diff-selector-test-utils';

export function registerSelectorCursorScenarios(): void {
  it('rejects oversized public diff cursors before calling the attached diff service', async () => {
    const diff = jest.fn(async () => {
      throw new Error('diff service should not be called for oversized cursors');
    });
    const version = createVersion(diff);
    const oversizedCursor =
      VERSION_DIFF_PUBLIC_CURSOR_PREFIX + 'x'.repeat(VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH + 1);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID, {
      pageToken: oversizedCursor,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                operation: 'diff',
                option: 'pageToken',
                max: VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(oversizedCursor);
    expect(diff).not.toHaveBeenCalled();
  });

  it.each([
    ['empty public cursor handle', VERSION_DIFF_PUBLIC_CURSOR_PREFIX],
    ['cursor body with whitespace', `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}cursor handle`],
    ['cursor body with unsafe slash', `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}cursor/handle`],
    ['cursor body with unsafe percent', `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}cursor%2Fhandle`],
  ])(
    'rejects forged public diff cursor with %s before provider calls',
    async (_label, pageToken) => {
      const diff = jest.fn(async () => {
        throw new Error('diff service should not be called for forged cursors');
      });
      const version = createVersion(diff);

      const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID, { pageToken });

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_INVALID_OPTIONS',
              data: expect.objectContaining({
                redacted: true,
                payload: expect.objectContaining({
                  operation: 'diff',
                  option: 'pageToken',
                }),
              }),
            }),
          ],
        },
      });
      expect(JSON.stringify(result)).not.toContain(pageToken);
      expect(diff).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['wrong diff order key', 'mog-vdiff-v1.topological-newest.cursor-handle'],
    ['wrong diff cursor schema version', 'mog-vdiff-v2.semantic-change-order.cursor-handle'],
    ['foreign pagination cursor', 'mog-vcommits-v1.topological-newest.cursor-handle'],
  ])('rejects %s before provider calls', async (_label, pageToken) => {
    const diff = jest.fn(async () => {
      throw new Error('diff service should not be called for wrong-order cursors');
    });
    const version = createVersion(diff);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID, { pageToken });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                operation: 'diff',
                option: 'pageToken',
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(pageToken);
    expect(diff).not.toHaveBeenCalled();
  });
}
