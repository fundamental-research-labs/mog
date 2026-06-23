import { jest } from '@jest/globals';
import type { VersionRevertInput, VersionRevertResult } from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import {
  VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_HISTORY_GAP_DIAGNOSTIC_CODE,
  VERSION_REVERT_OPAQUE_DOMAIN_DIAGNOSTIC_CODE,
  VERSION_REVERT_PENDING_PROVIDER_WRITES_DIAGNOSTIC_CODE,
  VERSION_REVERT_REVIEW_INVALIDATION_DIAGNOSTIC_CODE,
  VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
  VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE,
} from '../version-revert';

const COMMIT_A = `commit:sha256:${'a'.repeat(64)}` as const;
const COMMIT_B = `commit:sha256:${'b'.repeat(64)}` as const;
const COMMIT_C = `commit:sha256:${'c'.repeat(64)}` as const;
const COMMIT_D = `commit:sha256:${'d'.repeat(64)}` as const;
const MAIN_REF = 'refs/heads/main' as const;
const MAIN_REVISION = { kind: 'counter', value: '7' } as const;
const STALE_MAIN_REVISION = { kind: 'counter', value: '8' } as const;

describe('WorkbookVersion VC-07/00 revert semantics', () => {
  it.each([
    {
      label: 'single commit',
      input: singleCommitInput(),
      payload: { targetKind: 'commit', mainlineParent: null },
    },
    {
      label: 'commit range',
      input: {
        target: { kind: 'range', baseCommitId: COMMIT_A, headCommitId: COMMIT_B },
      } satisfies VersionRevertInput,
      payload: { targetKind: 'range', mainlineParent: null },
    },
    {
      label: 'merge commit with first-parent mainline',
      input: {
        target: { kind: 'mergeCommit', commitId: COMMIT_C, mainlineParent: 1 },
      } satisfies VersionRevertInput,
      payload: { targetKind: 'mergeCommit', mainlineParent: 1 },
    },
    {
      label: 'merge commit with second-parent mainline',
      input: {
        target: { kind: 'mergeCommit', commitId: COMMIT_C, mainlineParent: 2 },
      } satisfies VersionRevertInput,
      payload: { targetKind: 'mergeCommit', mainlineParent: 2 },
    },
  ])(
    'admits $label target semantics before the disabled revert boundary',
    async ({ input, payload }) => {
      const { version, mutationGuards } = versionWithMutationGuards(
        {},
        { attachRevertService: false },
      );

      const result = await version.revert(input, { dryRun: true, includeDiagnostics: true });

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.revert',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
              data: expect.objectContaining({
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  operation: 'revert',
                  dependency: 'upstreamRevertContract',
                  targetKind: payload.targetKind,
                  dryRun: true,
                }),
              }),
            }),
            expect.objectContaining({
              code: VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
              data: expect.objectContaining({
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  operation: 'revert',
                  ...payload,
                }),
              }),
            }),
          ]),
        },
      });
      expect(expectDiagnosticCodes(result)).not.toContain('VERSION_INVALID_OPTIONS');
      expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
    },
  );

  it.each([
    {
      label: 'single commit target with range field',
      input: {
        target: { kind: 'commit', commitId: COMMIT_A, baseCommitId: COMMIT_B },
      },
      option: 'target.baseCommitId',
    },
    {
      label: 'range target with single-commit field',
      input: {
        target: {
          kind: 'range',
          baseCommitId: COMMIT_A,
          headCommitId: COMMIT_B,
          commitId: COMMIT_C,
        },
      },
      option: 'target.commitId',
    },
    {
      label: 'merge commit target with range field',
      input: {
        target: {
          kind: 'mergeCommit',
          commitId: COMMIT_C,
          mainlineParent: 1,
          baseCommitId: COMMIT_A,
        },
      },
      option: 'target.baseCommitId',
    },
    {
      label: 'merge commit target without mainline',
      input: {
        target: { kind: 'mergeCommit', commitId: COMMIT_C },
      },
      option: 'target.mainlineParent',
    },
    {
      label: 'merge commit target with zero mainline',
      input: {
        target: { kind: 'mergeCommit', commitId: COMMIT_C, mainlineParent: 0 },
      },
      option: 'target.mainlineParent',
    },
    {
      label: 'merge commit target with fractional mainline',
      input: {
        target: { kind: 'mergeCommit', commitId: COMMIT_C, mainlineParent: 1.5 },
      },
      option: 'target.mainlineParent',
    },
  ])('rejects $label before provider access or ref mutation', async ({ input, option }) => {
    const { version, mutationGuards } = versionWithMutationGuards();

    const result = await version.revert(input as VersionRevertInput, {
      includeDiagnostics: true,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.revert',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                option,
              }),
            }),
          }),
        ]),
      },
    });
    expect(expectDiagnosticCodes(result)).not.toContain(VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE);
    expect(expectDiagnosticCodes(result)).not.toContain(
      VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
    );
    expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
  });

  it('rejects stale target refs without attempting revert, commit, or ref mutation', async () => {
    const { version, mutationGuards } = versionWithMutationGuards(
      {},
      { attachRevertService: false },
    );

    const result = await version.revert(
      {
        ...singleCommitInput(),
        targetRef: MAIN_REF,
        expectedTargetHead: { commitId: COMMIT_B, revision: MAIN_REVISION },
        preflight: {
          staleHead: {
            refName: MAIN_REF,
            expectedCommitId: COMMIT_B,
            actualCommitId: COMMIT_C,
          },
        },
      },
      { includeDiagnostics: true },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.revert',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                refName: MAIN_REF,
                expectedCommitId: COMMIT_B,
                actualCommitId: COMMIT_C,
              }),
            }),
          }),
          expect.objectContaining({
            code: VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                refName: MAIN_REF,
                reason: 'target-ref-cas',
                expectedHeadProvided: true,
              }),
            }),
          }),
        ]),
      },
    });
    expect(expectDiagnosticCodes(result)).not.toContain('VERSION_INVALID_OPTIONS');
    expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
  });
});

