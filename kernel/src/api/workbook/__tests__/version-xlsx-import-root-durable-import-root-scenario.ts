import type { Workbook } from '@mog-sdk/contracts/api';

import {
  createDocumentLifecycleSnapshotRootHydrator,
  type SnapshotRootFreshLifecycleMaterialization,
} from '../../document/snapshot-root-lifecycle-hydrator';
import { DocumentFactory } from '../../document/document-factory';
import { createSnapshotRootReloadService } from '../../../document/version-store/snapshot-root-reload-service';
import type { MirrorReadView } from '../../../document/state-mirror';
import {
  createSourceXlsx,
  createViewStateSourceXlsx,
  DOCUMENT_ID,
  durableIndexedDbVersioning,
  readRootSemanticChangeSetPayload,
  readRootSnapshotRootRecord,
} from './version-xlsx-import-root-test-utils';
import { decodeUtf8, readZipArchive } from './xlsx-clean-export-package-zip-test-utils';

type WorkbookWithMirror = Workbook & { readonly mirror: MirrorReadView };

export function registerDurableImportRootScenario(): void {
  it('initializes a durable semantic import-root commit for XLSX imports', async () => {
    const xlsxBytes = await createSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
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
    let reopenedWb: Workbook | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: durableIndexedDbVersioning(),
      });

      const head = await wb.version.getHead();
      expect(head).toMatchObject({
        ok: true,
        value: {
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });
      if (!head.ok) throw new Error(`expected import-root head: ${head.error.code}`);
      expect(wb.isDirty).toBe(false);
      const rootCommitId = head.value.id;

      await expect(wb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: [
            expect.objectContaining({
              id: rootCommitId,
              parents: [],
              author: expect.objectContaining({
                actorKind: 'system',
                displayName: 'Mog XLSX Import',
              }),
            }),
          ],
        },
      });
      await expect(wb.version.commit({ mode: { kind: 'import-root' } })).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          diagnostics: [expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' })],
        },
      });

      const semanticPayload = await readRootSemanticChangeSetPayload(rootCommitId);
      expect(semanticPayload).toMatchObject({
        schemaVersion: 1,
        source: {
          kind: 'xlsxImportRoot',
          source: {
            sourceType: 'bytes',
            byteLength: xlsxBytes.byteLength,
          },
        },
        importDiagnostics: expect.any(Array),
        changes: [],
      });
      expect(semanticPayload).toHaveProperty('semanticState.stateDigest');
      expect(semanticPayload).toHaveProperty('source.semanticStateDigest');
      expect(
        (semanticPayload.source as { semanticStateDigest?: unknown }).semanticStateDigest,
      ).toEqual((semanticPayload.semanticState as { stateDigest?: unknown }).stateDigest);
      expect(semanticPayload).not.toHaveProperty('xlsxBytes');
      expect(semanticPayload).not.toHaveProperty('rawBytes');

      await wb.close('skipSave');
      wb = undefined;
      await imported.handle.dispose();

      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await reopenedHandle.workbook({
        versioning: durableIndexedDbVersioning(),
      });

      await expect(reopenedWb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: { id: rootCommitId },
      });
    } finally {
      await reopenedWb?.close('skipSave').catch(() => {});
      await reopenedHandle?.dispose().catch(() => {});
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('captures workbook and sheet view metadata in the durable import-root snapshot', async () => {
    const xlsxBytes = createViewStateSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
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
    let materialized: SnapshotRootFreshLifecycleMaterialization | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: durableIndexedDbVersioning(),
      });

      const head = await wb.version.getHead();
      expect(head).toMatchObject({
        ok: true,
        value: {
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });
      if (!head.ok) throw new Error(`expected import-root head: ${head.error.code}`);

      const snapshotRootRecord = await readRootSnapshotRootRecord(head.value.id);
      const reloadService = createSnapshotRootReloadService({
        hydrator: createDocumentLifecycleSnapshotRootHydrator({
          userTimezone: 'UTC',
          documentIdFactory: () => `${DOCUMENT_ID}-view-state-snapshot-root`,
        }),
      });
      const reload = await reloadService.reloadSnapshotRoot(snapshotRootRecord);
      expect(reload.ok).toBe(true);
      if (!reload.ok) {
        throw new Error(`expected snapshot-root reload success: ${reload.error.code}`);
      }
      materialized = reload.materialized;
      await materialized.context.computeBridge.settleForMirror();

      const materializedWb = materialized.workbook as WorkbookWithMirror;
      const activeSheet = await materializedWb.getSheet('Second');
      expect(activeSheet.name).toBe('Second');
      await expect(activeSheet.getCell('C4')).resolves.toMatchObject({ value: 2 });

      await expect(activeSheet.view.getFrozenPanes()).resolves.toEqual({ rows: 3, cols: 2 });
      await expect(activeSheet.view.getScrollPosition()).resolves.toEqual({
        topRow: 3,
        leftCol: 2,
      });
      await expect(activeSheet.view.getViewOptions()).resolves.toEqual({
        showGridlines: false,
        showRowHeaders: false,
        showColumnHeaders: false,
      });

      const settings = await materializedWb.getSettings();
      expect(settings.selectedSheetIds).toEqual([activeSheet.sheetId]);
      expect(materializedWb.mirror.getSelectedSheetIds()).toEqual([activeSheet.sheetId]);
      expect(materializedWb.mirror.getSheetSettings(activeSheet.sheetId)).toMatchObject({
        showGridlines: false,
        showRowHeaders: false,
        showColumnHeaders: false,
        showZeroValues: false,
        showFormulas: true,
        rightToLeft: true,
        zoomScale: 125,
      });
      expect(materializedWb.mirror.getViewSelection(activeSheet.sheetId)).toEqual({
        activeCell: { row: 3, col: 2 },
        ranges: [{ startRow: 3, startCol: 2, endRow: 3, endCol: 2 }],
      });

      const exported = await materializedWb.toXlsx();
      const workbookXml = readXlsxPartText(exported, 'xl/workbook.xml');
      expect(workbookXml).toContain('activeTab="1"');
      expect(workbookXml).toContain('firstSheet="1"');
      expect(workbookXml).toMatch(/showHorizontalScroll="(?:0|false)"/);
      expect(workbookXml).toMatch(/showSheetTabs="(?:0|false)"/);

      const secondSheetXml = readXlsxPartText(exported, 'xl/worksheets/sheet2.xml');
      expect(secondSheetXml).toContain('zoomScale="125"');
      expect(secondSheetXml).toMatch(/rightToLeft="(?:1|true)"/);
      expect(secondSheetXml).toMatch(/showFormulas="(?:1|true)"/);
      expect(secondSheetXml).toMatch(/showZeros="(?:0|false)"/);
      expect(secondSheetXml).toContain('topLeftCell="C4"');
      expect(secondSheetXml).toContain('activeCell="C4"');
      expect(secondSheetXml).toContain('sqref="C4"');
    } finally {
      await materialized?.dispose().catch(() => {});
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });
}

function readXlsxPartText(xlsxBytes: Uint8Array, partName: string): string {
  const entry = readZipArchive(xlsxBytes).find((candidate) => candidate.name === partName);
  if (!entry) throw new Error(`missing XLSX part ${partName}`);
  return decodeUtf8(entry.data);
}
