import { jest } from '@jest/globals';

import type { VersionMergeInput, VersionMergeResult } from '@mog-sdk/contracts/api';
import { WorkbookVersionImpl } from '../version';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';

const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
const DIGEST_A = { algorithm: 'sha256', digest: 'a'.repeat(64) } as const;
const DIGEST_B = { algorithm: 'sha256', digest: 'b'.repeat(64) } as const;
const DIGEST_C = { algorithm: 'sha256', digest: 'c'.repeat(64) } as const;
const TARGET_REF = 'refs/heads/main';
const EXPECTED_TARGET_HEAD = {
  commitId: OURS,
  revision: { kind: 'counter' as const, value: '1' },
};

describe('WorkbookVersion merge facade', () => {
  it('delegates merge preview through an attached document-scoped service', async () => {
    const result: VersionMergeResult = {
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
    const merge = jest.fn(async () => result);
    const version = workbookVersionWithMergeService(merge);

    await expect(
      version.merge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        {
          mode: 'preview',
          includeDiagnostics: true,
          targetRef: TARGET_REF as any,
          expectedTargetHead: EXPECTED_TARGET_HEAD,
          persistReviewRecord: true,
        },
      ),
    ).resolves.toStrictEqual({ ok: true, value: result });
    expect(merge).toHaveBeenCalledWith(
      { base: BASE, ours: OURS, theirs: THEIRS },
      {
        mode: 'preview',
        includeDiagnostics: true,
        targetRef: TARGET_REF,
        expectedTargetHead: EXPECTED_TARGET_HEAD,
        persistReviewRecord: true,
      },
    );
  });

  it('passes through validated provider merge attempt metadata', async () => {
    const result = {
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
      previewArtifactDigest: DIGEST_B,
      resultDigest: DIGEST_A,
      resolutionSetDigest: DIGEST_C,
      resolvedAttemptDigest: DIGEST_A,
      attemptPersistence: 'persisted',
      attemptKind: 'applyable',
      resultId: 'merge-result:review-main',
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      applicationPlanDigest: DIGEST_B,
      applyEligibilityDigest: DIGEST_C,
    } as const;
    const merge = jest.fn(async () => result);
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toStrictEqual({
      ok: true,
      value: result,
    });
  });

  it('blocks provider merge attempts with malformed persistence metadata', async () => {
    const merge = jest.fn(async () => ({
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
      resultDigest: { algorithm: 'sha256', digest: 'not-a-digest' },
    }));
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });
  });

  it('blocks provider merge attempts with malformed preview artifact metadata', async () => {
    const merge = jest.fn(async () => ({
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
      previewArtifactDigest: { algorithm: 'sha256', digest: 'not-a-digest' },
    }));
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });
  });

  it('passes through provider conflicts with stable identity fields', async () => {
    const result: VersionMergeResult = {
      status: 'conflicted',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [
        {
          conflictId: 'conflict:cell:sheet-1:B1:value',
          conflictDigest: 'sha256:merge-conflict-digest',
          conflictKind: 'same-property',
          structural: {
            kind: 'metadata',
            changeId: 'merge-conflict-1',
            domain: 'cell',
            entityId: 'sheet-1!B1',
            propertyPath: ['value'],
          },
          base: { kind: 'value', value: 'base' },
          ours: { kind: 'value', value: 'ours' },
          theirs: { kind: 'value', value: 'theirs' },
          resolutionOptions: [
            resolutionOption('acceptOurs', 'ours'),
            resolutionOption('acceptTheirs', 'theirs'),
            resolutionOption('acceptBase', 'base'),
          ],
        },
      ],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
    const merge = jest.fn(async () => result);
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toStrictEqual({
      ok: true,
      value: result,
    });
  });

  it.each(['fastForward', 'alreadyMerged'] as const)(
    'passes through provider %s ancestry previews',
    async (status) => {
      const result: VersionMergeResult = {
        status,
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        changes: [],
        conflicts: [],
        diagnostics: [],
        mutationGuarantee: 'preview-only',
      };
      const merge = jest.fn(async () => result);
      const version = workbookVersionWithMergeService(merge);

      await expect(
        version.merge({ base: BASE, ours: OURS, theirs: THEIRS }),
      ).resolves.toStrictEqual({
        ok: true,
        value: result,
      });
    },
  );

  it('blocks provider ancestry previews that include merge changes', async () => {
    const merge = jest.fn(async () => ({
      status: 'fastForward',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
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
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });
  });

  it.each(['conflictId', 'conflictDigest', 'resolutionOptions'] as const)(
    'blocks provider conflicts without %s',
    async (missingField) => {
      const conflict: Record<string, unknown> = {
        conflictId: 'conflict:cell:sheet-1:B1:value',
        conflictDigest: 'sha256:merge-conflict-digest',
        conflictKind: 'same-property',
        structural: {
          kind: 'metadata',
          changeId: 'merge-conflict-1',
          domain: 'cell',
          entityId: 'sheet-1!B1',
          propertyPath: ['value'],
        },
        base: { kind: 'value', value: 'base' },
        ours: { kind: 'value', value: 'ours' },
        theirs: { kind: 'value', value: 'theirs' },
        resolutionOptions: [
          resolutionOption('acceptOurs', 'ours'),
          resolutionOption('acceptTheirs', 'theirs'),
          resolutionOption('acceptBase', 'base'),
        ],
      };
      delete conflict[missingField];

      const merge = jest.fn(async () => ({
        status: 'conflicted',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        changes: [],
        conflicts: [conflict],
        diagnostics: [],
        mutationGuarantee: 'preview-only',
      }));
      const version = workbookVersionWithMergeService(merge);

      await expect(
        version.merge({ base: BASE, ours: OURS, theirs: THEIRS }),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.merge',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_INVALID_COMMIT_PAYLOAD',
              data: expect.objectContaining({ redacted: true }),
            }),
          ],
        },
      });
    },
  );

  it('blocks provider conflicts without the complete first-slice resolution option set', async () => {
    const merge = jest.fn(async () => ({
      status: 'conflicted',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [
        {
          conflictId: 'conflict:cell:sheet-1:B1:value',
          conflictDigest: 'sha256:merge-conflict-digest',
          conflictKind: 'same-property',
          structural: {
            kind: 'metadata',
            changeId: 'merge-conflict-1',
            domain: 'cell',
            entityId: 'sheet-1!B1',
            propertyPath: ['value'],
          },
          base: { kind: 'value', value: 'base' },
          ours: { kind: 'value', value: 'ours' },
          theirs: { kind: 'value', value: 'theirs' },
          resolutionOptions: [
            resolutionOption('acceptOurs', 'ours'),
            resolutionOption('acceptTheirs', 'theirs'),
          ],
        },
      ],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    }));
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });
  });

  it('returns a blocked preview result when merge input is malformed', async () => {
    const merge = jest.fn();
    const version = workbookVersionWithMergeService(merge);

    await expect(
      version.merge({ base: 'not-a-commit', ours: OURS, theirs: THEIRS } as any),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: [expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' })],
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('reports merge as pending when no merge service is attached', async () => {
    const version = new WorkbookVersionImpl({ versioning: {} } as any);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
        diagnostics: [expect.objectContaining({ code: 'VERSION_MERGE_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(version.getStatus()).resolves.toMatchObject({
      merge: {
        stage: 'pending',
        available: false,
      },
    });
  });
});

function resolutionOption(kind: 'acceptOurs' | 'acceptTheirs' | 'acceptBase', value: string) {
  return {
    optionId: `option:${kind}`,
    conflictId: 'conflict:cell:sheet-1:B1:value',
    kind,
    value: { kind: 'value', value },
    recalcRequired: true,
  };
}

function workbookVersionWithMergeService(merge: unknown) {
  return new WorkbookVersionImpl({
    versioning: {
      mergeService: { merge },
      ...versionDomainSupportManifestRuntime(),
    },
  } as any);
}
