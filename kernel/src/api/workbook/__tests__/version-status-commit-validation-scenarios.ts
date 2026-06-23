import { jest } from '@jest/globals';

import { createMockCtx, createWorkbook } from './version-status-workbook-test-utils';

export function registerVersionStatusCommitValidationScenarios() {
  it.each([
    ['author', 'VERSION_PERMISSION_DENIED'],
    ['parents', 'VERSION_PERMISSION_DENIED'],
    ['segmentIds', 'VERSION_INVALID_OPTIONS'],
    ['unknownField', 'VERSION_INVALID_OPTIONS'],
  ])('rejects unsafe commit option %s before the write service is called', async (field, issue) => {
    const commit = jest.fn();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          writeService: { commit },
        },
      }),
    });

    await expect(wb.version.commit({ [field]: 'spoofed' } as any)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: issue,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              redacted: true,
            }),
          }),
        ],
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects unsupported root/import commit modes before the write service is called', async () => {
    const commit = jest.fn();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          writeService: { commit },
        },
      }),
    });

    await expect(wb.version.commit({ mode: { kind: 'root' } })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' })],
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });
}
