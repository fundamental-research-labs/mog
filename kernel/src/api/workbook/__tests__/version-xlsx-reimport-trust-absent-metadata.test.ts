import 'fake-indexeddb/auto';

import type { Workbook } from '@mog-sdk/contracts/api';

import { removeMogVersionMetadataFromXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import { DOCUMENT_ID, WORKSPACE_ID } from './version-xlsx-reimport-trust-constants';
import { expectNoMetadataWarning } from './version-xlsx-reimport-trust-metadata';
import { installXlsxReimportTrustVersionStoreHooks } from './version-xlsx-reimport-trust-setup';
import { expectImportBranchCounts } from './version-xlsx-reimport-trust-version-store';
import {
  createSourceXlsx,
  importXlsxWithVersioning,
  seedTrustedExport,
  versioning,
} from './version-xlsx-reimport-trust-workbook';

installXlsxReimportTrustVersionStoreHooks();

describe('VC-10 XLSX trusted reimport absent metadata', () => {
  it('treats missing metadata as absent and never attaches to a lexical commit', async () => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });
    const missingMetadata = removeMogVersionMetadataFromXlsx(
      await createSourceXlsx('Missing metadata edit'),
    );

    const imported = await importXlsxWithVersioning({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      xlsxBytes: missingMetadata,
    });
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected missing metadata import success: ${imported.error?.message}`);
    }
    expectNoMetadataWarning(imported.warnings);

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({ versioning: versioning(WORKSPACE_ID) });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'Missing metadata edit',
      });
      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: { id: seed.rootCommitId },
      });

      await expectImportBranchCounts(DOCUMENT_ID, WORKSPACE_ID, {
        externalChange: 0,
        newRoot: 0,
      });
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });
});
