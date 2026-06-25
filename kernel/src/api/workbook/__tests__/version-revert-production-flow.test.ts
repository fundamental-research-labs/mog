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
import { createMaterializerMergeFixture } from './version-apply-merge-materializer-scenario-helpers';

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

  it('reverts a top-of-ref range by creating a revert commit at the base snapshot', async () => {
    const { documentScope, provider, initialized } = await initializeMaterializerGraph(
      'revert-production-range-flow',
    );
    const mainHandle = await createMaterializerDocumentHandle(documentScope);
    const verifyHandle = await createMaterializerDocumentHandle(documentScope);
    installVersionDomainDetectorNoopsOnHandles(mainHandle, verifyHandle);

    let mainWb: Workbook | undefined;
    let verifyWb: Workbook | undefined;

    try {
      mainWb = await mainHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(mainWb);

      await mainWb.activeSheet.setCell('A1', 'base');
      await mainWb.activeSheet.setCell('B1', 'base-keep');
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

      await mainWb.activeSheet.setCell('A1', 'first');
      await mainWb.activeSheet.setCell('B1', 'first-only');
      const firstCommit = await expectCommit(
        mainWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      expect(firstCommit.parents).toEqual([baseCommit.id]);
      const firstHead = await expectHead(mainWb);

      await mainWb.activeSheet.setCell('A1', 'second');
      await mainWb.activeSheet.setCell('C1', 'second-only');
      const secondCommit = await expectCommit(
        mainWb.version.commit({
          expectedHead: {
            commitId: firstCommit.id,
            revision: requireRefRevision(firstHead),
          },
        }),
      );
      expect(secondCommit.parents).toEqual([firstCommit.id]);
      const secondHead = await expectHead(mainWb);

      const reverted = await mainWb.version.revert({
        target: { kind: 'range', baseCommitId: baseCommit.id, headCommitId: secondCommit.id },
        targetRef: MATERIALIZER_TARGET_REF,
        expectedTargetHead: {
          commitId: secondCommit.id,
          revision: requireRefRevision(secondHead),
        },
        reason: 'regression-test-revert-range',
      });
      if (!reverted.ok) {
        throw new Error(
          `expected range revert success: ${reverted.error.code} ${JSON.stringify(
            reverted.error.diagnostics,
          )}`,
        );
      }
      expect(reverted.value).toMatchObject({
        status: 'applied',
        target: { kind: 'range', baseCommitId: baseCommit.id, headCommitId: secondCommit.id },
        mutationGuarantee: 'revert-commit-created',
        commitRef: {
          refName: MATERIALIZER_TARGET_REF,
        },
      });
      if (reverted.value.status !== 'applied' || !reverted.value.commitRef) {
        throw new Error(`expected applied range revert result, got ${reverted.value.status}`);
      }
      const revertCommitId = reverted.value.commitRef.id;

      const commits = await mainWb.version.listCommits();
      if (!commits.ok) throw new Error(`expected listCommits success: ${commits.error.code}`);
      expect(commits.value.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: revertCommitId,
            parents: [secondCommit.id],
          }),
          expect.objectContaining({
            id: secondCommit.id,
            parents: [firstCommit.id],
          }),
          expect.objectContaining({
            id: firstCommit.id,
            parents: [baseCommit.id],
          }),
          expect.objectContaining({
            id: baseCommit.id,
            parents: [initialized.rootCommit.id],
          }),
        ]),
      );

      const revertDiff = await mainWb.version.diff(secondCommit.id, revertCommitId);
      if (!revertDiff.ok) {
        throw new Error(
          `expected range revert diff success: ${revertDiff.error.code} ${JSON.stringify(
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
            before: { kind: 'value', value: 'second' },
            after: { kind: 'value', value: 'first' },
          }),
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'cell',
              entityId: expect.stringMatching(/!C1$/),
              propertyPath: ['value'],
            }),
            before: { kind: 'value', value: 'second-only' },
            after: { kind: 'value', value: null },
          }),
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'cell',
              entityId: expect.stringMatching(/!A1$/),
              propertyPath: ['value'],
            }),
            before: { kind: 'value', value: 'first' },
            after: { kind: 'value', value: 'base' },
          }),
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'cell',
              entityId: expect.stringMatching(/!B1$/),
              propertyPath: ['value'],
            }),
            before: { kind: 'value', value: 'first-only' },
            after: { kind: 'value', value: 'base-keep' },
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
      await expect(verifyWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'base-keep',
      });
      await expect(verifyWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: null });
    } finally {
      if (verifyWb) await verifyWb.close('skipSave');
      if (mainWb) await mainWb.close('skipSave');
      await verifyHandle.dispose();
      await mainHandle.dispose();
    }
  });

  it('requires review for a non-tip commit revert without advancing the target ref', async () => {
    const { documentScope, provider, initialized } = await initializeMaterializerGraph(
      'revert-production-non-tip-flow',
    );
    const mainHandle = await createMaterializerDocumentHandle(documentScope);
    installVersionDomainDetectorNoopsOnHandles(mainHandle);

    let mainWb: Workbook | undefined;

    try {
      mainWb = await mainHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(mainWb);

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
      const baseHead = await expectHead(mainWb);

      await mainWb.activeSheet.setCell('A1', 'first');
      const firstCommit = await expectCommit(
        mainWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const firstHead = await expectHead(mainWb);

      await mainWb.activeSheet.setCell('B1', 'second');
      const secondCommit = await expectCommit(
        mainWb.version.commit({
          expectedHead: {
            commitId: firstCommit.id,
            revision: requireRefRevision(firstHead),
          },
        }),
      );
      const secondHead = await expectHead(mainWb);
      const beforeCommitIds = await listCommitIds(mainWb);

      const nonTipRevert = await mainWb.version.revert(
        {
          target: { kind: 'commit', commitId: firstCommit.id },
          targetRef: MATERIALIZER_TARGET_REF,
          expectedTargetHead: {
            commitId: secondCommit.id,
            revision: requireRefRevision(secondHead),
          },
          reason: 'regression-test-non-tip-revert',
        },
        { includeDiagnostics: true },
      );
      expect(nonTipRevert).toMatchObject({
        ok: true,
        value: {
          status: 'requires-review',
          target: { kind: 'commit', commitId: firstCommit.id },
          mutationGuarantee: 'ref-not-mutated',
          diagnostics: [
            expect.objectContaining({
              issueCode: 'VERSION_REVERT_REQUIRES_REVIEW',
              payload: expect.objectContaining({
                operation: 'revert',
                targetKind: 'commit',
                reason: 'nonTipCommitRevert',
                expectedHead: firstCommit.id,
                actualHead: secondCommit.id,
                targetRef: MATERIALIZER_TARGET_REF,
              }),
              mutationGuarantee: 'ref-not-mutated',
            }),
          ],
        },
      });

      const afterHead = await expectHead(mainWb);
      expect(afterHead).toMatchObject({
        id: secondCommit.id,
        refName: MATERIALIZER_TARGET_REF,
      });
      expect(requireRefRevision(afterHead)).toEqual(requireRefRevision(secondHead));
      await expect(listCommitIds(mainWb)).resolves.toEqual(beforeCommitIds);
    } finally {
      if (mainWb) await mainWb.close('skipSave');
      await mainHandle.dispose();
    }
  });

  it('reverts a top-of-ref merge commit to the selected first-parent snapshot', async () => {
    const fixture = await createMaterializerMergeFixture({
      graphId: 'revert-production-merge-flow',
      branchName: 'scenario/revert-merge-incoming',
      baseEdits: [['A1', 'base']],
      oursEdits: [['B1', 'ours']],
      theirsEdits: [['C1', 'theirs']],
    });

    try {
      const { sourceWb, baseCommit, oursCommit, theirsCommit, expectedTargetHead } = fixture;
      const preview = await sourceWb.version.merge({
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
      });
      if (!preview.ok) throw new Error(`expected merge preview success: ${preview.error.code}`);
      expect(preview.value).toMatchObject({
        status: 'clean',
        conflicts: [],
      });

      const applied = await sourceWb.version.applyMerge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead,
        },
      );
      if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        mutationGuarantee: 'merge-commit-created',
        commitRef: {
          refName: MATERIALIZER_TARGET_REF,
        },
      });
      if (applied.value.status !== 'applied') {
        throw new Error(`expected applied merge result, got ${applied.value.status}`);
      }
      const mergeCommitId = applied.value.commitRef.id;
      const mergeHead = await expectHead(sourceWb);

      const reverted = await sourceWb.version.revert({
        target: { kind: 'mergeCommit', commitId: mergeCommitId, mainlineParent: 1 },
        targetRef: MATERIALIZER_TARGET_REF,
        expectedTargetHead: {
          commitId: mergeCommitId,
          revision: requireRefRevision(mergeHead),
        },
        reason: 'regression-test-revert-merge-mainline-1',
      });
      if (!reverted.ok) {
        throw new Error(
          `expected merge revert success: ${reverted.error.code} ${JSON.stringify(
            reverted.error.diagnostics,
          )}`,
        );
      }
      expect(reverted.value).toMatchObject({
        status: 'applied',
        target: { kind: 'mergeCommit', commitId: mergeCommitId, mainlineParent: 1 },
        mutationGuarantee: 'revert-commit-created',
        commitRef: {
          refName: MATERIALIZER_TARGET_REF,
        },
      });
      if (reverted.value.status !== 'applied' || !reverted.value.commitRef) {
        throw new Error(`expected applied merge revert result, got ${reverted.value.status}`);
      }
      const revertCommitId = reverted.value.commitRef.id;

      const commits = await sourceWb.version.listCommits();
      if (!commits.ok) throw new Error(`expected listCommits success: ${commits.error.code}`);
      expect(commits.value.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: revertCommitId,
            parents: [mergeCommitId],
          }),
          expect.objectContaining({
            id: mergeCommitId,
            parents: [oursCommit.id, theirsCommit.id],
          }),
        ]),
      );

      const mergedWb = await fixture.openMergedWorkbook();
      const checkout = await mergedWb.version.checkout({
        kind: 'ref',
        name: MATERIALIZER_TARGET_REF,
      });
      if (!checkout.ok) throw new Error(`expected checkout success: ${checkout.error.code}`);
      expect(checkout.value).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
      });
      await expect(mergedWb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: revertCommitId,
          refName: MATERIALIZER_TARGET_REF,
        },
      });
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(mergedWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: null });
    } finally {
      await fixture.cleanup();
    }
  });

  it('blocks rollback commits from a stale active workbook after applying and reverting a merge commit', async () => {
    const fixture = await createMaterializerMergeFixture({
      graphId: 'revert-production-merge-stale-active-flow',
      branchName: 'scenario/revert-merge-stale-active-incoming',
      baseEdits: [['A1', 'base']],
      oursEdits: [['B1', 'ours']],
      theirsEdits: [['C1', 'theirs']],
    });

    try {
      const { sourceWb, baseCommit, oursCommit, theirsCommit, expectedTargetHead } = fixture;
      const applied = await sourceWb.version.applyMerge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead,
        },
      );
      if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
      if (applied.value.status !== 'applied') {
        throw new Error(`expected applied merge result, got ${applied.value.status}`);
      }
      const mergeCommitId = applied.value.commitRef.id;

      await expect(sourceWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: null });
      await expect(sourceWb.version.getSurfaceStatus()).resolves.toMatchObject({
        current: {
          checkedOutCommitId: oursCommit.id,
          refHeadAtMaterialization: mergeCommitId,
          currentRefHeadId: mergeCommitId,
          detached: false,
          stale: true,
          staleReason: 'activeSessionBehind',
        },
      });

      const mergeHead = await expectHead(sourceWb);
      const reverted = await sourceWb.version.revert({
        target: { kind: 'mergeCommit', commitId: mergeCommitId, mainlineParent: 1 },
        targetRef: MATERIALIZER_TARGET_REF,
        expectedTargetHead: {
          commitId: mergeCommitId,
          revision: requireRefRevision(mergeHead),
        },
        reason: 'regression-test-revert-merge-stale-active',
      });
      if (!reverted.ok) {
        throw new Error(
          `expected merge revert success: ${reverted.error.code} ${JSON.stringify(
            reverted.error.diagnostics,
          )}`,
        );
      }
      if (reverted.value.status !== 'applied' || !reverted.value.commitRef) {
        throw new Error(`expected applied merge revert result, got ${reverted.value.status}`);
      }
      const revertCommitId = reverted.value.commitRef.id;

      await expect(sourceWb.version.getSurfaceStatus()).resolves.toMatchObject({
        current: {
          checkedOutCommitId: oursCommit.id,
          refHeadAtMaterialization: mergeCommitId,
          currentRefHeadId: revertCommitId,
          detached: false,
          stale: true,
          staleReason: 'refMoved',
        },
      });

      const commitIdsAfterRevert = await listCommitIds(sourceWb);
      await sourceWb.activeSheet.setCell('D1', 'post-revert-local');
      await expect(
        sourceWb.version.commit({ message: 'must not rollback reverted merge' }),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          diagnostics: [expect.objectContaining({ code: 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD' })],
        },
      });
      await expect(listCommitIds(sourceWb)).resolves.toEqual(commitIdsAfterRevert);

      const mergedWb = await fixture.openMergedWorkbook();
      const checkout = await mergedWb.version.checkout({
        kind: 'ref',
        name: MATERIALIZER_TARGET_REF,
      });
      if (!checkout.ok) throw new Error(`expected checkout success: ${checkout.error.code}`);
      await expect(mergedWb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: revertCommitId,
          refName: MATERIALIZER_TARGET_REF,
        },
      });
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(mergedWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: null });
      await expect(mergedWb.activeSheet.getCell('D1')).resolves.toMatchObject({ value: null });
    } finally {
      await fixture.cleanup();
    }
  });
});

async function listCommitIds(wb: Workbook): Promise<readonly string[]> {
  const commits = await wb.version.listCommits();
  if (!commits.ok) throw new Error(`expected listCommits success: ${commits.error.code}`);
  return commits.value.items.map((commit) => commit.id);
}
