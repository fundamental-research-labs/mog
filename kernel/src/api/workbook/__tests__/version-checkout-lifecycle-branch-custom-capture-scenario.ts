import { expect, it } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import {
  createCellEditNormalCommitCapture,
  initializeVersionGraph,
} from './version-checkout-lifecycle-test-utils';
import {
  commitActiveSheetBaseCell,
  createBranchLifecycleDocumentHandle,
} from './version-checkout-lifecycle-branch-test-utils';

export function registerBranchCheckoutCustomCaptureScenario(): void {
  it('preserves caller-supplied normal commit capture after checkout rebind', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await createBranchLifecycleDocumentHandle();
    const branchHandle = await createBranchLifecycleDocumentHandle();
    const verifyHandle = await createBranchLifecycleDocumentHandle();
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, branchHandle, verifyHandle);
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let verifyWb: Workbook | undefined;
    let branchCaptureCount = 0;
    const branchCapture = createCellEditNormalCommitCapture({
      address: 'B1',
      value: 'custom-capture-edit',
      label: 'custom branch edit',
      onCapture: () => {
        branchCaptureCount += 1;
      },
    });

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      const baseCommit = await commitActiveSheetBaseCell({
        wb: sourceWb,
        initialized,
        value: 'base',
        errorLabel: 'base',
      });

      const created = await sourceWb.version.createBranch({
        name: 'scenario/custom-capture-after-checkout' as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!created.ok) throw new Error(`expected branch create success: ${created.error.code}`);

      branchWb = await branchHandle.workbook({
        versioning: withVersionManifest({
          provider,
          captureNormalCommit: branchCapture,
        }),
      });
      branchWb.markClean();
      const branchCheckout = await branchWb.version.checkout({
        kind: 'ref',
        name: created.value.name,
      });
      if (!branchCheckout.ok) {
        throw new Error(`expected branch checkout success: ${branchCheckout.error.code}`);
      }
      installVersionDomainDetectorNoopsOnWorkbook(branchWb);

      await branchWb.activeSheet.setCell('B1', 'custom-capture-edit');
      const branchCommitResult = await branchWb.version.commit({
        targetRef: created.value.name,
        expectedHead: {
          commitId: baseCommit.id,
          revision: created.value.revision,
        },
      });
      if (!branchCommitResult.ok) {
        throw new Error(`expected branch edit commit success: ${branchCommitResult.error.code}`);
      }
      const branchCommit = branchCommitResult.value;
      branchWb.markClean();

      expect(branchCaptureCount).toBe(1);

      verifyWb = await verifyHandle.workbook({ versioning: withVersionManifest({ provider }) });
      verifyWb.markClean();
      await expect(
        verifyWb.version.checkout({ kind: 'commit', id: branchCommit.id }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });
      await expect(verifyWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(verifyWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'custom-capture-edit',
      });
    } finally {
      if (verifyWb) await verifyWb.close('skipSave');
      if (branchWb) await branchWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await verifyHandle.dispose();
      await branchHandle.dispose();
      await sourceHandle.dispose();
    }
  });
}
