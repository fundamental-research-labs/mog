import 'fake-indexeddb/auto';

import type { ObjectDigest, Workbook, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  addMogVersionMetadataToXlsx,
  type MogWorkbookVersionXlsxMetadata,
} from '../version/xlsx-metadata/xlsx-version-metadata';
import { withExportSupportedVersionManifest } from './version-domain-support-test-utils';
import { installMetadataTrustIndexedDbHooks } from './version-xlsx-import-root-metadata-trust-test-utils';
import {
  createSourceXlsx,
  durableIndexedDbVersioning,
  METADATA_TRUST_REIMPORT_DOCUMENT_ID,
  readRootCommitPayload,
  testVersionMetadata,
} from './version-xlsx-import-root-test-utils';

installMetadataTrustIndexedDbHooks();

describe('WorkbookVersion XLSX import root metadata trust', () => {
  it('trusts same-document XLSX metadata when local authority is available', async () => {
    const originalXlsxBytes = await createSourceXlsx('Original import root');
    const originalImport = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: originalXlsxBytes },
      {
        documentId: METADATA_TRUST_REIMPORT_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(originalImport.success).toBe(true);
    if (!originalImport.success || !originalImport.handle) {
      throw new Error(`expected original XLSX import success: ${originalImport.error?.message}`);
    }

    let originalWb: Workbook | undefined;
    let originalRootId: WorkbookCommitId | undefined;
    let originalMetadata: MogWorkbookVersionXlsxMetadata | undefined;
    try {
      originalWb = await originalImport.handle.workbook({
        versioning: withExportSupportedVersionManifest(durableIndexedDbVersioning()),
      });
      const head = await originalWb.version.getHead();
      expect(head).toMatchObject({ ok: true });
      if (!head.ok) throw new Error(`expected original import-root head: ${head.error.code}`);
      originalRootId = head.value.id;
      const commitPayload = await readRootCommitPayload(
        originalRootId,
        METADATA_TRUST_REIMPORT_DOCUMENT_ID,
      );
      originalMetadata = testVersionMetadata({
        documentId: METADATA_TRUST_REIMPORT_DOCUMENT_ID,
        commitId: originalRootId,
        ...(head.value.refRevision ? { refRevision: head.value.refRevision } : {}),
        semanticChangeSetDigest: commitPayload.semanticChangeSetDigest as ObjectDigest,
        snapshotRootDigest: commitPayload.snapshotRootDigest as ObjectDigest,
      });
    } finally {
      await originalWb?.close('skipSave').catch(() => {});
      await originalImport.handle.dispose().catch(() => {});
    }
    if (!originalRootId) throw new Error('expected original root id');
    if (!originalMetadata) throw new Error('expected original metadata sidecar');

    const reimportedXlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx('Externally edited import'),
      originalMetadata,
    );
    const reimported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: reimportedXlsxBytes },
      {
        documentId: METADATA_TRUST_REIMPORT_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(reimported.success).toBe(true);
    if (!reimported.success || !reimported.handle) {
      throw new Error(`expected reimport XLSX import success: ${reimported.error?.message}`);
    }
    expect(reimported.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          diagnostic: expect.objectContaining({ code: 'mogVersionMetadataUntrusted' }),
        }),
      ]),
    );

    let reimportedWb: Workbook | undefined;
    try {
      reimportedWb = await reimported.handle.workbook({
        versioning: durableIndexedDbVersioning(),
      });
      await expect(reimportedWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'Externally edited import',
      });

      const reimportedHead = await reimportedWb.version.getHead();
      expect(reimportedHead).toMatchObject({ ok: true });
      if (!reimportedHead.ok) {
        throw new Error(`expected reimport version head: ${reimportedHead.error.code}`);
      }
      expect(reimportedHead.value.id).toBe(originalRootId);

      await expect(reimportedWb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: [
            expect.objectContaining({
              id: originalRootId,
              parents: [],
            }),
          ],
        },
      });
    } finally {
      await reimportedWb?.close('skipSave').catch(() => {});
      await reimported.handle.dispose().catch(() => {});
    }
  });
});
