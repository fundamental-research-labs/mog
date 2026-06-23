import { expect, it, jest } from '@jest/globals';

import type { VersionSemanticDiffPage } from '@mog-sdk/contracts/api';

import {
  createVersion,
  createVersionWithoutDiffProvider,
  READ_REVISION,
  ROOT_COMMIT_ID,
} from './version-diff-selector-test-utils';

export function registerSelectorRefScenarios(): void {
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

  it.each([
    ['unsupported ref namespace', { kind: 'ref', name: 'refs/heads/private-review' }],
    ['tag ref', { kind: 'ref', name: 'refs/tags/v1' }],
    ['system ref', { kind: 'ref', name: 'refs/system/secret' }],
    ['malformed branch ref', { kind: 'ref', name: 'refs/heads/scenario/../secret' }],
  ])('rejects %s before diff service lookup', async (_label, ref) => {
    const diff = jest.fn(async () => {
      throw new Error('diff service should not be called for unsafe refs');
    });
    const version = createVersion(diff);

    const result = await version.diff(ref as any, ROOT_COMMIT_ID);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.diff',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            data: expect.objectContaining({
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
    expect(JSON.stringify(result)).not.toContain(String(ref.name));
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
