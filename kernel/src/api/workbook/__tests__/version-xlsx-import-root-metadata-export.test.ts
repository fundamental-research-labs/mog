import 'fake-indexeddb/auto';

import type { ObjectDigest, Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  addMogVersionMetadataToXlsx,
  readAndValidateMogVersionMetadataFromXlsx,
} from '../version/xlsx-metadata/xlsx-version-metadata';
import {
  withExportSupportedVersionManifest,
  withVersionManifest,
} from './version-domain-support-test-utils';
import {
  createSourceXlsx,
  durableIndexedDbVersioning,
  expectContractedXlsxExportBlocked,
  METADATA_EXPORT_DOCUMENT_ID,
  METADATA_REPLACE_DOCUMENT_ID,
  OLD_METADATA_COMMIT_ID,
  readRootCommitPayload,
  resetVersionStoreIndexedDbForXlsxImportRootTests,
  testVersionMetadata,
} from './version-xlsx-import-root-test-utils';

beforeEach(resetVersionStoreIndexedDbForXlsxImportRootTests);
afterEach(resetVersionStoreIndexedDbForXlsxImportRootTests);

describe('WorkbookVersion XLSX import root metadata export', () => {
  it('exports trusted Mog version metadata sidecar when explicitly requested', async () => {
    const xlsxBytes = await createSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: METADATA_EXPORT_DOCUMENT_ID,
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

      const head = await wb.version.getHead();
      expect(head).toMatchObject({ ok: true });
      if (!head.ok) throw new Error(`expected import-root head: ${head.error.code}`);
      const commitPayload = await readRootCommitPayload(head.value.id, METADATA_EXPORT_DOCUMENT_ID);

      const exported = await wb.toXlsx({ contextStripped: true, versionMetadata: 'include' });
      const metadata = readAndValidateMogVersionMetadataFromXlsx(exported, {
        expectedDocumentId: METADATA_EXPORT_DOCUMENT_ID,
        expectedHead: {
          commitId: head.value.id,
          ...(head.value.refName ? { refName: head.value.refName } : {}),
          ...(head.value.resolvedFrom ? { resolvedFrom: head.value.resolvedFrom } : {}),
          ...(head.value.refRevision ? { refRevision: head.value.refRevision } : {}),
          semanticChangeSetDigest: commitPayload.semanticChangeSetDigest as ObjectDigest,
          snapshotRootDigest: commitPayload.snapshotRootDigest as ObjectDigest,
        },
      });
      expect(metadata).toMatchObject({
        status: 'trusted',
        metadata: {
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          head: {
            commitId: head.value.id,
          },
        },
      });
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('fails closed before Mog version metadata sidecar export when a caller self-promotes export support', async () => {
    const xlsxBytes = await createSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: METADATA_EXPORT_DOCUMENT_ID,
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

      const head = await wb.version.getHead();
      expect(head).toMatchObject({ ok: true });
      if (!head.ok) throw new Error(`expected import-root head: ${head.error.code}`);

      await expectContractedXlsxExportBlocked(wb.toXlsx({ versionMetadata: 'include' }));
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('fails closed before replacing an imported Mog version metadata sidecar', async () => {
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
        documentId: METADATA_REPLACE_DOCUMENT_ID,
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

      const head = await wb.version.getHead();
      expect(head).toMatchObject({ ok: true });
      if (!head.ok) throw new Error(`expected import-root head: ${head.error.code}`);

      await expectContractedXlsxExportBlocked(wb.toXlsx({ versionMetadata: 'include' }));
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });
});
