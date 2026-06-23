import { expect, jest } from '@jest/globals';
import type { VersionRevertInput } from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';

export const COMMIT_A = `commit:sha256:${'a'.repeat(64)}` as const;
export const COMMIT_B = `commit:sha256:${'b'.repeat(64)}` as const;
export const COMMIT_C = `commit:sha256:${'c'.repeat(64)}` as const;
export const COMMIT_D = `commit:sha256:${'d'.repeat(64)}` as const;
export const MAIN_REF = 'refs/heads/main' as const;
export const MAIN_REVISION = { kind: 'counter', value: '7' } as const;
export const STALE_MAIN_REVISION = { kind: 'counter', value: '8' } as const;

export function singleCommitInput(): VersionRevertInput {
  return {
    target: { kind: 'commit', commitId: COMMIT_A },
  };
}

export function workbookVersionWithRevertService(
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

export function pendingProviderWritesDirtyStatus() {
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

export function versionWithMutationGuards(
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

export function expectDiagnosticCodes(
  result: Awaited<ReturnType<WorkbookVersionImpl['revert']>>,
): readonly string[] {
  expect(result).toMatchObject({ ok: false });
  if (result.ok) throw new Error('expected revert failure');
  return result.error.diagnostics.map((diagnostic) => diagnostic.code);
}

export function expectFailureDiagnosticsRedactedNoWrite(
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
