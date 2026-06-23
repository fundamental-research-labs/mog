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