describe('WorkbookVersion revert provider recovery semantics', () => {
  it('delegates merge commit revert with the selected mainline parent', async () => {
    const input = {
      target: { kind: 'mergeCommit', commitId: COMMIT_C, mainlineParent: 2 },
      targetRef: MAIN_REF,
      expectedTargetHead: { commitId: COMMIT_B, revision: MAIN_REVISION },
      reason: 'undo-merge',
    } satisfies VersionRevertInput;
    const providerResult: VersionRevertResult = {
      schemaVersion: 1,
      status: 'applied',
      target: input.target,
      commitRef: {
        id: COMMIT_D,
        refName: MAIN_REF,
        refRevision: STALE_MAIN_REVISION,
      },
      reviewInvalidationIds: ['review-merge-2'],
      diagnostics: [],
      mutationGuarantee: 'revert-commit-created',
    };
    const revert = jest.fn(async () => providerResult);
    const readRef = jest.fn(async () => ({
      ref: { name: MAIN_REF, commitId: COMMIT_B, revision: MAIN_REVISION },
    }));
    const version = workbookVersionWithRevertService(revert, { readService: { readRef } });

    await expect(version.revert(input, { includeDiagnostics: true })).resolves.toStrictEqual({
      ok: true,
      value: providerResult,
    });
    expect(readRef).toHaveBeenCalledWith(MAIN_REF);
    expect(revert).toHaveBeenCalledWith(input, { includeDiagnostics: true });
  });

  it('preserves range revert conflict diagnostics returned by the provider', async () => {
    const input = {
      target: { kind: 'range', baseCommitId: COMMIT_A, headCommitId: COMMIT_C },
    } satisfies VersionRevertInput;
    const revert = jest.fn(async () => ({
      schemaVersion: 1,
      status: 'requires-review',
      target: input.target,
      diagnostics: [
        {
          issueCode: 'VERSION_REVERT_CONFLICT',
          severity: 'error',
          recoverability: 'retry',
          messageTemplateId: 'version.revert.VERSION_REVERT_CONFLICT',
          safeMessage: 'Range revert requires conflict review.',
          payload: {
            operation: 'revert',
            conflictKind: 'same-property',
            rangeConflictCount: 2,
            secret: 'do-not-leak',
          },
          redacted: true,
          mutationGuarantee: 'ref-not-mutated',
        },
      ],
      mutationGuarantee: 'ref-not-mutated',
    }));
    const version = workbookVersionWithRevertService(revert);

    const result = await version.revert(input, { dryRun: true });
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'requires-review',
        target: input.target,
        diagnostics: [
          expect.objectContaining({
            issueCode: 'VERSION_REVERT_CONFLICT',
            recoverability: 'retry',
            safeMessage: 'Range revert requires conflict review.',
            payload: expect.objectContaining({
              operation: 'revert',
              targetKind: 'range',
              conflictKind: 'same-property',
              rangeConflictCount: 2,
            }),
            mutationGuarantee: 'ref-not-mutated',
          }),
        ],
        mutationGuarantee: 'ref-not-mutated',
      },
    });
    expect(JSON.stringify(result)).not.toContain('do-not-leak');
    expect(revert).toHaveBeenCalledTimes(1);
  });

  it('blocks apply when the target ref moved after a dry-run preview', async () => {
    const input = {
      target: { kind: 'commit', commitId: COMMIT_A },
      targetRef: MAIN_REF,
      expectedTargetHead: { commitId: COMMIT_B, revision: MAIN_REVISION },
    } satisfies VersionRevertInput;
    const preview: VersionRevertResult = {
      schemaVersion: 1,
      status: 'planned',
      target: input.target,
      diagnostics: [],
      mutationGuarantee: 'no-write-attempted',
    };
    const revert = jest.fn(async () => preview);
    const readRef = jest.fn(async () => ({
      ref: { name: MAIN_REF, commitId: COMMIT_C, revision: STALE_MAIN_REVISION },
    }));
    const version = workbookVersionWithRevertService(revert, { readService: { readRef } });

    await expect(version.revert(input, { dryRun: true })).resolves.toStrictEqual({
      ok: true,
      value: preview,
    });
    const stale = await version.revert(input, { includeDiagnostics: true });

    expect(stale).toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.revert',
        diagnostics: [
          expect.objectContaining({
            code: VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'ref-not-mutated',
              payload: expect.objectContaining({
                operation: 'revert',
                reason: 'staleTargetHead',
                refName: MAIN_REF,
                expectedCommitId: COMMIT_B,
                actualCommitId: COMMIT_C,
                expectedRevision: MAIN_REVISION.value,
                actualRevision: STALE_MAIN_REVISION.value,
              }),
            }),
          }),
        ],
      },
    });
    expect(revert).toHaveBeenCalledTimes(1);
    expect(readRef).toHaveBeenCalledTimes(1);
  });

  it('blocks provider revert while pending remote writes are waiting for promotion', async () => {
    const revert = jest.fn(async () => ({
      schemaVersion: 1,
      status: 'planned',
      target: singleCommitInput().target,
      diagnostics: [],
      mutationGuarantee: 'no-write-attempted',
    }));
    const version = workbookVersionWithRevertService(revert, {
      surfaceStatusService: { readDirtyStatus: pendingProviderWritesDirtyStatus },
    });

    await expect(version.revert(singleCommitInput())).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: VERSION_REVERT_PENDING_PROVIDER_WRITES_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                reason: 'pendingProviderWrites',
                pendingRemoteSegmentCount: 2,
                remoteSyncApplyActiveCount: 1,
              }),
            }),
          }),
        ],
      },
    });
    expect(revert).not.toHaveBeenCalled();
  });
});

