import { jest } from '@jest/globals';

import type { VersionSemanticDiffPage } from '@mog-sdk/contracts/api';
import {
  VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
  VERSION_DIFF_PUBLIC_CURSOR_PREFIX,
} from '@mog-sdk/contracts/versioning';
import { WorkbookVersionImpl } from '../version';

const ROOT_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
const READ_REVISION = { kind: 'counter', value: '1' } as const;

describe('WorkbookVersion diff ref selectors', () => {
  it('passes public branch refs through to the attached diff service', async () => {
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [],
      readRevision: READ_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
    }));
    const version = createVersion(diff);

    const result = await version.diff(
      ROOT_COMMIT_ID,
      { kind: 'ref', name: 'refs/heads/scenario/branch' },
      { pageSize: 25 },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        items: [],
        limit: 25,
        readRevision: READ_REVISION,
        order: 'semantic-change-order',
      } satisfies VersionSemanticDiffPage,
    });
    expect(diff).toHaveBeenCalledWith(
      { kind: 'commit', id: ROOT_COMMIT_ID },
      { kind: 'ref', name: 'refs/heads/scenario/branch' },
      { pageSize: 25 },
    );
  });

  it('rejects unsafe branch refs before calling the attached diff service', async () => {
    const diff = jest.fn(async () => {
      throw new Error('diff service should not be called for unsafe refs');
    });
    const version = createVersion(diff);

    const result = await version.diff(
      { kind: 'ref', name: 'refs/heads/private-review' as any },
      { kind: 'ref', name: 'HEAD' },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.diff',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            data: expect.objectContaining({
              operation: 'diff',
              redacted: true,
              payload: expect.objectContaining({
                operation: 'diff',
                selector: 'base',
                refName: 'redacted',
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('private-review');
    expect(diff).not.toHaveBeenCalled();
  });

  it('preserves HEAD and main ref selector behavior', async () => {
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [],
      readRevision: READ_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
    }));
    const version = createVersion(diff);

    await expect(
      version.diff({ kind: 'ref', name: 'HEAD' }, { kind: 'ref', name: 'refs/heads/main' }),
    ).resolves.toMatchObject({ ok: true });

    expect(diff).toHaveBeenCalledWith(
      { kind: 'ref', name: 'HEAD' },
      { kind: 'ref', name: 'refs/heads/main' },
      {},
    );
  });

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

  it('rejects public diff cursors with the wrong order key before provider calls', async () => {
    const diff = jest.fn(async () => {
      throw new Error('diff service should not be called for wrong-order cursors');
    });
    const version = createVersion(diff);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID, {
      pageToken: 'mog-vdiff-v1.topological-newest.cursor-handle',
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
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('topological-newest.cursor-handle');
    expect(diff).not.toHaveBeenCalled();
  });

  it('rejects diff service pages that use a non-semantic order key', async () => {
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [],
      readRevision: READ_REVISION,
      order: 'topological-newest',
      diagnostics: [],
    }));
    const version = createVersion(diff);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
            data: expect.objectContaining({
              redacted: true,
              recoverability: 'repair',
            }),
          }),
        ],
      },
    });
    expect(result).not.toHaveProperty('value');
  });
});

function createVersion(diff: jest.Mock) {
  return new WorkbookVersionImpl({
    versioning: {
      diffService: { diff },
    },
  } as any);
}
