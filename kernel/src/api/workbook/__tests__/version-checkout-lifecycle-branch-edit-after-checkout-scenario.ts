import { expect, it } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import { DOCUMENT_SCOPE, initializeVersionGraph } from './version-checkout-lifecycle-test-utils';
import {
  commitActiveSheetBaseCell,
  createBranchLifecycleDocumentHandle,
} from './version-checkout-lifecycle-branch-test-utils';

export function registerBranchCheckoutEditAfterCheckoutScenario(): void {
  it('materializes branch edit commits authored after checkout on fresh checkout', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await createBranchLifecycleDocumentHandle();
    const branchHandle = await createBranchLifecycleDocumentHandle();
    const verifyHandle = await createBranchLifecycleDocumentHandle();
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, branchHandle, verifyHandle);
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let verifyWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      const baseCommit = await commitActiveSheetBaseCell({
        wb: sourceWb,
        initialized,
        value: 'base',
        errorLabel: 'base',
      });

      const created = await sourceWb.version.createBranch({
        name: 'scenario/edit-after-checkout' as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!created.ok) throw new Error(`expected branch create success: ${created.error.code}`);

      branchWb = await branchHandle.workbook({ versioning: withVersionManifest({ provider }) });
      branchWb.markClean();
      const branchCheckout = await branchWb.version.checkout({
        kind: 'ref',
        name: created.value.name,
      });
      if (!branchCheckout.ok) {
        throw new Error(`expected branch checkout success: ${branchCheckout.error.code}`);
      }
      installVersionDomainDetectorNoopsOnWorkbook(branchWb);
      expect(branchCheckout.value).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
      });
      await branchWb.activeSheet.setCell('B1', 'branch-edit');
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

      const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
      const baseRead = await graph.readCommit(baseCommit.id);
      const branchRead = await graph.readCommit(branchCommit.id);
      expect(baseRead.status).toBe('success');
      expect(branchRead.status).toBe('success');
      if (baseRead.status !== 'success' || branchRead.status !== 'success') {
        throw new Error('expected base and branch commit records to be readable');
      }
      expect(branchRead.commit.payload.snapshotRootDigest).not.toEqual(
        baseRead.commit.payload.snapshotRootDigest,
      );

      verifyWb = await verifyHandle.workbook({ versioning: withVersionManifest({ provider }) });
      verifyWb.markClean();
      const verifyCheckout = await verifyWb.version.checkout({
        kind: 'commit',
        id: branchCommit.id,
      });
      expect(verifyCheckout).toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });
      await expect(verifyWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(verifyWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'branch-edit',
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