describe('WorkbookVersion revert facade disabled admission', () => {
  it.each([
    {
      label: 'versionControl feature gate',
      ctx: { featureGates: { capabilities: { versionControl: false } } },
      message: 'The versionControl feature gate is disabled for this workbook.',
      reason: 'versionControlDisabled',
    },
    {
      label: 'editing feature gate',
      ctx: { featureGates: { editing: false } },
      message: 'Workbook editing is disabled by host feature gates.',
      reason: 'editingDisabled',
    },
  ])(
    'blocks revert before provider access when disabled by $label',
    async ({ ctx, message, reason }) => {
      const revert = jest.fn();
      const version = new WorkbookVersionImpl({
        ...ctx,
        versioning: { revertService: { revert } },
      } as any);

      await expect(version.revert(singleCommitInput())).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.revert',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CAPABILITY_DISABLED',
              message,
              data: expect.objectContaining({
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  operation: 'revert',
                  capability: 'version:revert',
                  reason,
                }),
              }),
            }),
          ],
        },
      });
      expect(revert).not.toHaveBeenCalled();
    },
  );

  it('rejects host-disabled revert capability before provider access or ref mutation', async () => {
    const { version, mutationGuards } = versionWithMutationGuards({
      hostPolicy: {
        decisions: [{ capability: 'version:revert', decision: 'denied' }],
      },
    });

    const result = await version.revert(singleCommitInput(), { includeDiagnostics: true });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.revert',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CAPABILITY_DISABLED',
            message: 'Host policy denies version:revert.',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                capability: 'version:revert',
                reason: 'hostCapabilityDenied',
              }),
            }),
          }),
        ],
      },
    });
    expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
  });

  it('rejects unsupported merge-domain revert without attempting commit or ref mutation', async () => {
    const { version, mutationGuards } = versionWithMutationGuards();

    const result = await version.revert(
      {
        ...singleCommitInput(),
        preflight: {
          unsupportedDomains: [
            {
              domain: 'view-state',
              matrixRowId: 'view-state.selection-scroll',
              reason: 'unsupportedMergeDomain',
            },
          ],
        },
      },
      { dryRun: true, includeDiagnostics: true },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.revert',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                domain: 'view-state',
                matrixRowId: 'view-state.selection-scroll',
                reason: 'unsupportedMergeDomain',
              }),
            }),
          }),
        ]),
      },
    });
    expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
  });

  it('redacts failure diagnostics and omits caller-only revert details while leaving refs untouched', async () => {
    const { version, mutationGuards } = versionWithMutationGuards(
      {},
      { attachRevertService: false },
    );
    const callerOnlyRequestId = 'client-request-secret-123';
    const callerOnlyReason = 'sensitive revert narrative';
    const privateTargetRef = 'refs/heads/review/private-revert-subject';

    const result = await version.revert(
      {
        ...singleCommitInput(),
        targetRef: privateTargetRef as any,
        clientRequestId: callerOnlyRequestId,
        reason: callerOnlyReason,
      },
      { includeDiagnostics: true },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.revert',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              redacted: true,
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
          expect.objectContaining({
            code: VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              redacted: true,
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain(callerOnlyRequestId);
    expect(JSON.stringify(result)).not.toContain(callerOnlyReason);
    expect(JSON.stringify(result)).not.toContain(privateTargetRef);
    expect(JSON.stringify(result)).not.toContain(COMMIT_A);
    expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
  });

  it.each([
    {
      label: 'unsupported domains',
      input: {
        ...singleCommitInput(),
        preflight: {
          unsupportedDomains: [
            {
              domain: 'pivot-cache',
              matrixRowId: 'pivot-cache.records',
              reason: 'unsupportedDetectedDomain',
            },
          ],
        },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE,
      payload: {
        domain: 'pivot-cache',
        matrixRowId: 'pivot-cache.records',
        reason: 'unsupportedDetectedDomain',
      },
    },
    {
      label: 'opaque domains',
      input: {
        ...singleCommitInput(),
        preflight: {
          opaqueDomains: [
            {
              domain: 'external-links',
              matrixRowId: 'external-links.package-fidelity',
              reason: 'opaqueDomain',
            },
          ],
        },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_OPAQUE_DOMAIN_DIAGNOSTIC_CODE,
      payload: {
        domain: 'external-links',
        matrixRowId: 'external-links.package-fidelity',
        reason: 'opaqueDomain',
      },
    },
    {
      label: 'history gaps',
      input: {
        ...singleCommitInput(),
        preflight: {
          gaps: [{ gapId: 'gap:legacy-import:1', reason: 'known-gap' }],
        },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_HISTORY_GAP_DIAGNOSTIC_CODE,
      payload: { gapId: 'gap:legacy-import:1', reason: 'known-gap' },
    },
    {
      label: 'target ref CAS',
      input: {
        ...singleCommitInput(),
        targetRef: MAIN_REF,
        expectedTargetHead: { commitId: COMMIT_B, revision: MAIN_REVISION },
        preflight: {
          cas: {
            refName: MAIN_REF,
            expectedRevision: MAIN_REVISION,
            reason: 'target-ref-cas',
          },
        },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
      payload: { refName: MAIN_REF, reason: 'target-ref-cas', expectedHeadProvided: true },
    },
    {
      label: 'review invalidation',
      input: {
        ...singleCommitInput(),
        preflight: {
          reviewInvalidation: [
            {
              reviewId: 'review-1',
              expectedRevision: 3,
              reason: 'reverted-subject',
            },
          ],
        },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_REVIEW_INVALIDATION_DIAGNOSTIC_CODE,
      payload: { reviewId: 'review-1', expectedRevision: 3, reason: 'reverted-subject' },
    },
  ])(
    'rejects $label with stable diagnostics while revert is unavailable',
    async ({ input, code, payload }) => {
      const revert = jest.fn();
      const version = new WorkbookVersionImpl({
        versioning: {},
      } as any);

      await expect(
        version.revert(input, { dryRun: true, includeDiagnostics: true }),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.revert',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
              data: expect.objectContaining({
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  operation: 'revert',
                  dependency: 'upstreamRevertContract',
                  dryRun: true,
                }),
              }),
            }),
            expect.objectContaining({
              code,
              data: expect.objectContaining({
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  operation: 'revert',
                  ...payload,
                }),
              }),
            }),
          ]),
        },
      });
      expect(revert).not.toHaveBeenCalled();
    },
  );
});

