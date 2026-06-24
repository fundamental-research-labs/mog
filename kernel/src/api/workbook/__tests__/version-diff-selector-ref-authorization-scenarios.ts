import { expect, it, jest } from '@jest/globals';

import { createVersion, ROOT_COMMIT_ID } from './version-diff-selector-test-utils';

export function registerSelectorRefAuthorizationScenarios(): void {
  it('rejects unsafe branch refs before calling the attached diff service', async () => {
    const diff = jest.fn(async () => {
      throw new Error('diff service should not be called for unsafe refs');
    });
    const version = createVersion(diff);

    const result = await version.diff(
      { kind: 'ref', name: 'refs/heads/private-review.lock' as any },
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
    expect(JSON.stringify(result)).not.toContain('private-review.lock');
    expect(diff).not.toHaveBeenCalled();
  });

  it.each([
    ['unsafe branch ref', { kind: 'ref', name: 'refs/heads/private-review.lock' }],
    ['tag ref', { kind: 'ref', name: 'refs/tags/v1' }],
    ['system ref', { kind: 'ref', name: 'refs/system/secret' }],
    ['hidden branch namespace', { kind: 'ref', name: 'refs/heads/hidden/payroll-shadow' }],
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
}
