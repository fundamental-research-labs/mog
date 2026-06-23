import type { Workbook } from '@mog-sdk/contracts/api';

import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import {
  DOCUMENT_SCOPE,
  createCellEditNormalCommitCapture,
  initializeVersionGraph,
} from './version-checkout-lifecycle-test-utils';

describe('WorkbookVersion checkout branch lifecycle', () => {
  it('reports applied branch checkout session status and stale external ref movement', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, checkoutHandle);
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'branch-v1');
      const branchBaseResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!branchBaseResult.ok) {
        throw new Error(`expected branch base commit success: ${branchBaseResult.error.code}`);
      }
      const branchBase = branchBaseResult.value;
      sourceWb.markClean();

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
                  currentRefHeadId: moved.id,
                  refHeadAtMaterialization: branchBase.id,
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

  it('materializes branch edit commits authored after checkout on fresh checkout', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const verifyHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, branchHandle, verifyHandle);
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let verifyWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommitResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!baseCommitResult.ok) {
        throw new Error(`expected base commit success: ${baseCommitResult.error.code}`);
      }
      const baseCommit = baseCommitResult.value;
      sourceWb.markClean();

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

  it('preserves caller-supplied normal commit capture after checkout rebind', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const verifyHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
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
      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommitResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!baseCommitResult.ok) {
        throw new Error(`expected base commit success: ${baseCommitResult.error.code}`);
      }
      const baseCommit = baseCommitResult.value;
      sourceWb.markClean();

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
});
