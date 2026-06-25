import type { ObjectDigest, Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { readAndValidateMogVersionMetadataFromXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  createViewStateSourceXlsx,
  durableIndexedDbVersioning,
  expectImportBranchCounts,
  readRootCommitPayload,
  readRootSemanticChangeSetPayload,
  TRUSTED_ROUNDTRIP_DOCUMENT_ID,
} from './version-xlsx-import-root-test-utils';

type XlsxImportHandle = NonNullable<
  Awaited<ReturnType<typeof DocumentFactory.createFromXlsx>>['handle']
>;
type DocumentHandle = Awaited<ReturnType<typeof DocumentFactory.create>>;

export function registerTrustedMetadataRoundTripScenario(): void {
  it('round-trips trusted XLSX metadata and version history', async () => {
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: createViewStateSourceXlsx() },
      {
        documentId: TRUSTED_ROUNDTRIP_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    let reimportedWb: Workbook | undefined;
    let reopenedWb: Workbook | undefined;
    let importedHandle: XlsxImportHandle | undefined = imported.handle;
    let reimportedHandle: XlsxImportHandle | undefined;
    let reopenedHandle: DocumentHandle | undefined;
    try {
      wb = await importedHandle.workbook({
        versioning: withVersionManifest(durableIndexedDbVersioning()),
      });
      await expectSecondSheetViewState(wb);

      const rootHead = await expectVersionHead(wb);
      const rootCommitPayload = await readRootCommitPayload(
        rootHead.id,
        TRUSTED_ROUNDTRIP_DOCUMENT_ID,
      );
      const rootSemanticPayload = await readRootSemanticChangeSetPayload(
        rootHead.id,
        TRUSTED_ROUNDTRIP_DOCUMENT_ID,
      );
      expect(rootSemanticPayload).toHaveProperty('semanticState.stateDigest');
      expect(rootSemanticPayload).toHaveProperty('semanticState.state');
      expect(rootSemanticPayload).toHaveProperty('source.semanticStateDigest');
      expect(
        (rootSemanticPayload.source as { semanticStateDigest?: unknown }).semanticStateDigest,
      ).toEqual((rootSemanticPayload.semanticState as { stateDigest?: unknown }).stateDigest);
      await expect(wb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: [expect.objectContaining({ id: rootHead.id, parents: [] })],
        },
      });

      const exported = await wb.toXlsx({ versionMetadata: 'include' });
      const expectedHead = {
        commitId: rootHead.id,
        ...(rootHead.refName ? { refName: rootHead.refName } : {}),
        ...(rootHead.resolvedFrom ? { resolvedFrom: rootHead.resolvedFrom } : {}),
        ...(rootHead.refRevision ? { refRevision: rootHead.refRevision } : {}),
        semanticChangeSetDigest: rootCommitPayload.semanticChangeSetDigest as ObjectDigest,
        snapshotRootDigest: rootCommitPayload.snapshotRootDigest as ObjectDigest,
      };
      const metadata = readAndValidateMogVersionMetadataFromXlsx(exported, {
        expectedDocumentId: TRUSTED_ROUNDTRIP_DOCUMENT_ID,
        expectedHead,
      });
      expect(metadata).toMatchObject({
        status: 'trusted',
        metadata: {
          documentId: TRUSTED_ROUNDTRIP_DOCUMENT_ID,
          head: {
            commitId: rootHead.id,
            semanticChangeSetDigest: expectedHead.semanticChangeSetDigest,
            snapshotRootDigest: expectedHead.snapshotRootDigest,
          },
        },
      });

      await wb.close('skipSave');
      wb = undefined;
      await importedHandle.dispose();
      importedHandle = undefined;

      const reimported = await DocumentFactory.createFromXlsx({ type: 'bytes', data: exported }, {
        documentId: TRUSTED_ROUNDTRIP_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
        versioning: withVersionManifest(durableIndexedDbVersioning()),
      } as Parameters<typeof DocumentFactory.createFromXlsx>[1] & { versioning: unknown });
      expect(reimported.success).toBe(true);
      if (!reimported.success || !reimported.handle) {
        throw new Error(`expected trusted XLSX reimport success: ${reimported.error?.message}`);
      }
      expect(reimported.warnings).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            diagnostic: expect.objectContaining({
              code: expect.stringMatching(/^mogVersionMetadata(?:Untrusted|Stale)$/),
            }),
          }),
        ]),
      );
      reimportedHandle = reimported.handle;
      reimportedWb = await reimportedHandle.workbook({
        versioning: withVersionManifest(durableIndexedDbVersioning()),
      });
      await expectSecondSheetViewState(reimportedWb);
      await expectVersionHeadId(reimportedWb, rootHead.id);
      await expect(reimportedWb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: [expect.objectContaining({ id: rootHead.id, parents: [] })],
        },
      });
      await expectImportBranchCounts(TRUSTED_ROUNDTRIP_DOCUMENT_ID, {
        externalChange: 1,
        newRoot: 0,
      });

      await reimportedWb.close('skipSave');
      reimportedWb = undefined;
      await reimportedHandle.dispose();
      reimportedHandle = undefined;

      reopenedHandle = await DocumentFactory.create({
        documentId: TRUSTED_ROUNDTRIP_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await reopenedHandle.workbook({
        versioning: withVersionManifest(durableIndexedDbVersioning()),
      });
      await expectVersionHeadId(reopenedWb, rootHead.id);
      const checkout = await reopenedWb.version.checkout({
        kind: 'commit',
        id: rootHead.id,
      });
      expect(checkout).toMatchObject({
        ok: true,
        value: { status: 'success', materialization: 'applied' },
      });
      await expectSecondSheetViewState(reopenedWb);
    } finally {
      await reopenedWb?.close('skipSave').catch(() => {});
      await reopenedHandle?.dispose().catch(() => {});
      await reimportedWb?.close('skipSave').catch(() => {});
      await reimportedHandle?.dispose().catch(() => {});
      await wb?.close('skipSave').catch(() => {});
      await importedHandle?.dispose().catch(() => {});
    }
  });
}

async function expectSecondSheetViewState(wb: Workbook): Promise<void> {
  const secondSheet = await wb.getSheet('Second');
  expect(secondSheet.name).toBe('Second');
  await expect(secondSheet.getCell('C4')).resolves.toMatchObject({ value: 2 });
  await expect(secondSheet.view.getFrozenPanes()).resolves.toEqual({ rows: 3, cols: 2 });
  await expect(secondSheet.view.getScrollPosition()).resolves.toEqual({ topRow: 3, leftCol: 2 });
  await expect(secondSheet.view.getViewOptions()).resolves.toEqual({
    showGridlines: false,
    showRowHeaders: false,
    showColumnHeaders: false,
  });
  const settings = await wb.getSettings();
  expect(settings.selectedSheetIds).toEqual([secondSheet.sheetId]);
}

async function expectVersionHead(wb: Workbook) {
  const head = await wb.version.getHead();
  expect(head).toMatchObject({ ok: true });
  if (!head.ok) {
    throw new Error(`expected import-root head: ${head.error.code}`);
  }
  return head.value;
}

async function expectVersionHeadId(wb: Workbook, expectedId: string): Promise<void> {
  const head = await wb.version.getHead();
  if (!head.ok) {
    throw new Error(`expected version head ${expectedId}: ${JSON.stringify(head.error)}`);
  }
  expect(head.value.id).toBe(expectedId);
}
