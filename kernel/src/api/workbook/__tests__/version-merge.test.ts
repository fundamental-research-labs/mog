import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';

const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
const OURS_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
const THEIRS_COMMIT_ID = `commit:sha256:${'3'.repeat(64)}`;

describe('WorkbookVersion merge facade', () => {
  it('routes explicit commit-id preview requests to the attached merge service', async () => {
    const merge = jest.fn(async () => ({
      status: 'clean',
      base: BASE_COMMIT_ID,
      ours: OURS_COMMIT_ID,
      theirs: THEIRS_COMMIT_ID,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'merge-change-1',
            domain: 'cell',
            entityId: 'sheet-1!B1',
            propertyPath: ['value'],
          },
          base: { kind: 'value', value: null },
          theirs: { kind: 'value', value: 'ready' },
          merged: { kind: 'value', value: 'ready' },
        },
      ],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    }));
    const version = new WorkbookVersionImpl({ versioning: { mergeService: { merge } } } as any);

    await expect(
      version.merge(
        {
          base: BASE_COMMIT_ID,
          ours: OURS_COMMIT_ID,
          theirs: THEIRS_COMMIT_ID,
        },
        { mode: 'preview', includeDiagnostics: true },
      ),
    ).resolves.toEqual({
      status: 'clean',
      base: BASE_COMMIT_ID,
      ours: OURS_COMMIT_ID,
      theirs: THEIRS_COMMIT_ID,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'merge-change-1',
            domain: 'cell',
            entityId: 'sheet-1!B1',
            propertyPath: ['value'],
          },
          base: { kind: 'value', value: null },
          theirs: { kind: 'value', value: 'ready' },
          merged: { kind: 'value', value: 'ready' },
        },
      ],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
    expect(merge).toHaveBeenCalledWith(
      {
        base: BASE_COMMIT_ID,
        ours: OURS_COMMIT_ID,
        theirs: THEIRS_COMMIT_ID,
      },
      { mode: 'preview', includeDiagnostics: true },
    );
  });

  it('validates merge inputs before the merge service is called', async () => {
    const merge = jest.fn();
    const version = new WorkbookVersionImpl({ versioning: { mergeService: { merge } } } as any);

    await expect(
      version.merge(
        {
          base: 'commit:sha256:BAD' as any,
          ours: OURS_COMMIT_ID,
          theirs: THEIRS_COMMIT_ID,
          extra: true,
        } as any,
        { mode: 'apply' as any, includeDiagnostics: 'yes' as any },
      ),
    ).resolves.toMatchObject({
      status: 'blocked',
      base: null,
      ours: OURS_COMMIT_ID,
      theirs: THEIRS_COMMIT_ID,
      changes: [],
      conflicts: [],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_INVALID_OPTIONS',
          redacted: true,
        }),
      ]),
      mutationGuarantee: 'preview-only',
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('blocks without fabricating a preview when no merge service is attached', async () => {
    const version = new WorkbookVersionImpl({ versioning: {} } as any);

    await expect(
      version.merge({
        base: BASE_COMMIT_ID,
        ours: OURS_COMMIT_ID,
        theirs: THEIRS_COMMIT_ID,
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_SERVICE_UNAVAILABLE',
          recoverability: 'unsupported',
          redacted: true,
        }),
      ],
      mutationGuarantee: 'preview-only',
    });
  });
});
