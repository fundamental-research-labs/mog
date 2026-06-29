import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  DOCUMENT_ID,
  DOCUMENT_SCOPE,
  expectInitializeSuccess,
  expectedCellDiff,
  expectedSemanticDigest,
  initializeInput,
  readSemanticChangeSetPayload,
} from './version/public-cell-edit-diff.helpers';

export function registerPublicPlainTextEditScenario(): void {
  it('commits a single plain text edit from public APIs', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });
      await wb.activeSheet.setCell('A1', 'base');

      const commitResult = await wb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) {
        throw new Error(
          `expected public text edit commit success: ${commitResult.error.code}: ${JSON.stringify(
            commitResult.error,
          )}`,
        );
      }

      const storedSemanticChangeSet = await readSemanticChangeSetPayload(
        provider,
        commitResult.value.id,
      );
      expect(storedSemanticChangeSet).toMatchObject({
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticDiff',
          beforeStateDigest: expectedSemanticDigest(),
          afterStateDigest: expectedSemanticDigest(),
        },
        reviewChanges: [expectedCellDiff('A1', 'base')],
      });
      expect(storedSemanticChangeSet.semanticDiff.changes.length).toBeGreaterThan(0);

      const diffResult = await wb.version.diff(initialized.rootCommit.id, commitResult.value.id);
      expect(diffResult).toMatchObject({
        ok: true,
        value: {
          items: [expectedCellDiff('A1', 'base')],
        },
      });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });

  it('projects committed same-address cell edits with sheet-qualified display names', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });
      await wb.activeSheet.setCell('B3', 'Same');
      const sheet2 = await wb.sheets.add('Sheet2');
      await sheet2.setCell('B3', 'Same');

      const commitResult = await wb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) {
        throw new Error(
          `expected multi-sheet edit commit success: ${commitResult.error.code}: ${JSON.stringify(
            commitResult.error,
          )}`,
        );
      }

      const overview = await wb.version.diffOverview(
        initialized.rootCommit.id,
        commitResult.value.id,
        { groupLimit: 10 },
      );
      expect(overview.ok).toBe(true);
      if (!overview.ok) throw new Error(`expected diff overview success: ${overview.error.code}`);

      const detailPages = await Promise.all(
        overview.value.groups.items.map((group) =>
          wb!.version.diffGroupDetail(initialized.rootCommit.id, commitResult.value.id, {
            groupId: group.groupId,
            pageSize: 10,
          }),
        ),
      );
      const detailItems = detailPages.flatMap((page) => {
        expect(page.ok).toBe(true);
        if (!page.ok) throw new Error(`expected group detail success: ${page.error.code}`);
        return page.value.items;
      });

      expect(detailItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'cell',
              propertyPath: ['value'],
            }),
            after: { kind: 'value', value: 'Same' },
            display: {
              sheetName: { kind: 'value', value: 'Sheet1' },
              address: { kind: 'value', value: 'B3' },
            },
          }),
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'cell',
              propertyPath: ['value'],
            }),
            after: { kind: 'value', value: 'Same' },
            display: {
              sheetName: { kind: 'value', value: 'Sheet2' },
              address: { kind: 'value', value: 'B3' },
            },
          }),
        ]),
      );
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });

  it('reports a semantically reverted public cell edit as clean in version surface status', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });

      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        current: { headCommitId: initialized.rootCommit.id },
        dirty: {
          hasUncommittedLocalChanges: false,
          commitEligibleChanges: false,
          checkoutSafe: true,
        },
      });

      await wb.activeSheet.setCell('A1', 'hello');
      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        dirty: {
          hasUncommittedLocalChanges: true,
          commitEligibleChanges: true,
          checkoutSafe: false,
        },
      });

      await wb.activeSheet.clear('A1', 'contents');

      const surfaceAfterRevert = await wb.version.getSurfaceStatus();
      expect((wb as Workbook & { readonly isDirty: boolean }).isDirty).toBe(true);
      expect(surfaceAfterRevert.dirty).toMatchObject({
        hasUncommittedLocalChanges: false,
        commitEligibleChanges: false,
        checkoutSafe: true,
      });
      expect(surfaceAfterRevert.dirty.statusRevision).toEqual(
        expect.stringContaining('rawDirty:yes'),
      );
      expect(surfaceAfterRevert.dirty.statusRevision).toEqual(
        expect.stringContaining('semantic:basis:'),
      );
      expect(surfaceAfterRevert.dirty.statusRevision).toEqual(expect.stringContaining('dirty:no'));
      expect(surfaceAfterRevert.dirty.unsafeReasons).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'version.surfaceStatus.dirtyWorkingState' }),
        ]),
      );
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
}