function singleCommitInput(): VersionRevertInput {
  return {
    target: { kind: 'commit', commitId: COMMIT_A },
  };
}

function workbookVersionWithRevertService(
  revert: ReturnType<typeof jest.fn>,
  versioning: Record<string, unknown> = {},
): WorkbookVersionImpl {
  return new WorkbookVersionImpl({
    versioning: {
      ...versioning,
      revertService: { revert },
    },
  } as any);
}

function pendingProviderWritesDirtyStatus() {
  return {
    statusRevision: 'dirty:pending-remote:2',
    checkoutPreflightToken: 'preflight:pending-remote:2',
    hasUncommittedLocalChanges: false,
    commitEligibleChanges: false,
    unsupportedDirtyDomains: [],
    pendingProviderWrites: true,
    pendingRecalc: false,
    checkoutSafe: false,
    unsafeReasons: [
      {
        code: 'version.surfaceStatus.pendingProviderWrites',
        severity: 'error',
        message: 'Pending provider writes are waiting for promotion.',
        data: {
          pendingRemoteSegmentCount: 2,
          remoteSyncApplyActiveCount: 1,
          pendingRemotePromotionActiveCount: 0,
          pendingRemotePromotionQueuedCount: 0,
        },
      },
    ],
    source: 'VC-05',
    diagnostics: [],
  };
}

