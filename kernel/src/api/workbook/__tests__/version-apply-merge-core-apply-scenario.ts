import { expect, it, jest } from '@jest/globals';

import type { VersionMergeResult } from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import {
  BASE,
  DIGEST_A,
  DIGEST_B,
  EXPECTED_TARGET_HEAD,
  MERGE,
  metadata,
  OURS,
  TARGET_REF,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';
import { createWorkbookVersionSurfaceStatusService } from '../version/surface-status/version-surface-status-service';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';

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

  it('materializes the active checkout target ref during clean merge apply when requested', async () => {
    const branchName = 'scenario/direct-active-merge';
    const branchRef = `refs/heads/${branchName}` as const;
    const activeRevision = { kind: 'counter' as const, value: '5' };
    const mergeRevision = { kind: 'counter' as const, value: '6' };
    let currentBranchHead = OURS;
    let currentBranchRevision = activeRevision;
    const result: VersionMergeResult = {
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [
        {
          structural: metadata('merge-change-materialized-active-branch', 'sheet-1!B2'),
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
      currentBranchRevision = mergeRevision;
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
    const checkout = jest.fn(async () => {
      surfaceStatusService.recordCheckoutMaterialization({
        strategy: 'fullSnapshot',
        commitId: MERGE,
        resolvedTarget: {
          kind: 'ref',
          refName: branchName,
          commitId: MERGE,
          refVersion: mergeRevision,
          refIncarnationId: 'ref-incarnation:direct-active-merge',
        },
        snapshotRoot: {},
        plan: {
          strategy: 'fullSnapshot',
          resolvedTarget: {
            kind: 'ref',
            refName: branchName,
            commitId: MERGE,
            refVersion: mergeRevision,
            refIncarnationId: 'ref-incarnation:direct-active-merge',
          },
          commitId: MERGE,
          parentCommitIds: [OURS, THEIRS],
          snapshotRootDigest: DIGEST_A,
          semanticChangeSetDigest: DIGEST_B,
          mutationSegmentDigests: [],
          requiredDependencies: [],
          requiredDependencyDigests: [],
        },
      } as never);
      return {
        ok: true,
        materialization: 'applied',
        plan: {
          strategy: 'fullSnapshot',
          resolvedTarget: {
            kind: 'ref',
            refName: branchName,
            commitId: MERGE,
            refVersion: mergeRevision,
            refIncarnationId: 'ref-incarnation:direct-active-merge',
          },
          commitId: MERGE,
          parentCommitIds: [OURS, THEIRS],
          snapshotRootDigest: DIGEST_A,
          semanticChangeSetDigest: DIGEST_B,
          mutationSegmentDigests: [],
          requiredDependencies: [],
          requiredDependencyDigests: [],
        },
        diagnostics: [],
        mutationGuarantee: 'workbook-state-materialized',
      };
    });
    let transactionSequence = 0;
    const checkoutTransactionGuard = {
      beginCheckoutTransaction: jest.fn(() => ({
        ok: true as const,
        token: { id: ++transactionSequence },
      })),
      endCheckoutTransaction: jest.fn(),
    };
    const version = new WorkbookVersionImpl(
      {
        versioning: {
          mergeService: { merge },
          readService: { readRef },
          surfaceStatusService,
          writeService: { mergeCommit },
          checkoutService: { checkout },
          ...versionDomainSupportManifestRuntime(),
        },
      } as any,
      { checkoutTransactionGuard },
    );

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        {
          targetRef: branchRef,
          expectedTargetHead: {
            commitId: OURS,
            revision: activeRevision,
          },
          materializeActiveCheckout: true,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'applied',
        commitRef: {
          id: MERGE,
          refName: branchRef,
        },
      },
    });
    expect(checkoutTransactionGuard.beginCheckoutTransaction).toHaveBeenCalledTimes(2);
    expect(checkoutTransactionGuard.endCheckoutTransaction).toHaveBeenCalledTimes(2);
    expect(checkout).toHaveBeenCalledWith({ target: 'ref', refName: branchName });
    expect(surfaceStatusService.readActiveCheckoutSession()).toMatchObject({
      checkedOutCommitId: MERGE,
      branchName,
      refHeadAtMaterialization: MERGE,
      detached: false,
    });
    await expect(version.getSurfaceStatus()).resolves.toMatchObject({
      current: {
        checkedOutCommitId: MERGE,
        branchName,
        currentRefHeadId: MERGE,
        stale: false,
      },
    });
    expect(activeCheckoutStateChanges).toEqual([
      expect.objectContaining({
        activeCheckoutSession: expect.objectContaining({
          checkedOutCommitId: OURS,
          branchName,
        }),
        previousActiveCheckoutSession: null,
        statusRevision: 1,
        reason: 'branch-head-advanced',
      }),
      expect.objectContaining({
        activeCheckoutSession: expect.objectContaining({
          checkedOutCommitId: MERGE,
          branchName,
        }),
        previousActiveCheckoutSession: expect.objectContaining({
          checkedOutCommitId: OURS,
          branchName,
        }),
        statusRevision: 2,
        reason: 'checkout-materialized',
      }),
    ]);
  });

  it('blocks active checkout materialization before merge writes when checkout service is unavailable', async () => {
    const merge = jest.fn();
    const mergeCommit = jest.fn();
    const checkoutTransactionGuard = {
      beginCheckoutTransaction: jest.fn(() => ({
        ok: true as const,
        token: {},
      })),
      endCheckoutTransaction: jest.fn(),
    };
    const version = new WorkbookVersionImpl(
      {
        versioning: {
          mergeService: { merge },
          writeService: { mergeCommit },
          ...versionDomainSupportManifestRuntime(),
        },
      } as any,
      { checkoutTransactionGuard },
    );

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        {
          targetRef: TARGET_REF as any,
          expectedTargetHead: EXPECTED_TARGET_HEAD,
          materializeActiveCheckout: true,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_SERVICE_UNAVAILABLE',
          }),
        ],
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
    expect(checkoutTransactionGuard.beginCheckoutTransaction).not.toHaveBeenCalled();
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
        diagnostics: [expect.objectContaining({ code: 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD' })],
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });
}
