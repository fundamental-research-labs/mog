import { describe, expect, it } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { createIndexedDbVersionStoreProvider } from '../../../document/version-store/provider-indexeddb/backend';
import { XLSX_IMPORT_ROOT_GRAPH_ID } from '../../../document/version-store/xlsx-import-root';
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
import { expectedCellDiff } from './version-indexeddb-public-cell-edit-diff-test-utils';
import {
  createSourceXlsx,
  durableIndexedDbVersioning,
  resetVersionStoreIndexedDbForXlsxImportRootTests,
} from './version-xlsx-import-root-test-utils';

const BASIC_FLOW_BRANCH_NAME = 'scenario/basic-production-flow';
const BASIC_FLOW_BRANCH_REF = 'refs/heads/scenario/basic-production-flow';
const IMPORTED_FIXTURE_BRANCH_NAME = 'scenario/basic-production-flow-imported-fixture';
const IMPORTED_FIXTURE_BRANCH_REF = 'refs/heads/scenario/basic-production-flow-imported-fixture';
const IMPORTED_FIXTURE_DOCUMENT_ID_PREFIX = 'vc-basic-production-flow-imported-fixture';
const IMPORTED_FIXTURE_A1_VALUE = 'Imported basic version flow fixture';
const IMPORTED_FIXTURE_BASE_EDIT = 'base edit after imported fixture root';
const IMPORTED_FIXTURE_BRANCH_EDIT = 'branch edit after imported fixture root';
const IMPORTED_FIXTURE_MAIN_EDIT = 'main edit after imported fixture root';