function versionWithMutationGuards(
  ctx: Record<string, unknown> = {},
  options: { readonly attachRevertService?: boolean } = {},
) {
  const mutationGuards = {
    revert: jest.fn(),
    commit: jest.fn(),
    createBranch: jest.fn(),
    fastForwardBranch: jest.fn(),
    updateBranch: jest.fn(),
    deleteBranch: jest.fn(),
    deleteRef: jest.fn(),
    fastForwardRef: jest.fn(),
    updateRef: jest.fn(),
  };
  const version = new WorkbookVersionImpl({
    ...ctx,
    versioning: {
      ...(options.attachRevertService === false
        ? {}
        : { revertService: { revert: mutationGuards.revert } }),
      writeService: { commit: mutationGuards.commit },
      branchService: {
        createBranch: mutationGuards.createBranch,
        fastForwardBranch: mutationGuards.fastForwardBranch,
        updateBranch: mutationGuards.updateBranch,
        deleteBranch: mutationGuards.deleteBranch,
        deleteRef: mutationGuards.deleteRef,
      },
      refLifecycleService: {
        createBranch: mutationGuards.createBranch,
        fastForwardBranch: mutationGuards.fastForwardBranch,
        updateBranch: mutationGuards.updateBranch,
        deleteBranch: mutationGuards.deleteBranch,
        deleteRef: mutationGuards.deleteRef,
      },
      refAdmin: {
        fastForwardRef: mutationGuards.fastForwardRef,
        updateRef: mutationGuards.updateRef,
        deleteRef: mutationGuards.deleteRef,
      },
    },
  } as any);

  return { version, mutationGuards: Object.values(mutationGuards) };
}

function expectDiagnosticCodes(
  result: Awaited<ReturnType<WorkbookVersionImpl['revert']>>,
): readonly string[] {
  expect(result).toMatchObject({ ok: false });
  if (result.ok) throw new Error('expected revert failure');
  return result.error.diagnostics.map((diagnostic) => diagnostic.code);
}

function expectFailureDiagnosticsRedactedNoWrite(
  result: Awaited<ReturnType<WorkbookVersionImpl['revert']>>,
  mutationGuards: readonly ReturnType<typeof jest.fn>[],
): void {
  expect(result).toMatchObject({ ok: false });
  if (result.ok) throw new Error('expected revert failure');

  for (const diagnostic of result.error.diagnostics) {
    expect(diagnostic.data).toMatchObject({
      operation: 'revert',
      redacted: true,
      mutationGuarantee: 'no-write-attempted',
    });
    expect(diagnostic.data?.payload).toMatchObject({ operation: 'revert' });
  }
  for (const mutation of mutationGuards) {
    expect(mutation).not.toHaveBeenCalled();
  }
}
