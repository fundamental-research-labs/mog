import 'fake-indexeddb/auto';

import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  addMogVersionMetadataToXlsx,
  readAndValidateMogVersionMetadataFromXlsx,
} from '../xlsx-version-metadata';
import {
  withExportSupportedVersionManifest,
  withVersionManifest,
} from './version-domain-support-test-utils';
import {
  CLEAN_EXPORT_DOCUMENT_ID,
  createSourceXlsx,
  DOCUMENT_ID,
  durableIndexedDbVersioning,
  expectContractedXlsxExportBlocked,
  OLD_METADATA_COMMIT_ID,
  readRootSemanticChangeSetPayload,
  resetVersionStoreIndexedDbForXlsxImportRootTests,
  testVersionMetadata,
} from './version-xlsx-import-root-test-utils';

beforeEach(resetVersionStoreIndexedDbForXlsxImportRootTests);
afterEach(resetVersionStoreIndexedDbForXlsxImportRootTests);

describe('WorkbookVersion XLSX import root', () => {
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

  it('allows clean XLSX export when the manifest proves required export coverage', async () => {
    const xlsxBytes = await createSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: CLEAN_EXPORT_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: withVersionManifest(durableIndexedDbVersioning()),
      });

      await expect(wb.version.getHead()).resolves.toMatchObject({ ok: true });

      const exported = await wb.toXlsx({ contextStripped: true });
      expect(exported.byteLength).toBeGreaterThan(100);
      expect(
        readAndValidateMogVersionMetadataFromXlsx(exported, {
          expectedDocumentId: CLEAN_EXPORT_DOCUMENT_ID,
        }),
      ).toMatchObject({
        status: 'absent',
      });
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('fails closed before clean XLSX export when a caller self-promotes export support', async () => {
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: 'stale-imported-document',
        commitId: OLD_METADATA_COMMIT_ID,
      }),
    );
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: CLEAN_EXPORT_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: withExportSupportedVersionManifest(durableIndexedDbVersioning()),
      });

      await expect(wb.version.getHead()).resolves.toMatchObject({ ok: true });

      await expectContractedXlsxExportBlocked(wb.toXlsx());
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });
});
