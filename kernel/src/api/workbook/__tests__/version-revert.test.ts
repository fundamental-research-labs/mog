import { jest } from '@jest/globals';
import type { VersionRevertInput } from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import {
  VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_HISTORY_GAP_DIAGNOSTIC_CODE,
  VERSION_REVERT_OPAQUE_DOMAIN_DIAGNOSTIC_CODE,
  VERSION_REVERT_REVIEW_INVALIDATION_DIAGNOSTIC_CODE,
  VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
  VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE,
} from '../version-revert';

const COMMIT_A = `commit:sha256:${'a'.repeat(64)}` as const;
const COMMIT_B = `commit:sha256:${'b'.repeat(64)}` as const;
const COMMIT_C = `commit:sha256:${'c'.repeat(64)}` as const;
const MAIN_REF = 'refs/heads/main' as const;
const MAIN_REVISION = { kind: 'counter', value: '7' } as const;

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
  ])('admits $label target semantics before the disabled revert boundary', async ({ input, payload }) => {
    const { version, mutationGuards } = versionWithMutationGuards();

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
  });

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
    const { version, mutationGuards } = versionWithMutationGuards();

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
  ])('blocks revert before provider access when disabled by $label', async ({ ctx, message, reason }) => {
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
  });

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
    const { version, mutationGuards } = versionWithMutationGuards();
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
  ])('rejects $label with stable diagnostics while revert is unavailable', async ({ input, code, payload }) => {
    const revert = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: { revertService: { revert } },
    } as any);

    await expect(version.revert(input, { dryRun: true, includeDiagnostics: true })).resolves.toMatchObject({
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
  });
});

function singleCommitInput(): VersionRevertInput {
  return {
    target: { kind: 'commit', commitId: COMMIT_A },
  };
}

function versionWithMutationGuards(ctx: Record<string, unknown> = {}) {
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
      revertService: { revert: mutationGuards.revert },
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
