import type { Workbook } from '@mog-sdk/contracts/api';

import {
  createFormulaConflictDocumentHandle,
  createFormulaConflictVersionStoreProvider,
  expectCommit,
  expectHead,
  expectInitializeSuccess,
  initializeInput,
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  requireRefRevision,
  resolutionFor,
  withVersionManifest,
} from './version-apply-merge-formula-conflict-test-utils';

export function registerValueVsFormulaConflictScenario() {
  it('materializes an accepted formula resolution for a value-vs-formula conflict', async () => {
    const provider = createFormulaConflictVersionStoreProvider();
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-value-formula-conflict', 'root'),
    );
    expectInitializeSuccess(initialized);

    const sourceHandle = await createFormulaConflictDocumentHandle();
    const branchHandle = await createFormulaConflictDocumentHandle();
    const mergedHandle = await createFormulaConflictDocumentHandle();
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
        name: 'scenario/formula-incoming' as any,
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
      await branchWb.activeSheet.setCell('A1', '=1+1');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/formula-incoming' as any,
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
      if (preview.value.status !== 'conflicted') {
        throw new Error(`expected conflicted merge preview, got ${preview.value.status}`);
      }
      expect(preview.value.conflicts).toHaveLength(1);
      expect(preview.value.conflicts[0]).toMatchObject({
        conflictKind: 'same-property',
        structural: expect.objectContaining({ entityId: expect.stringMatching(/!A1$/) }),
        base: { kind: 'value', value: null },
        ours: { kind: 'value', value: 'ours' },
        theirs: { kind: 'value', value: { kind: 'formula', formula: '=1+1', result: 2 } },
      });

      const applied = await sourceWb.version.applyMerge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
          resolutions: [resolutionFor(preview.value.conflicts[0], 'acceptTheirs')],
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
        resolutionCount: 1,
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
        value: 2,
        formula: '=1+1',
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
