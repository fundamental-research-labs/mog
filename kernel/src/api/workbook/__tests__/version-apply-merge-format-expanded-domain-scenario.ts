import type { VersionMergeResult, Workbook } from '@mog-sdk/contracts/api';

import {
  cleanMergeResult,
  createFormatDocumentHandle,
  createFormatVersionStoreProvider,
  expectCommit,
  expectHead,
  expectInitializeSuccess,
  formulaChange,
  initializeInput,
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  requireRefRevision,
  rowColumnChange,
  sheetMetadataChange,
  withVersionManifest,
} from './version-apply-merge-format-test-utils';

export function registerExpandedDomainFormatScenario() {
  it('materializes direct first-slice formulas, row/column transitions, and sheet view metadata from a clean plan', async () => {
    const provider = createFormatVersionStoreProvider();
    const initialized = expectInitializeSuccess(
      await provider.initializeGraph(await initializeInput('graph-expanded-domain-clean', 'root')),
    );

    let previewResult: VersionMergeResult | undefined;
    const sourceHandle = await createFormatDocumentHandle();
    const branchHandle = await createFormatDocumentHandle();
    const mergedHandle = await createFormatDocumentHandle();
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, branchHandle, mergedHandle);
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let mergedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({
        versioning: withVersionManifest({
          provider,
          mergeService: {
            merge: async () => {
              if (!previewResult) throw new Error('expected synthetic merge result');
              return previewResult;
            },
          },
        }),
      });
      installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
      const sheetId = String(sourceWb.activeSheet.sheetId);
      await sourceWb.activeSheet.setCell('A1', 1);
      await sourceWb.activeSheet.setCell('A2', 'shifted');
      await sourceWb.activeSheet.setCell('A4', 'deleted-row');
      await sourceWb.activeSheet.setCell('A6', 'insert-shifted-row');
      await sourceWb.activeSheet.setCell('C1', 'deleted-column');
      await sourceWb.activeSheet.setCell('F1', 'insert-shifted-column');
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
        name: 'scenario/expanded-domain-incoming' as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await sourceWb.activeSheet.setCell('B1', 'ours');
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
      await branchWb.activeSheet.setCell('E1', 'theirs-anchor');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/expanded-domain-incoming' as any,
          expectedHead: {
            commitId: baseCommit.id,
            revision: branch.value.revision,
          },
        }),
      );

      previewResult = cleanMergeResult(baseCommit.id, oursCommit.id, theirsCommit.id, [
        formulaChange('merge-formula-a2', sheetId, 'A2', '=A1+1'),
        rowColumnChange('merge-row-insert', sheetId, 'row', 1, 'insert'),
        rowColumnChange('merge-row-delete', sheetId, 'row', 3, 'delete'),
        rowColumnChange('merge-column-insert', sheetId, 'column', 4, 'insert'),
        rowColumnChange('merge-column-delete', sheetId, 'column', 2, 'delete'),
        sheetMetadataChange('merge-sheet-rename', sheetId, 'name', 'Sheet1', 'Forecast Sheet'),
        sheetMetadataChange('merge-sheet-tab-color', sheetId, 'tabColor', null, '#33AAFF'),
        sheetMetadataChange(
          'merge-sheet-frozen-panes',
          sheetId,
          'frozen',
          { rows: 0, cols: 0 },
          { rows: 2, cols: 1 },
        ),
      ]);

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

      mergedWb = await mergedHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(mergedWb);
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: applied.value.commitRef.id,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      expect(mergedWb.activeSheet.name).toBe('Forecast Sheet');
      await expect(mergedWb.activeSheet.view.getTabColor()).resolves.toBe('#33AAFF');
      await expect(mergedWb.activeSheet.view.getFrozenPanes()).resolves.toEqual({
        rows: 2,
        cols: 1,
      });
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 1 });
      await expect(mergedWb.activeSheet.getFormula('A2')).resolves.toBe('=A1+1');
      await expect(mergedWb.activeSheet.getCell('A2')).resolves.toMatchObject({ value: 2 });
      await expect(mergedWb.activeSheet.getCell('A3')).resolves.toMatchObject({
        value: 'shifted',
      });
      await expect(mergedWb.activeSheet.getCell('A4')).resolves.toMatchObject({ value: null });
      await expect(mergedWb.activeSheet.getCell('A5')).resolves.toMatchObject({ value: null });
      await expect(mergedWb.activeSheet.getCell('A6')).resolves.toMatchObject({
        value: 'insert-shifted-row',
      });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(mergedWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: null });
      await expect(mergedWb.activeSheet.getCell('E1')).resolves.toMatchObject({ value: null });
      await expect(mergedWb.activeSheet.getCell('F1')).resolves.toMatchObject({
        value: 'insert-shifted-column',
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
