import type { Workbook } from '@mog-sdk/contracts/api';

import {
  createFormatDocumentHandle,
  createFormatVersionStoreProvider,
  expectCommit,
  expectHead,
  expectInitializeSuccess,
  initializeInput,
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  requireRefRevision,
  withVersionManifest,
} from './version-apply-merge-format-test-utils';

export function registerCleanSameCellFormatScenario() {
  it('materializes clean same-cell value and direct-format changes', async () => {
    const provider = createFormatVersionStoreProvider();
    const initialized = expectInitializeSuccess(
      await provider.initializeGraph(await initializeInput('graph-format-clean', 'root')),
    );

    const sourceHandle = await createFormatDocumentHandle();
    const branchHandle = await createFormatDocumentHandle();
    const mergedHandle = await createFormatDocumentHandle();
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, branchHandle, mergedHandle);
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let mergedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
      await sourceWb.activeSheet.setCell('B1', 'base-seed');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      const baseHead = await expectHead(sourceWb);

      const branch = await sourceWb.version.createBranch({
        name: 'scenario/format-incoming' as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await sourceWb.activeSheet.setCell('A1', 'ours');
      const oursCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(sourceWb);

      branchWb = await branchHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(branchWb);
      const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
      if (!checkoutBase.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
      }
      installVersionDomainDetectorNoopsOnWorkbook(branchWb);
      await branchWb.activeSheet.formats.set('A1', { bold: true, fontColor: '#FF0000' });
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/format-incoming' as any,
          expectedHead: {
            commitId: baseCommit.id,
            revision: branch.value.revision,
          },
        }),
      );

      const preview = await sourceWb.version.merge({
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
      });
      if (!preview.ok) {
        throw new Error(`expected merge preview success: ${preview.error.code}`);
      }
      expect(preview.value).toMatchObject({
        status: 'clean',
        changes: [
          expect.objectContaining({
            structural: expect.objectContaining({
              entityId: expect.stringMatching(/!A1$/),
            }),
            merged: { kind: 'value', value: 'ours' },
          }),
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'cells.formats.direct',
              entityId: expect.stringMatching(/!A1$/),
              propertyPath: ['format'],
            }),
          }),
        ],
        conflicts: [],
      });

      const applied = await sourceWb.version.applyMerge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead: {
            commitId: oursCommit.id,
            revision: requireRefRevision(oursHead),
          },
        },
      );
      if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resolutionCount: 0,
        mutationGuarantee: 'merge-commit-created',
      });

      const mergeCommitId = applied.value.commitRef.id;
      await expect(sourceWb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expect.objectContaining({
              id: mergeCommitId,
              parents: [oursCommit.id, theirsCommit.id],
            }),
          ]),
        },
      });

      mergedWb = await mergedHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(mergedWb);
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: mergeCommitId,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'ours',
        format: expect.objectContaining({ bold: true, fontColor: '#FF0000' }),
      });
      await expect(mergedWb.activeSheet.formats.get('A1')).resolves.toMatchObject({
        bold: true,
        fontColor: '#FF0000',
      });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'base-seed',
      });
    } finally {
      if (mergedWb) await mergedWb.close('skipSave');
      if (branchWb) await branchWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await mergedHandle.dispose();
      await branchHandle.dispose();
      await sourceHandle.dispose();
    }
  });
}
