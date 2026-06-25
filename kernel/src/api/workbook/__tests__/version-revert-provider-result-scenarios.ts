import { expect, it, jest } from '@jest/globals';
import type { VersionRevertInput, VersionRevertResult } from '@mog-sdk/contracts/api';

import { createWorkbookVersionSurfaceStatusService } from '../version/surface-status/version-surface-status-service';
import {
  COMMIT_A,
  COMMIT_B,
  COMMIT_C,
  COMMIT_D,
  MAIN_REF,
  MAIN_REVISION,
  STALE_MAIN_REVISION,
  workbookVersionWithRevertService,
} from './version-revert-test-utils';

export function registerRevertProviderResultScenarios(): void {
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
      value: {
        ...providerResult,
        commitRef: {
          ...providerResult.commitRef,
          resolvedFrom: MAIN_REF,
        },
      },
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

  it('targets direct active checkout branch for implicit WorkbookVersionImpl revert', async () => {
    const branchRef = 'refs/heads/scenario/direct-active-revert' as const;
    const input = {
      target: { kind: 'commit', commitId: COMMIT_A },
      reason: 'direct-active-branch-revert',
    } satisfies VersionRevertInput;
    const providerResult: VersionRevertResult = {
      schemaVersion: 1,
      status: 'applied',
      target: input.target,
      commitRef: {
        id: COMMIT_D,
      },
      reviewInvalidationIds: [],
      diagnostics: [],
      mutationGuarantee: 'revert-commit-created',
    };
    const publicResult: VersionRevertResult = {
      ...providerResult,
      commitRef: {
        id: COMMIT_D,
        refName: branchRef,
        resolvedFrom: branchRef,
      },
    };
    const surfaceStatusService = createWorkbookVersionSurfaceStatusService({
      readDirtyState: () => ({
        hasUncommittedLocalChanges: false,
        calculationState: 'done',
        checkoutInProgress: false,
        revision: 0,
        contextGeneration: 0,
      }),
    });
    surfaceStatusService.recordActiveCheckoutBranchCommit({
      commitId: COMMIT_B,
      refName: branchRef,
    });
    const revert = jest.fn(async () => providerResult);
    const readRef = jest.fn(async (name: string) => ({
      status: 'success',
      ref: { name, commitId: COMMIT_B, revision: MAIN_REVISION },
    }));
    const version = workbookVersionWithRevertService(revert, {
      readService: { readRef },
      surfaceStatusService,
    });

    await expect(version.revert(input)).resolves.toStrictEqual({
      ok: true,
      value: publicResult,
    });
    expect(revert).toHaveBeenCalledWith(
      {
        ...input,
        targetRef: branchRef,
        expectedTargetHead: { commitId: COMMIT_B, revision: MAIN_REVISION },
      },
      {},
    );
    expect(readRef).toHaveBeenCalledWith(branchRef);
    expect(surfaceStatusService.readActiveCheckoutSession()).toMatchObject({
      checkedOutCommitId: COMMIT_D,
      branchName: 'scenario/direct-active-revert',
      refHeadAtMaterialization: COMMIT_D,
      detached: false,
    });
  });

  it('adds target ref preconditions and public commit ref metadata for explicit target ref revert', async () => {
    const input = {
      target: { kind: 'commit', commitId: COMMIT_A },
      targetRef: MAIN_REF,
      reason: 'explicit-target-ref-revert',
    } satisfies VersionRevertInput;
    const providerResult: VersionRevertResult = {
      schemaVersion: 1,
      status: 'applied',
      target: input.target,
      commitRef: {
        id: COMMIT_D,
      },
      reviewInvalidationIds: [],
      diagnostics: [],
      mutationGuarantee: 'revert-commit-created',
    };
    const revert = jest.fn(async () => providerResult);
    const readRef = jest.fn(async () => ({
      status: 'success',
      ref: { name: MAIN_REF, commitId: COMMIT_B, revision: MAIN_REVISION },
    }));
    const version = workbookVersionWithRevertService(revert, { readService: { readRef } });

    await expect(version.revert(input)).resolves.toStrictEqual({
      ok: true,
      value: {
        ...providerResult,
        commitRef: {
          id: COMMIT_D,
          refName: MAIN_REF,
          resolvedFrom: MAIN_REF,
        },
      },
    });
    expect(revert).toHaveBeenCalledWith(
      {
        ...input,
        expectedTargetHead: { commitId: COMMIT_B, revision: MAIN_REVISION },
      },
      {},
    );
    expect(readRef).toHaveBeenCalledWith(MAIN_REF);
  });

  it('allows explicit target ref revert when the active checkout session is stale', async () => {
    const branchRef = 'refs/heads/scenario/stale-explicit-revert' as const;
    const input = {
      target: { kind: 'mergeCommit', commitId: COMMIT_C, mainlineParent: 1 },
      targetRef: branchRef,
      expectedTargetHead: { commitId: COMMIT_C, revision: STALE_MAIN_REVISION },
      reason: 'explicit-stale-active-revert',
    } satisfies VersionRevertInput;
    const providerResult: VersionRevertResult = {
      schemaVersion: 1,
      status: 'applied',
      target: input.target,
      commitRef: {
        id: COMMIT_D,
      },
      reviewInvalidationIds: [],
      diagnostics: [],
      mutationGuarantee: 'revert-commit-created',
    };
    const surfaceStatusService = createWorkbookVersionSurfaceStatusService({
      readDirtyState: () => ({
        hasUncommittedLocalChanges: false,
        calculationState: 'done',
        checkoutInProgress: false,
        revision: 0,
        contextGeneration: 0,
      }),
    });
    surfaceStatusService.recordActiveCheckoutBranchCommit({
      commitId: COMMIT_B,
      refName: branchRef,
    });
    const revert = jest.fn(async () => providerResult);
    const readRef = jest.fn(async (name: string) => ({
      status: 'success',
      ref: { name, commitId: COMMIT_C, revision: STALE_MAIN_REVISION },
    }));
    const version = workbookVersionWithRevertService(revert, {
      readService: { readRef },
      surfaceStatusService,
    });

    await expect(version.revert(input)).resolves.toStrictEqual({
      ok: true,
      value: {
        ...providerResult,
        commitRef: {
          id: COMMIT_D,
          refName: branchRef,
          resolvedFrom: branchRef,
        },
      },
    });
    expect(revert).toHaveBeenCalledWith(input, {});
    expect(surfaceStatusService.readActiveCheckoutSession()).toMatchObject({
      checkedOutCommitId: COMMIT_B,
      branchName: 'scenario/stale-explicit-revert',
      refHeadAtMaterialization: COMMIT_B,
      detached: false,
    });
  });

  it('blocks detached checkout reverts when no target ref is supplied', async () => {
    const input = {
      target: { kind: 'commit', commitId: COMMIT_A },
      reason: 'detached-checkout-revert',
    } satisfies VersionRevertInput;
    const surfaceStatusService = createWorkbookVersionSurfaceStatusService({
      readDirtyState: () => ({
        hasUncommittedLocalChanges: false,
        calculationState: 'done',
        checkoutInProgress: false,
        revision: 0,
        contextGeneration: 0,
      }),
    });
    surfaceStatusService.recordCheckoutMaterialization({
      commitId: COMMIT_B,
      resolvedTarget: { kind: 'commit', commitId: COMMIT_B },
    } as never);
    const revert = jest.fn();
    const readRef = jest.fn();
    const version = workbookVersionWithRevertService(revert, {
      readService: { readRef },
      surfaceStatusService,
    });

    await expect(version.revert(input)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revertGraphWrite',
                reason: 'detachedCheckout',
                option: 'targetRef',
              }),
            }),
          }),
        ],
      },
    });
    expect(revert).not.toHaveBeenCalled();
    expect(readRef).not.toHaveBeenCalled();
    expect(surfaceStatusService.readActiveCheckoutSession()).toMatchObject({
      checkedOutCommitId: COMMIT_B,
      detached: true,
    });
  });

  it('does not advance active checkout when implicit revert reports a different ref', async () => {
    const branchRef = 'refs/heads/scenario/direct-active-revert-mismatch' as const;
    const input = {
      target: { kind: 'commit', commitId: COMMIT_A },
      reason: 'direct-active-branch-revert-mismatch',
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
      reviewInvalidationIds: [],
      diagnostics: [],
      mutationGuarantee: 'revert-commit-created',
    };
    const surfaceStatusService = createWorkbookVersionSurfaceStatusService({
      readDirtyState: () => ({
        hasUncommittedLocalChanges: false,
        calculationState: 'done',
        checkoutInProgress: false,
        revision: 0,
        contextGeneration: 0,
      }),
    });
    surfaceStatusService.recordActiveCheckoutBranchCommit({
      commitId: COMMIT_B,
      refName: branchRef,
    });
    const revert = jest.fn(async () => providerResult);
    const readRef = jest.fn(async (name: string) => ({
      status: 'success',
      ref: { name, commitId: COMMIT_B, revision: MAIN_REVISION },
    }));
    const version = workbookVersionWithRevertService(revert, {
      readService: { readRef },
      surfaceStatusService,
    });

    await expect(version.revert(input)).resolves.toStrictEqual({
      ok: true,
      value: providerResult,
    });
    expect(revert).toHaveBeenCalledWith(
      {
        ...input,
        targetRef: branchRef,
        expectedTargetHead: { commitId: COMMIT_B, revision: MAIN_REVISION },
      },
      {},
    );
    expect(surfaceStatusService.readActiveCheckoutSession()).toMatchObject({
      checkedOutCommitId: COMMIT_B,
      branchName: 'scenario/direct-active-revert-mismatch',
      refHeadAtMaterialization: COMMIT_B,
      detached: false,
    });
  });
}
