import { describe, expect, it } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import {
  createMaterializerDocumentHandle,
  expectCommit,
  expectHead,
  initializeMaterializerGraph,
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  MATERIALIZER_TARGET_REF,
  requireRefRevision,
  withVersionManifest,
} from './version-apply-merge-materializer-test-utils';

describe('WorkbookVersion revert production flow', () => {
  it('reverts an edit commit through public versioning and materializes the restored state', async () => {
    const { documentScope, provider, initialized } =
      await initializeMaterializerGraph('revert-production-flow');
    const mainHandle = await createMaterializerDocumentHandle(documentScope);
    const verifyHandle = await createMaterializerDocumentHandle(documentScope);
    installVersionDomainDetectorNoopsOnHandles(mainHandle, verifyHandle);

    let mainWb: Workbook | undefined;
    let verifyWb: Workbook | undefined;

    try {
      mainWb = await mainHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(mainWb);
      await expect(mainWb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: initialized.rootCommit.id,
          refName: MATERIALIZER_TARGET_REF,
        },
      });

      await mainWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        mainWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      expect(baseCommit.parents).toEqual([initialized.rootCommit.id]);
      const baseHead = await expectHead(mainWb);

      await mainWb.activeSheet.setCell('A1', 'edited');
      await mainWb.activeSheet.setCell('B1', 'edit-only');
      const editCommit = await expectCommit(
        mainWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      expect(editCommit.parents).toEqual([baseCommit.id]);
      const editHead = await expectHead(mainWb);

      const reverted = await mainWb.version.revert({
        target: { kind: 'commit', commitId: editCommit.id },
        targetRef: MATERIALIZER_TARGET_REF,
        expectedTargetHead: {
          commitId: editCommit.id,
          revision: requireRefRevision(editHead),
        },
        reason: 'regression-test-revert-edit',
      });
      if (!reverted.ok) {
        throw new Error(
          `expected revert success: ${reverted.error.code} ${JSON.stringify(
            reverted.error.diagnostics,
          )}`,
        );
      }
      expect(reverted.value).toMatchObject({
        status: 'applied',
        target: { kind: 'commit', commitId: editCommit.id },
        mutationGuarantee: 'revert-commit-created',
        commitRef: {
          refName: MATERIALIZER_TARGET_REF,
        },
      });
      if (reverted.value.status !== 'applied' || !reverted.value.commitRef) {
        throw new Error(`expected applied revert result, got ${reverted.value.status}`);
      }
      const revertCommitId = reverted.value.commitRef.id;

      const commits = await mainWb.version.listCommits();
      if (!commits.ok) throw new Error(`expected listCommits success: ${commits.error.code}`);
      expect(commits.value.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: revertCommitId,
            parents: [editCommit.id],
          }),
          expect.objectContaining({
            id: editCommit.id,
            parents: [baseCommit.id],
          }),
          expect.objectContaining({
            id: baseCommit.id,
            parents: [initialized.rootCommit.id],
          }),
        ]),
      );

      const revertDiff = await mainWb.version.diff(editCommit.id, revertCommitId);
      if (!revertDiff.ok) {
        throw new Error(
          `expected revert diff success: ${revertDiff.error.code} ${JSON.stringify(
            revertDiff.error.diagnostics,
          )}`,
        );
      }
      expect(revertDiff.value.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'cell',
              entityId: expect.stringMatching(/!A1$/),
              propertyPath: ['value'],
            }),
            before: { kind: 'value', value: 'edited' },
            after: { kind: 'value', value: 'base' },
          }),
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'cell',
              entityId: expect.stringMatching(/!B1$/),
              propertyPath: ['value'],
            }),
            before: { kind: 'value', value: 'edit-only' },
            after: { kind: 'value', value: null },
          }),
        ]),
      );

      verifyWb = await verifyHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(verifyWb);
      verifyWb.markClean();
      const checkout = await verifyWb.version.checkout({
        kind: 'ref',
        name: MATERIALIZER_TARGET_REF,
      });
      if (!checkout.ok) throw new Error(`expected checkout success: ${checkout.error.code}`);
      expect(checkout.value).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
      });
      await expect(verifyWb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: revertCommitId,
          refName: MATERIALIZER_TARGET_REF,
        },
      });
      await expect(verifyWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(verifyWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: null });
    } finally {
      if (verifyWb) await verifyWb.close('skipSave');
      if (mainWb) await mainWb.close('skipSave');
      await verifyHandle.dispose();
      await mainHandle.dispose();
    }
  });
});
