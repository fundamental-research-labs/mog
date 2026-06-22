import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';

const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
const OURS_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
const THEIRS_COMMIT_ID = `commit:sha256:${'3'.repeat(64)}`;
const EXPECTED_TARGET_HEAD = {
  commitId: OURS_COMMIT_ID,
  revision: { kind: 'counter' as const, value: '1' },
};

describe('WorkbookVersion merge facade', () => {
  it('routes explicit commit-id preview requests to the attached merge service', async () => {
    const manifestRuntime = versionDomainSupportManifestRuntime();
    const cellsValues = manifestRuntime.domainSupportManifest.domains.find(
      (row) => row.matrixRowId === 'cells.values',
    );
    expect(cellsValues?.capabilityStates.merge).toBe('contracted');

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
    const version = workbookVersionWithMergeService(merge, manifestRuntime);

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
      ok: true,
      value: {
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
      },
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
    const version = workbookVersionWithMergeService(merge);

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
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({ redacted: true }),
          }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('blocks non-applyable target refs and expected-head mismatches before the merge service is called', async () => {
    const merge = jest.fn();
    const version = workbookVersionWithMergeService(merge);
    const input = {
      base: BASE_COMMIT_ID,
      ours: OURS_COMMIT_ID,
      theirs: THEIRS_COMMIT_ID,
    } as any;

    await expect(
      version.merge(input, {
        mode: 'preview',
        targetRef: 'refs/heads/review/not-applyable' as any,
        expectedTargetHead: EXPECTED_TARGET_HEAD as any,
        persistReviewRecord: true,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({ redacted: true }),
          }),
        ]),
      },
    });

    await expect(
      version.merge(input, {
        mode: 'preview',
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead: {
          commitId: THEIRS_COMMIT_ID,
          revision: { kind: 'counter', value: '1' },
        } as any,
        persistReviewRecord: true,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({ redacted: true }),
          }),
        ]),
      },
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
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MERGE_SERVICE_UNAVAILABLE',
            data: expect.objectContaining({
              recoverability: 'unsupported',
              redacted: true,
            }),
          }),
        ],
      },
    });
  });
});

function workbookVersionWithMergeService(
  merge: unknown,
  manifestRuntime = versionDomainSupportManifestRuntime(),
) {
  return new WorkbookVersionImpl({
    versioning: {
      mergeService: { merge },
      ...manifestRuntime,
    },
  } as any);
}
