import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { addMogVersionMetadataToXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import { withExportSupportedVersionManifest } from './version-domain-support-test-utils';
import {
  CLEAN_EXPORT_DOCUMENT_ID,
  createSourceXlsx,
  durableIndexedDbVersioning,
  expectContractedXlsxExportBlocked,
  OLD_METADATA_COMMIT_ID,
  testVersionMetadata,
} from './version-xlsx-import-root-test-utils';

export function registerSelfPromotedExportSupportScenario(): void {
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
}
