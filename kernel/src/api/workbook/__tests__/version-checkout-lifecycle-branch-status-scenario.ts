import { expect, it } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import { initializeVersionGraph } from './version-checkout-lifecycle-test-utils';
import {
  commitActiveSheetBaseCell,
  createBranchLifecycleDocumentHandle,
} from './version-checkout-lifecycle-branch-test-utils';

export function registerBranchCheckoutSessionStatusScenario(): void {
  it('commits checked-out branch edits to the active branch without advancing main', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const handle = await createBranchLifecycleDocumentHandle();
    installVersionDomainDetectorNoopsOnHandles(handle);
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });
      const version = wb.version;
      const mainAlpha = await commitActiveSheetBaseCell({
        wb,
        initialized,
        value: 'alpha',
        errorLabel: 'main alpha',
      });

      const created = await version.createBranch({
        name: 'scenario/manual-smoke' as any,
        targetCommitId: mainAlpha.id,
      });
      expect(created).toMatchObject({
        ok: true,
        value: {
          name: 'refs/heads/scenario/manual-smoke',
          commitId: mainAlpha.id,
        },
      });
      if (!created.ok) throw new Error(`expected branch create success: ${created.error.code}`);

      await expect(
        version.checkout({ kind: 'ref', name: 'refs/heads/scenario/manual-smoke' as any }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });
      installVersionDomainDetectorNoopsOnWorkbook(wb);

      await expect(version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: mainAlpha.id,
          refName: 'refs/heads/scenario/manual-smoke',
          resolvedFrom: 'refs/heads/scenario/manual-smoke',
          refRevision: created.value.revision,
        },
      });
      await expect(version.readRef('HEAD')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'HEAD',
            target: 'refs/heads/scenario/manual-smoke',
            revision: created.value.revision,
          },
        },
      });
      await expect(version.getRef('HEAD')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'HEAD',
            target: 'refs/heads/scenario/manual-smoke',
            revision: created.value.revision,
          },
        },
      });

      await wb.activeSheet.setCell('A1', 'beta');
      const branchHeadBeforeCommit = await version.getHead();
      if (!branchHeadBeforeCommit.ok || !branchHeadBeforeCommit.value.refRevision) {
        throw new Error('expected checked-out branch head with ref revision');
      }

      const betaCommit = await version.commit({
        message: 'beta on manual smoke branch',
        expectedHead: {
          commitId: branchHeadBeforeCommit.value.id,
          revision: branchHeadBeforeCommit.value.refRevision,
        },
      });
      expect(betaCommit).toMatchObject({
        ok: true,
        value: {
          parents: [mainAlpha.id],
        },
      });
      if (!betaCommit.ok) throw new Error(`expected beta commit success: ${betaCommit.error.code}`);

      await expect(
        version.readRef('refs/heads/scenario/manual-smoke' as any),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/scenario/manual-smoke',
            commitId: betaCommit.value.id,
          },
        },
      });
      await expect(version.readRef('HEAD')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'HEAD',
            target: 'refs/heads/scenario/manual-smoke',
          },
        },
      });
      await expect(version.getRef('HEAD')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'HEAD',
            target: 'refs/heads/scenario/manual-smoke',
          },
        },
      });
      await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/main',
            commitId: mainAlpha.id,
          },
        },
      });
      await expect(version.getSurfaceStatus()).resolves.toMatchObject({
        current: {
          headCommitId: betaCommit.value.id,
          checkedOutCommitId: betaCommit.value.id,
          branchName: 'scenario/manual-smoke',
          refHeadAtMaterialization: betaCommit.value.id,
          currentRefHeadId: betaCommit.value.id,
          detached: false,
          stale: false,
        },
        dirty: {
          hasUncommittedLocalChanges: false,
        },
      });
      expect(wb.isDirty).toBe(false);

      const explicitHeadCommits = await version.listCommits({ ref: 'HEAD' });
      expect(explicitHeadCommits).toMatchObject({ ok: true });
      if (!explicitHeadCommits.ok) {
        throw new Error(`expected HEAD commit listing success: ${explicitHeadCommits.error.code}`);
      }
      expect(explicitHeadCommits.value.items.map((commit) => commit.id)).toContain(
        betaCommit.value.id,
      );

      const implicitCurrentCommits = await version.listCommits();
      expect(implicitCurrentCommits).toMatchObject({ ok: true });
      if (!implicitCurrentCommits.ok) {
        throw new Error(
          `expected active checkout commit listing success: ${implicitCurrentCommits.error.code}`,
        );
      }
      expect(implicitCurrentCommits.value.items.map((commit) => commit.id)).toContain(
        betaCommit.value.id,
      );

      const headDiff = await version.diff(mainAlpha.id, { kind: 'ref', name: 'HEAD' });
      expect(headDiff).toMatchObject({ ok: true });
      if (!headDiff.ok) throw new Error(`expected HEAD diff success: ${headDiff.error.code}`);
      expect(
        headDiff.value.items.some(
          (entry) => entry.after.kind === 'value' && entry.after.value === 'beta',
        ),
      ).toBe(true);

      await expect(version.checkout({ kind: 'ref', name: 'HEAD' })).resolves.toMatchObject({
        ok: true,
        value: {
          plan: {
            commitId: betaCommit.value.id,
            target: { kind: 'head', refName: 'refs/heads/scenario/manual-smoke' },
          },
        },
      });

      wb.emit({
        type: 'security:policies-reloaded',
        timestamp: Date.now(),
        policyVersionBefore: 0,
        policyVersionAfter: 1,
        active: false,
      });
      expect(wb.isDirty).toBe(false);
      await expect(version.getSurfaceStatus()).resolves.toMatchObject({
        dirty: {
          hasUncommittedLocalChanges: false,
        },
      });

      const headCheckout = await wb.version.checkout({ kind: 'head' });
      expect(headCheckout).toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
          plan: {
            commitId: betaCommit.value.id,
            target: {
              kind: 'head',
              refName: 'refs/heads/scenario/manual-smoke',
              commitId: betaCommit.value.id,
            },
          },
        },
      });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'beta' });

      const branchHeadBeforeRevert = await version.getHead();
      if (!branchHeadBeforeRevert.ok || !branchHeadBeforeRevert.value.refRevision) {
        throw new Error('expected checked-out branch head with ref revision before revert');
      }
      const branchRevert = await version.revert({
        target: { kind: 'commit', commitId: betaCommit.value.id },
        expectedTargetHead: {
          commitId: betaCommit.value.id,
          revision: branchHeadBeforeRevert.value.refRevision,
        },
        reason: 'regression-test-implicit-active-branch-revert',
      });
      expect(branchRevert).toMatchObject({
        ok: true,
        value: {
          status: 'applied',
          mutationGuarantee: 'revert-commit-created',
          commitRef: {
            refName: 'refs/heads/scenario/manual-smoke',
            resolvedFrom: 'refs/heads/scenario/manual-smoke',
          },
        },
      });
      if (
        !branchRevert.ok ||
        branchRevert.value.status !== 'applied' ||
        !branchRevert.value.commitRef
      ) {
        throw new Error('expected active branch revert to create a revert commit');
      }
      const branchRevertCommitId = branchRevert.value.commitRef.id;

      await expect(
        version.readRef('refs/heads/scenario/manual-smoke' as any),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/scenario/manual-smoke',
            commitId: branchRevertCommitId,
          },
        },
      });
      await expect(version.readRef('HEAD')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'HEAD',
            target: 'refs/heads/scenario/manual-smoke',
          },
        },
      });
      await expect(version.getRef('HEAD')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'HEAD',
            target: 'refs/heads/scenario/manual-smoke',
          },
        },
      });
      await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/main',
            commitId: mainAlpha.id,
          },
        },
      });
      await expect(version.getSurfaceStatus()).resolves.toMatchObject({
        current: {
          headCommitId: branchRevertCommitId,
          checkedOutCommitId: branchRevertCommitId,
          branchName: 'scenario/manual-smoke',
          refHeadAtMaterialization: branchRevertCommitId,
          currentRefHeadId: branchRevertCommitId,
          detached: false,
          stale: false,
        },
      });

      const revertedHeadCheckout = await wb.version.checkout({ kind: 'head' });
      expect(revertedHeadCheckout).toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
          plan: {
            commitId: branchRevertCommitId,
            target: {
              kind: 'head',
              refName: 'refs/heads/scenario/manual-smoke',
              commitId: branchRevertCommitId,
            },
          },
        },
      });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'alpha' });

      const mainCheckout = await wb.version.checkout({
        kind: 'ref',
        name: 'refs/heads/main',
      });
      await expect(Promise.resolve(mainCheckout)).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'alpha' });

      await expect(
        wb.version.checkout({ kind: 'ref', name: 'refs/heads/scenario/manual-smoke' as any }),
      ).resolves.toMatchObject({
        ok: true,
        value: { status: 'success' },
      });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'alpha' });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });

  it('isolates undo history when a branch checkout materializes a fresh workbook context', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const handle = await createBranchLifecycleDocumentHandle();
    installVersionDomainDetectorNoopsOnHandles(handle);
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });
      const branchBase = await commitActiveSheetBaseCell({
        wb,
        initialized,
        value: 'undo-base',
        errorLabel: 'undo isolation base',
      });

      const created = await wb.version.createBranch({
        name: 'scenario/undo-isolation' as any,
        targetCommitId: branchBase.id,
        expectedAbsent: true,
      });
      expect(created).toMatchObject({
        ok: true,
        value: {
          name: 'refs/heads/scenario/undo-isolation',
          commitId: branchBase.id,
        },
      });
      if (!created.ok) throw new Error(`expected branch create success: ${created.error.code}`);

      const historyBeforeCheckout = await wb.history.getState();
      expect(historyBeforeCheckout.canUndo).toBe(true);
      expect(historyBeforeCheckout.undoDepth).toBeGreaterThan(0);

      await expect(
        wb.version.checkout({ kind: 'ref', name: 'refs/heads/scenario/undo-isolation' as any }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });
      installVersionDomainDetectorNoopsOnWorkbook(wb);

      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'undo-base' });
      const historyAfterCheckout = await wb.history.getState();
      expect(historyAfterCheckout).toMatchObject({
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      });
      expect(wb.history.canUndo()).toBe(false);
      expect(wb.isDirty).toBe(false);

      await wb.activeSheet.setCell('C1', 'post-checkout-edit');
      const postCheckoutHistory = await wb.history.getState();
      expect(postCheckoutHistory.canUndo).toBe(true);
      expect(postCheckoutHistory.undoDepth).toBeGreaterThan(0);

      await expect(wb.history.undo()).resolves.toMatchObject({ kind: 'undo', success: true });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'undo-base' });
      await expect(wb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: null });
      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: branchBase.id,
          refName: 'refs/heads/scenario/undo-isolation',
          resolvedFrom: 'refs/heads/scenario/undo-isolation',
          refRevision: created.value.revision,
        },
      });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });

  it('reports applied branch checkout session status and stale external ref movement', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await createBranchLifecycleDocumentHandle();
    const checkoutHandle = await createBranchLifecycleDocumentHandle();
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, checkoutHandle);
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      const branchBase = await commitActiveSheetBaseCell({
        wb: sourceWb,
        initialized,
        value: 'branch-v1',
        errorLabel: 'branch base',
      });

      const created = await sourceWb.version.createBranch({
        name: 'scenario/status' as any,
        targetCommitId: branchBase.id,
      });
      expect(created).toMatchObject({
        ok: true,
        value: {
          name: 'refs/heads/scenario/status',
          commitId: branchBase.id,
        },
      });
      if (!created.ok) throw new Error(`expected branch create success: ${created.error.code}`);

      checkoutWb = await checkoutHandle.workbook({ versioning: withVersionManifest({ provider }) });
      checkoutWb.markClean();
      await expect(
        checkoutWb.version.checkout({ kind: 'ref', name: 'refs/heads/scenario/status' as any }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });
      installVersionDomainDetectorNoopsOnWorkbook(checkoutWb);

      await expect(checkoutWb.version.getSurfaceStatus()).resolves.toMatchObject({
        current: {
          headCommitId: branchBase.id,
          checkedOutCommitId: branchBase.id,
          branchName: 'scenario/status',
          refHeadAtMaterialization: branchBase.id,
          currentRefHeadId: branchBase.id,
          detached: false,
          stale: false,
        },
        dirty: {
          checkoutSafe: true,
          hasUncommittedLocalChanges: false,
        },
      });

      const postCheckoutCellEvents: unknown[] = [];
      const unsubscribePostCheckoutCellEvents = checkoutWb.on('cell:changed', (event) => {
        postCheckoutCellEvents.push(event);
      });

      await checkoutWb.activeSheet.setCell('A3', 'branch-v1-local-edit');
      unsubscribePostCheckoutCellEvents();
      await expect(checkoutWb.activeSheet.getCell('A3')).resolves.toMatchObject({
        value: 'branch-v1-local-edit',
      });
      expect(checkoutWb.isDirty).toBe(true);
      expect(postCheckoutCellEvents).toEqual([
        expect.objectContaining({
          type: 'cell:changed',
          row: 2,
          col: 0,
          newValue: 'branch-v1-local-edit',
        }),
      ]);
      checkoutWb.markClean();

      await sourceWb.activeSheet.setCell('A2', 'branch-v2');
      const movedResult = await sourceWb.version.commit({
        targetRef: 'refs/heads/scenario/status' as any,
        expectedHead: {
          commitId: branchBase.id,
          revision: created.value.revision,
        },
      });
      if (!movedResult.ok)
        throw new Error(`expected moved commit success: ${movedResult.error.code}`);
      const moved = movedResult.value;
      sourceWb.markClean();

      await expect(checkoutWb.version.getSurfaceStatus()).resolves.toMatchObject({
        current: {
          headCommitId: branchBase.id,
          checkedOutCommitId: branchBase.id,
          branchName: 'scenario/status',
          refHeadAtMaterialization: branchBase.id,
          currentRefHeadId: moved.id,
          detached: false,
          stale: true,
          staleReason: 'refMoved',
        },
      });
      await expect(
        checkoutWb.version.checkout({ kind: 'ref', name: 'refs/heads/scenario/status' as any }),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
              data: expect.objectContaining({
                payload: expect.objectContaining({
                  reason: 'staleWorkspaceHead',
                  staleReason: 'refMoved',
                  currentRefHeadId: 'redacted',
                  refHeadAtMaterialization: 'redacted',
                }),
              }),
            }),
          ],
        },
      });
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'branch-v1',
      });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });
}