describe('WorkbookVersion basic production flow', () => {
  it('imports a real workbook fixture and runs the public branch checkout merge flow end to end', async () => {
    await resetVersionStoreIndexedDbForXlsxImportRootTests();

    const documentId = `${IMPORTED_FIXTURE_DOCUMENT_ID_PREFIX}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const documentScope: VersionDocumentScope = { documentId };
    const xlsxBytes = await createSourceXlsx(IMPORTED_FIXTURE_A1_VALUE);
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX fixture import success: ${imported.error?.message}`);
    }
    const importedHandle = imported.handle;

    const branchHandle = await DocumentFactory.create({
      documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const verifyHandle = await DocumentFactory.create({
      documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(importedHandle, branchHandle, verifyHandle);

    let mainWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let verifyWb: Workbook | undefined;
    const graphProvider = createIndexedDbVersionStoreProvider({ documentScope });

    try {
      mainWb = await importedHandle.workbook({
        versioning: withVersionManifest(durableIndexedDbVersioning()),
      });
      installVersionDomainDetectorNoopsOnWorkbook(mainWb);

      const rootHead = await expectHead(mainWb);
      expect(rootHead).toMatchObject({
        refName: 'refs/heads/main',
        resolvedFrom: 'HEAD',
      });
      await expect(mainWb.activeSheet.getValue('A1')).resolves.toBe(IMPORTED_FIXTURE_A1_VALUE);
      await expect(mainWb.activeSheet.getValue('B1')).resolves.toBe(42);

      await mainWb.activeSheet.setCell('C1', IMPORTED_FIXTURE_BASE_EDIT);
      const baseCommit = await expectCommit(
        mainWb.version.commit({
          message: 'base edit after imported fixture root',
          expectedHead: {
            commitId: rootHead.id,
            revision: requireRefRevision(rootHead),
          },
        }),
      );
      expect(baseCommit.parents).toEqual([rootHead.id]);
      const baseHead = await expectHead(mainWb);

      const branch = await mainWb.version.createBranch({
        name: IMPORTED_FIXTURE_BRANCH_NAME as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);
      expect(branch.value).toMatchObject({
        name: IMPORTED_FIXTURE_BRANCH_REF,
        commitId: baseCommit.id,
      });

      branchWb = await branchHandle.workbook({
        versioning: withVersionManifest(durableIndexedDbVersioning()),
      });
      installVersionDomainDetectorNoopsOnWorkbook(branchWb);
      branchWb.markClean();
      const branchCheckout = await branchWb.version.checkout({
        kind: 'ref',
        name: branch.value.name,
      });
      if (!branchCheckout.ok) {
        throw new Error(`expected imported fixture branch checkout: ${branchCheckout.error.code}`);
      }
      expect(branchCheckout.value).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
      });
      await expect(branchWb.activeSheet.getValue('A1')).resolves.toBe(IMPORTED_FIXTURE_A1_VALUE);
      await expect(branchWb.activeSheet.getValue('B1')).resolves.toBe(42);
      await expect(branchWb.activeSheet.getValue('C1')).resolves.toBe(IMPORTED_FIXTURE_BASE_EDIT);

      await branchWb.activeSheet.setCell('D1', IMPORTED_FIXTURE_BRANCH_EDIT);
      const branchCommit = await expectCommit(
        branchWb.version.commit({
          message: 'branch edit after imported fixture root',
          expectedHead: {
            commitId: baseCommit.id,
            revision: branch.value.revision,
          },
        }),
      );
      expect(branchCommit.parents).toEqual([baseCommit.id]);

      await mainWb.activeSheet.setCell('E1', IMPORTED_FIXTURE_MAIN_EDIT);
      const oursCommit = await expectCommit(
        mainWb.version.commit({
          message: 'main edit after imported fixture root',
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      expect(oursCommit.parents).toEqual([baseCommit.id]);
      const oursHead = await expectHead(mainWb);

      const mergeInput = {
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: branchCommit.id,
      };
      const preview = await mainWb.version.merge(mergeInput);
      if (!preview.ok) {
        throw new Error(`expected imported fixture clean merge preview: ${preview.error.code}`);
      }
      expect(preview.value).toMatchObject({
        status: 'clean',
        conflicts: [],
      });

      const applied = await mainWb.version.applyMerge(mergeInput, {
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead: {
          commitId: oursCommit.id,
          revision: requireRefRevision(oursHead),
        },
      });
      if (!applied.ok) {
        throw new Error(`expected imported fixture applyMerge success: ${applied.error.code}`);
      }
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: branchCommit.id,
        mutationGuarantee: 'merge-commit-created',
        commitRef: {
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
      });
      if (applied.value.status !== 'applied') {
        throw new Error(`expected applied merge result, got ${applied.value.status}`);
      }
      const mergeCommitId = applied.value.commitRef.id;

      await expect(mainWb.version.readRef('HEAD')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'HEAD',
            target: 'refs/heads/main',
          },
        },
      });
      await expect(mainWb.version.readRef('refs/heads/main')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/main',
            commitId: mergeCommitId,
          },
        },
      });
      await expect(
        mainWb.version.readRef(IMPORTED_FIXTURE_BRANCH_REF as any),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: IMPORTED_FIXTURE_BRANCH_REF,
            commitId: branchCommit.id,
          },
        },
      });

      const mainCommits = await mainWb.version.listCommits();
      if (!mainCommits.ok) {
        throw new Error(`expected imported fixture listCommits: ${mainCommits.error.code}`);
      }
      expect(mainCommits.value.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: mergeCommitId, parents: [oursCommit.id, branchCommit.id] }),
          expect.objectContaining({ id: oursCommit.id, parents: [baseCommit.id] }),
          expect.objectContaining({ id: branchCommit.id, parents: [baseCommit.id] }),
          expect.objectContaining({ id: baseCommit.id, parents: [rootHead.id] }),
          expect.objectContaining({ id: rootHead.id, parents: [] }),
        ]),
      );

      const branchCommits = await mainWb.version.listCommits({
        ref: IMPORTED_FIXTURE_BRANCH_REF as any,
      });
      if (!branchCommits.ok) {
        throw new Error(
          `expected imported fixture branch listCommits: ${branchCommits.error.code}`,
        );
      }
      expect(branchCommits.value.items.map((commit) => commit.id)).toEqual(
        expect.arrayContaining([branchCommit.id, baseCommit.id, rootHead.id]),
      );

      const refs = await mainWb.version.listRefs();
      if (!refs.ok) throw new Error(`expected imported fixture listRefs: ${refs.error.code}`);
      expect(refs.value.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'refs/heads/main', commitId: mergeCommitId }),
          expect.objectContaining({
            name: IMPORTED_FIXTURE_BRANCH_REF,
            commitId: branchCommit.id,
          }),
        ]),
      );

      const baseDiff = await mainWb.version.diff(rootHead.id, baseCommit.id);
      if (!baseDiff.ok) {
        throw new Error(`expected imported fixture base diff: ${baseDiff.error.code}`);
      }
      expect(baseDiff.value.items).toEqual(
        expect.arrayContaining([expectedCellDiff('C1', IMPORTED_FIXTURE_BASE_EDIT)]),
      );

      const branchDiff = await mainWb.version.diff(baseCommit.id, branchCommit.id);
      if (!branchDiff.ok) {
        throw new Error(`expected imported fixture branch diff: ${branchDiff.error.code}`);
      }
      expect(branchDiff.value.items).toEqual(
        expect.arrayContaining([expectedCellDiff('D1', IMPORTED_FIXTURE_BRANCH_EDIT)]),
      );

      verifyWb = await verifyHandle.workbook({
        versioning: withVersionManifest(durableIndexedDbVersioning()),
      });
      installVersionDomainDetectorNoopsOnWorkbook(verifyWb);
      verifyWb.markClean();

      const mergeDiff = await verifyWb.version.diff(oursCommit.id, mergeCommitId);
      if (!mergeDiff.ok) {
        throw new Error(
          `expected imported fixture merge diff: ${mergeDiff.error.code} ${JSON.stringify(
            mergeDiff.error.diagnostics,
          )}`,
        );
      }
      expect(mergeDiff.value.items).toEqual(
        expect.arrayContaining([expectedCellDiff('D1', IMPORTED_FIXTURE_BRANCH_EDIT)]),
      );

      const graph = await graphProvider.openGraph(
        namespaceForDocumentScope(documentScope, XLSX_IMPORT_ROOT_GRAPH_ID),
      );
      await expect(graph.readRef('refs/heads/main')).resolves.toMatchObject({
        status: 'success',
        ref: {
          name: 'refs/heads/main',
          commitId: mergeCommitId,
        },
      });
      await expect(graph.readRef(IMPORTED_FIXTURE_BRANCH_REF)).resolves.toMatchObject({
        status: 'success',
        ref: {
          name: IMPORTED_FIXTURE_BRANCH_REF,
          commitId: branchCommit.id,
        },
      });

      const verifyCheckout = await verifyWb.version.checkout({
        kind: 'ref',
        name: 'refs/heads/main',
      });
      if (!verifyCheckout.ok) {
        throw new Error(`expected imported fixture final checkout: ${verifyCheckout.error.code}`);
      }
      expect(verifyCheckout.value).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
      });
      await expect(verifyWb.activeSheet.getValue('A1')).resolves.toBe(IMPORTED_FIXTURE_A1_VALUE);
      await expect(verifyWb.activeSheet.getValue('B1')).resolves.toBe(42);
      await expect(verifyWb.activeSheet.getValue('C1')).resolves.toBe(IMPORTED_FIXTURE_BASE_EDIT);
      await expect(verifyWb.activeSheet.getValue('D1')).resolves.toBe(IMPORTED_FIXTURE_BRANCH_EDIT);
      await expect(verifyWb.activeSheet.getValue('E1')).resolves.toBe(IMPORTED_FIXTURE_MAIN_EDIT);
    } finally {
      if (verifyWb) await verifyWb.close('skipSave');
      if (branchWb) await branchWb.close('skipSave');
      if (mainWb) await mainWb.close('skipSave');
      await verifyHandle.dispose();
      await branchHandle.dispose();
      await importedHandle.dispose();
      await graphProvider.dispose();
      await resetVersionStoreIndexedDbForXlsxImportRootTests();
    }
  });

  it('commits edits, branches, checks out branch/main, applies a clean merge, and lists commits/refs', async () => {
    const { documentScope, provider, initialized } =
      await initializeMaterializerGraph('basic-production-flow');
    const mainHandle = await createMaterializerDocumentHandle(documentScope);
    const branchHandle = await createMaterializerDocumentHandle(documentScope);
    const verifyHandle = await createMaterializerDocumentHandle(documentScope);
    const revertVerifyHandle = await createMaterializerDocumentHandle(documentScope);
    installVersionDomainDetectorNoopsOnHandles(
      mainHandle,
      branchHandle,
      verifyHandle,
      revertVerifyHandle,
    );

    let mainWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let verifyWb: Workbook | undefined;
    let revertVerifyWb: Workbook | undefined;

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
      const mergeHead = await expectHead(mainWb);

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

      const revertedMerge = await mainWb.version.revert({
        target: { kind: 'mergeCommit', commitId: mergeCommitId, mainlineParent: 1 },
        targetRef: MATERIALIZER_TARGET_REF as any,
        expectedTargetHead: {
          commitId: mergeCommitId,
          revision: requireRefRevision(mergeHead),
        },
        reason: 'regression-test-basic-flow-revert-merge',
      });
      if (!revertedMerge.ok) {
        throw new Error(`expected merge revert success: ${revertedMerge.error.code}`);
      }
      expect(revertedMerge.value).toMatchObject({
        status: 'applied',
        target: { kind: 'mergeCommit', commitId: mergeCommitId, mainlineParent: 1 },
        mutationGuarantee: 'revert-commit-created',
        commitRef: {
          refName: MATERIALIZER_TARGET_REF,
          resolvedFrom: MATERIALIZER_TARGET_REF,
        },
      });
      if (revertedMerge.value.status !== 'applied' || !revertedMerge.value.commitRef) {
        throw new Error(`expected applied merge revert result, got ${revertedMerge.value.status}`);
      }
      const revertCommitId = revertedMerge.value.commitRef.id;

      const revertedCommits = await mainWb.version.listCommits();
      if (!revertedCommits.ok)
        throw new Error(`expected reverted listCommits success: ${revertedCommits.error.code}`);
      expect(revertedCommits.value.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: revertCommitId,
            parents: [mergeCommitId],
          }),
          expect.objectContaining({
            id: mergeCommitId,
            parents: [oursCommit.id, branchCommit.id],
          }),
        ]),
      );

      revertVerifyWb = await revertVerifyHandle.workbook({
        versioning: withVersionManifest({ provider }),
      });
      installVersionDomainDetectorNoopsOnWorkbook(revertVerifyWb);
      revertVerifyWb.markClean();
      const revertedCheckout = await revertVerifyWb.version.checkout({
        kind: 'ref',
        name: MATERIALIZER_TARGET_REF,
      });
      if (!revertedCheckout.ok) {
        throw new Error(`expected reverted main checkout success: ${revertedCheckout.error.code}`);
      }
      expect(revertedCheckout.value).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
      });
      await expect(revertVerifyWb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: revertCommitId,
          refName: MATERIALIZER_TARGET_REF,
        },
      });
      await expect(revertVerifyWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'base',
      });
      await expect(revertVerifyWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: null,
      });
      await expect(revertVerifyWb.activeSheet.getCell('C1')).resolves.toMatchObject({
        value: 'main',
      });
    } finally {
      if (revertVerifyWb) await revertVerifyWb.close('skipSave');
      if (verifyWb) await verifyWb.close('skipSave');
      if (branchWb) await branchWb.close('skipSave');
      if (mainWb) await mainWb.close('skipSave');
      await revertVerifyHandle.dispose();
      await verifyHandle.dispose();
      await branchHandle.dispose();
      await mainHandle.dispose();
    }
  });
});
