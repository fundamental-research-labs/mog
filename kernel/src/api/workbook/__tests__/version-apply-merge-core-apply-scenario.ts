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

  it('targets the active checkout branch for implicit clean merge apply writes', async () => {
    const branchRef = 'refs/heads/scenario/direct-active-merge' as const;
    const activeRevision = { kind: 'counter' as const, value: '5' };
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
      ref: { name, commitId: OURS, revision: activeRevision },
    }));
    const merge = jest.fn(async () => result);
    const mergeCommit = jest.fn(async () => ({
      status: 'success',
      commitRef: {
        id: MERGE,
        refName: branchRef,
        resolvedFrom: branchRef,
        refRevision: { kind: 'counter' as const, value: '6' },
      },
      diagnostics: [],
    }));
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
      checkedOutCommitId: MERGE,
      branchName: 'scenario/direct-active-merge',
      refHeadAtMaterialization: MERGE,
      detached: false,
    });
  });

  it('blocks apply writes when the active checkout session is stale', async () => {
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
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: branchRef as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
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
