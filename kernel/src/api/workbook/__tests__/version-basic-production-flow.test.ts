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

const BASIC_FLOW_BRANCH_NAME = 'scenario/basic-production-flow';
const BASIC_FLOW_BRANCH_REF = 'refs/heads/scenario/basic-production-flow';

describe('WorkbookVersion basic production flow', () => {
  it('commits edits, branches, checks out branch/main, applies a clean merge, and lists commits/refs', async () => {
    const { documentScope, provider, initialized } =
      await initializeMaterializerGraph('basic-production-flow');
    const mainHandle = await createMaterializerDocumentHandle(documentScope);
    const branchHandle = await createMaterializerDocumentHandle(documentScope);
    const verifyHandle = await createMaterializerDocumentHandle(documentScope);
    installVersionDomainDetectorNoopsOnHandles(mainHandle, branchHandle, verifyHandle);

    let mainWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
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

      const branch = await mainWb.version.createBranch({
        name: BASIC_FLOW_BRANCH_NAME as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);
      expect(branch.value).toMatchObject({
        name: BASIC_FLOW_BRANCH_REF,
        commitId: baseCommit.id,
      });

      branchWb = await branchHandle.workbook({ versioning: withVersionManifest({ provider }) });
      branchWb.markClean();
      const branchCheckout = await branchWb.version.checkout({
        kind: 'ref',
        name: branch.value.name,
      });
      if (!branchCheckout.ok) {
        throw new Error(`expected branch checkout success: ${branchCheckout.error.code}`);
      }
      expect(branchCheckout.value).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
      });
      installVersionDomainDetectorNoopsOnWorkbook(branchWb);
      await expect(branchWb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: baseCommit.id,
          refName: BASIC_FLOW_BRANCH_REF,
          resolvedFrom: BASIC_FLOW_BRANCH_REF,
        },
      });
      await expect(branchWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'base',
      });

      await branchWb.activeSheet.setCell('B1', 'branch');
      const branchCommit = await expectCommit(
        branchWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: branch.value.revision,
          },
        }),
      );
      expect(branchCommit.parents).toEqual([baseCommit.id]);

      await mainWb.activeSheet.setCell('C1', 'main');
      const oursCommit = await expectCommit(
        mainWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      expect(oursCommit.parents).toEqual([baseCommit.id]);
      const oursHead = await expectHead(mainWb);

      const mainCheckout = await branchWb.version.checkout({
        kind: 'ref',
        name: MATERIALIZER_TARGET_REF,
      });
      if (!mainCheckout.ok) {
        throw new Error(`expected main checkout success: ${mainCheckout.error.code}`);
      }
      expect(mainCheckout.value).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
      });
      await expect(branchWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'base',
      });
      await expect(branchWb.activeSheet.getCell('C1')).resolves.toMatchObject({
        value: 'main',
      });

      const mergeInput = {
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: branchCommit.id,
      };
      const preview = await mainWb.version.merge(mergeInput);
      if (!preview.ok) {
        throw new Error(`expected clean merge preview success: ${preview.error.code}`);
      }
      expect(preview.value).toMatchObject({
        status: 'clean',
        conflicts: [],
      });

      const applied = await mainWb.version.applyMerge(mergeInput, {
        targetRef: MATERIALIZER_TARGET_REF as any,
        expectedTargetHead: {
          commitId: oursCommit.id,
          revision: requireRefRevision(oursHead),
        },
      });
      if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: branchCommit.id,
        mutationGuarantee: 'merge-commit-created',
        commitRef: {
          refName: MATERIALIZER_TARGET_REF,
          resolvedFrom: MATERIALIZER_TARGET_REF,
        },
      });
      if (applied.value.status !== 'applied') {
        throw new Error(`expected applied merge result, got ${applied.value.status}`);
      }
      const mergeCommitId = applied.value.commitRef.id;

      const mainCommits = await mainWb.version.listCommits();
      if (!mainCommits.ok)
        throw new Error(`expected main listCommits success: ${mainCommits.error.code}`);
      expect(mainCommits.value.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: mergeCommitId,
            parents: [oursCommit.id, branchCommit.id],
          }),
          expect.objectContaining({
            id: oursCommit.id,
            parents: [baseCommit.id],
          }),
          expect.objectContaining({
            id: branchCommit.id,
            parents: [baseCommit.id],
          }),
          expect.objectContaining({
            id: baseCommit.id,
            parents: [initialized.rootCommit.id],
          }),
        ]),
      );

      const branchCommits = await mainWb.version.listCommits({
        ref: BASIC_FLOW_BRANCH_REF as any,
      });
      if (!branchCommits.ok)
        throw new Error(`expected branch listCommits success: ${branchCommits.error.code}`);
      expect(branchCommits.value.items.map((commit) => commit.id)).toEqual(
        expect.arrayContaining([branchCommit.id, baseCommit.id, initialized.rootCommit.id]),
      );

      const refs = await mainWb.version.listRefs();
      if (!refs.ok) throw new Error(`expected listRefs success: ${refs.error.code}`);
      expect(refs.value.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: MATERIALIZER_TARGET_REF,
            commitId: mergeCommitId,
          }),
          expect.objectContaining({
            name: BASIC_FLOW_BRANCH_REF,
            commitId: branchCommit.id,
          }),
        ]),
      );

      verifyWb = await verifyHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(verifyWb);
      verifyWb.markClean();
      const finalCheckout = await verifyWb.version.checkout({
        kind: 'ref',
        name: MATERIALIZER_TARGET_REF,
      });
      if (!finalCheckout.ok) {
        throw new Error(`expected final main checkout success: ${finalCheckout.error.code}`);
      }
      expect(finalCheckout.value).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
      });
      await expect(verifyWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(verifyWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'branch' });
      await expect(verifyWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: 'main' });
    } finally {
      if (verifyWb) await verifyWb.close('skipSave');
      if (branchWb) await branchWb.close('skipSave');
      if (mainWb) await mainWb.close('skipSave');
      await verifyHandle.dispose();
      await branchHandle.dispose();
      await mainHandle.dispose();
    }
  });
});
