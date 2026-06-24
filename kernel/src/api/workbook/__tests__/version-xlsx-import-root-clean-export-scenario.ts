import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { readAndValidateMogVersionMetadataFromXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  CLEAN_EXPORT_DOCUMENT_ID,
  createSourceXlsx,
  durableIndexedDbVersioning,
} from './version-xlsx-import-root-test-utils';

export function registerCleanExportScenario(): void {
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
}
