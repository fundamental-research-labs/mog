import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';

import type { VersionBranchName, VersionMainRefName, Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  expectCommit,
  expectHead,
  requireRefRevision,
} from './version-indexeddb-persisted-apply-test-helpers';
import {
  durableIndexedDbVersioning,
  resetVersionStoreIndexedDbForXlsxImportRootTests,
} from './version-xlsx-import-root-test-utils';

const DOCUMENT_ID = 'vc10-xlsx-materialized-clean-merge-real-fixture';
const MAIN_REF: VersionMainRefName = 'refs/heads/main';
const BRANCH_REF = 'scenario/xlsx-materialized-clean-merge' as VersionBranchName;
const FROZEN_PANES_FIXTURE = new URL(
  '../../../../../file-io/xlsx/parser/test-corpus/parity/cells/frozen-panes.xlsx',
  import.meta.url,
);

beforeEach(resetVersionStoreIndexedDbForXlsxImportRootTests);
afterEach(resetVersionStoreIndexedDbForXlsxImportRootTests);

describe('WorkbookVersion XLSX materialized merge real fixture', () => {
  it('materializes a clean branch merge from an XLSX import root while preserving imported sheet view state', async () => {
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: new Uint8Array(readFileSync(FROZEN_PANES_FIXTURE)) },
      {
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let branchHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: withVersionManifest(durableIndexedDbVersioning()),
      });

      const rootHead = await expectHead(wb);
      expect(rootHead).toMatchObject({
        refName: MAIN_REF,
        resolvedFrom: 'HEAD',
      });

      const branch = await wb.version.createBranch({
        name: BRANCH_REF,
        targetCommitId: rootHead.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await wb.activeSheet.setCell('D30', 'main edit after import root');
      const oursCommit = await expectCommit(
        wb.version.commit({
          message: 'main edit after XLSX import root',
          expectedHead: {
            commitId: rootHead.id,
            revision: requireRefRevision(rootHead),
          },
        }),
      );
      const oursHead = await expectHead(wb);

      branchHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      branchWb = await branchHandle.workbook({
        versioning: withVersionManifest(durableIndexedDbVersioning()),
      });
      const checkoutRoot = await branchWb.version.checkout({ kind: 'commit', id: rootHead.id });
      if (!checkoutRoot.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutRoot.error.code}`);
      }

      await branchWb.activeSheet.setCell('E30', 'branch edit after import root');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: BRANCH_REF,
          message: 'branch edit after XLSX import root',
          expectedHead: {
            commitId: rootHead.id,
            revision: branch.value.revision,
          },
        }),
      );

      const expectedTargetHead = {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      };
      const checkoutMain = await wb.version.checkout({ kind: 'ref', name: MAIN_REF });
      if (!checkoutMain.ok) {
        throw new Error(
          `expected main checkout before materialized apply: ${checkoutMain.error.code}`,
        );
      }
      expect(checkoutMain.value).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
      });
      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        current: {
          checkedOutCommitId: oursCommit.id,
          branchName: 'main',
          currentRefHeadId: oursCommit.id,
          refHeadAtMaterialization: oursCommit.id,
          detached: false,
          stale: false,
        },
      });
      const preview = await wb.version.merge(
        {
          base: rootHead.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: MAIN_REF,
          expectedTargetHead,
        },
      );
      if (!preview.ok) throw new Error(`expected clean merge preview: ${preview.error.code}`);
      expect(preview.value).toMatchObject({
        status: 'clean',
        base: rootHead.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
      });

      const applied = await wb.version.applyMerge(
        {
          base: rootHead.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          targetRef: MAIN_REF,
          expectedTargetHead,
          materializeActiveCheckout: true,
        },
      );
      if (!applied.ok) throw new Error(`expected materialized applyMerge: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resolutionCount: 0,
        mutationGuarantee: 'merge-commit-created',
      });

      const mergeCommitId = applied.value.commitRef.id;
      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        current: {
          headCommitId: mergeCommitId,
          checkedOutCommitId: mergeCommitId,
          branchName: 'main',
          currentRefHeadId: mergeCommitId,
          refHeadAtMaterialization: mergeCommitId,
          detached: false,
          stale: false,
        },
      });

      expect(wb.activeSheet.name).toBe('Frozen Row');
      await expect(wb.activeSheet.getCell('D30')).resolves.toMatchObject({
        value: 'main edit after import root',
      });
      await expect(wb.activeSheet.getCell('E30')).resolves.toMatchObject({
        value: 'branch edit after import root',
      });
      await expect(wb.activeSheet.view.getFrozenPanes()).resolves.toEqual({ rows: 1, cols: 0 });

      const frozenC5 = await wb.getSheet('Frozen C5');
      await expect(frozenC5.view.getFrozenPanes()).resolves.toEqual({ rows: 4, cols: 2 });
    } finally {
      await branchWb?.close('skipSave').catch(() => {});
      await branchHandle?.dispose().catch(() => {});
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  }, 90_000);
});
