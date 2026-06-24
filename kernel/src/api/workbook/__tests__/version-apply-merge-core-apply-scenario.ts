import { expect, it, jest } from '@jest/globals';

import type { VersionMergeResult } from '@mog-sdk/contracts/api';

import {
  BASE,
  EXPECTED_TARGET_HEAD,
  MERGE,
  metadata,
  OURS,
  TARGET_REF,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';
import { createWorkbookVersionSurfaceStatusService } from '../version/surface-status/version-surface-status-service';

export function registerCleanMergeApplyScenario(): void {
  it('applies clean merge plans through a two-parent merge commit write service', async () => {
    const result: VersionMergeResult = {
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [
        {
          structural: metadata('merge-change-a1', 'sheet-1!A1'),
          base: { kind: 'value', value: null },
          ours: { kind: 'value', value: 'ours' },
          theirs: { kind: 'value', value: 'theirs' },
          merged: { kind: 'value', value: 'theirs' },
        },
      ],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
    const merge = jest.fn(async () => result);
    const mergeCommit = jest.fn(async () => ({
      status: 'success',
      commitRef: {
        id: MERGE,
        refName: TARGET_REF,
        resolvedFrom: TARGET_REF,
        refRevision: { kind: 'counter' as const, value: '2' },
      },
      diagnostics: [],
    }));
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      writeService: { mergeCommit },
    });

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'applied',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        commitRef: {
          id: MERGE,
          refName: TARGET_REF,
          resolvedFrom: TARGET_REF,
          refRevision: { kind: 'counter', value: '2' },
        },
        changes: result.changes,
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'merge-commit-created',
      },
    });
    expect(merge).toHaveBeenCalledWith(
      { base: BASE, ours: OURS, theirs: THEIRS },
      { mode: 'preview' },
    );
    expect(mergeCommit).toHaveBeenCalledWith({
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      changes: result.changes,
      resolutionCount: 0,
    });
  });

  it('targets the active checkout branch for implicit clean merge apply writes without materializing the active checkout', async () => {
    const branchRef = 'refs/heads/scenario/direct-active-merge' as const;
    const activeRevision = { kind: 'counter' as const, value: '5' };
    let currentBranchHead = OURS;
    let currentBranchRevision = activeRevision;
    const result: VersionMergeResult = {
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [
        {
          structural: metadata('merge-change-active-branch', 'sheet-1!B2'),
          base: { kind: 'value', value: null },
          ours: { kind: 'value', value: 'ours' },
          theirs: { kind: 'value', value: 'theirs' },
          merged: { kind: 'value', value: 'theirs' },
        },
      ],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
    const activeCheckoutStateChanges: unknown[] = [];
    const surfaceStatusService = createWorkbookVersionSurfaceStatusService({
      readDirtyState: () => ({
        hasUncommittedLocalChanges: false,
        calculationState: 'done',
        checkoutInProgress: false,
        revision: 0,
        contextGeneration: 0,
      }),
      notifyActiveCheckoutStateChanged: (change) => activeCheckoutStateChanges.push(change),
    });
    surfaceStatusService.recordActiveCheckoutBranchCommit({
      commitId: OURS,
      refName: branchRef,
    });
    const readRef = jest.fn(async (name: string) => ({
      status: 'success',
      ref: { name, commitId: currentBranchHead, revision: currentBranchRevision },
    }));
    const merge = jest.fn(async () => result);
    const mergeCommit = jest.fn(async () => {
      currentBranchHead = MERGE;
      currentBranchRevision = { kind: 'counter' as const, value: '6' };
      return {
        status: 'success',
        commitRef: {
          id: MERGE,
          refName: branchRef,
          resolvedFrom: branchRef,
          refRevision: currentBranchRevision,
        },
        diagnostics: [],
      };
    });
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      readService: { readRef },
      surfaceStatusService,
      writeService: { mergeCommit },
    });

    await expect(version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toEqual({
      ok: true,
      value: {
        status: 'applied',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        commitRef: {
          id: MERGE,
          refName: branchRef,
          resolvedFrom: branchRef,
          refRevision: { kind: 'counter', value: '6' },
        },
        changes: result.changes,
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'merge-commit-created',
      },
    });
    expect(mergeCommit).toHaveBeenCalledWith({
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: branchRef,
      expectedTargetHead: {
        commitId: OURS,
        revision: activeRevision,
      },
      changes: result.changes,
      resolutionCount: 0,
    });
    expect(surfaceStatusService.readActiveCheckoutSession()).toMatchObject({
      checkedOutCommitId: OURS,
      branchName: 'scenario/direct-active-merge',
      refHeadAtMaterialization: MERGE,
      detached: false,
    });
    await expect(version.getSurfaceStatus()).resolves.toMatchObject({
      current: {
        checkedOutCommitId: OURS,
        branchName: 'scenario/direct-active-merge',
        refHeadAtMaterialization: MERGE,
        currentRefHeadId: MERGE,
        detached: false,
        stale: true,
        staleReason: 'activeSessionBehind',
      },
    });
    expect(activeCheckoutStateChanges).toEqual([
      expect.objectContaining({
        activeCheckoutSession: expect.objectContaining({
          checkedOutCommitId: OURS,
          branchName: 'scenario/direct-active-merge',
        }),
        previousActiveCheckoutSession: null,
        statusRevision: 1,
        reason: 'branch-head-advanced',
      }),
      expect.objectContaining({
        activeCheckoutSession: expect.objectContaining({
          checkedOutCommitId: OURS,
          branchName: 'scenario/direct-active-merge',
        }),
        previousActiveCheckoutSession: expect.objectContaining({
          checkedOutCommitId: OURS,
          branchName: 'scenario/direct-active-merge',
        }),
        statusRevision: 2,
        reason: 'branch-ref-moved',
      }),
    ]);
  });

  it('blocks implicit clean merge apply writes from detached checkout', async () => {
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
      commitId: OURS,
      resolvedTarget: { kind: 'commit', commitId: OURS },
    } as never);
    const merge = jest.fn();
    const mergeCommit = jest.fn();
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      surfaceStatusService,
      writeService: { mergeCommit },
    });

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'applyMergeGraphWrite',
                reason: 'detachedCheckout',
                option: 'targetRef',
              }),
            }),
          }),
        ],
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
    expect(surfaceStatusService.readActiveCheckoutSession()).toMatchObject({
      checkedOutCommitId: OURS,
      detached: true,
    });
  });

  it('blocks implicit apply writes when the active checkout session is stale', async () => {
    const branchRef = 'refs/heads/scenario/stale-active-merge' as const;
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
      commitId: OURS,
      refName: branchRef,
    });
    const readRef = jest.fn(async (name: string) => ({
      status: 'success',
      ref: { name, commitId: THEIRS, revision: { kind: 'counter' as const, value: '6' } },
    }));
    const merge = jest.fn();
    const mergeCommit = jest.fn();
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      readService: { readRef },
      surfaceStatusService,
      writeService: { mergeCommit },
    });

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({ code: 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD' }),
        ],
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });
}
