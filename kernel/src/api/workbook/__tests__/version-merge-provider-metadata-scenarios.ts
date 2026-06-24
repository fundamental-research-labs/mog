import { expect, it, jest } from '@jest/globals';

import type {
  VersionMergeChange,
  VersionMergeResult,
  VersionMergeResultId,
} from '@mog-sdk/contracts/api';

import {
  BASE,
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  EXPECTED_TARGET_HEAD,
  invalidCommitPayloadFailureMatcher,
  mergeInput,
  OURS,
  TARGET_REF,
  THEIRS,
  workbookVersionWithMergeService,
} from './version-merge-provider-test-utils';

export function describeMergeProviderMetadataScenarios(): void {
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
      resultId: `merge-result:${DIGEST_A.digest}`,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      applicationPlanDigest: DIGEST_B,
      applyEligibilityDigest: DIGEST_C,
    } as const;
    const merge = jest.fn(async () => result);
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge(mergeInput())).resolves.toStrictEqual({
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

    await expect(version.merge(mergeInput())).resolves.toMatchObject(
      invalidCommitPayloadFailureMatcher(),
    );
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

    await expect(version.merge(mergeInput())).resolves.toMatchObject(
      invalidCommitPayloadFailureMatcher(),
    );
  });

  it('binds clean divergent previews to the target ref, expected head, commit tuple, and status diagnostics', async () => {
    const changes = [
      {
        structural: {
          kind: 'metadata',
          changeId: 'change:ours-a1',
          domain: 'cells.values',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
        },
        base: { kind: 'value', value: 'base-a1' },
        ours: { kind: 'value', value: 'ours-a1' },
        merged: { kind: 'value', value: 'ours-a1' },
      },
      {
        structural: {
          kind: 'metadata',
          changeId: 'change:theirs-b1',
          domain: 'cells.values',
          entityId: 'sheet-1!B1',
          propertyPath: ['value'],
        },
        base: { kind: 'value', value: null },
        theirs: { kind: 'value', value: 'theirs-b1' },
        merged: { kind: 'value', value: 'theirs-b1' },
      },
    ] satisfies readonly VersionMergeChange[];
    const providerResult = {
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes,
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
      previewArtifactDigest: DIGEST_A,
      resultDigest: DIGEST_A,
      attemptPersistence: 'persisted',
      attemptKind: 'reviewOnly',
      resultId: `merge-result:${DIGEST_A.digest}` as VersionMergeResultId,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
    } satisfies VersionMergeResult;
    const merge = jest.fn(async () => providerResult);
    const version = workbookVersionWithMergeService(merge);

    const result = await version.merge(mergeInput(), {
      mode: 'preview',
      includeDiagnostics: true,
      targetRef: TARGET_REF as any,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      persistReviewRecord: true,
    });

    expect(result).toStrictEqual({ ok: true, value: providerResult });
    expect(merge).toHaveBeenCalledWith(mergeInput(), {
      mode: 'preview',
      includeDiagnostics: true,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      persistReviewRecord: true,
    });

    if (!result.ok) throw new Error(`expected merge success: ${result.error.code}`);
    expect(result.value).toMatchObject({
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
    expect(result.value.changes).toEqual([
      expect.objectContaining({
        structural: expect.objectContaining({ changeId: 'change:ours-a1' }),
        ours: { kind: 'value', value: 'ours-a1' },
        merged: { kind: 'value', value: 'ours-a1' },
      }),
      expect.objectContaining({
        structural: expect.objectContaining({ changeId: 'change:theirs-b1' }),
        theirs: { kind: 'value', value: 'theirs-b1' },
        merged: { kind: 'value', value: 'theirs-b1' },
      }),
    ]);

    await expect(version.getStatus()).resolves.toMatchObject({
      merge: {
        stage: 'present',
        available: true,
        dependency: 'version-service',
        diagnostics: [
          expect.objectContaining({
            code: 'version.merge.serviceAttached',
            severity: 'info',
            dependency: 'version-service',
          }),
        ],
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'version.merge.serviceAttached',
          severity: 'info',
          dependency: 'version-service',
        }),
      ]),
    });
  });
}
