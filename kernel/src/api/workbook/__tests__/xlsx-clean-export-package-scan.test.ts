import 'fake-indexeddb/auto';

import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import {
  removeMogVersionMetadataPackageInventoryFromXlsx,
  scanXlsxCleanExportPackageDiagnostics,
  XlsxCleanExportPackageError,
} from '../xlsx-clean-export-package';
import { scanXlsxCleanExportPackageInventoryDiagnostics } from '../xlsx-clean-export-package-scan';
import { readAndValidateMogVersionMetadataFromXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb/backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import {
  ACTIVE_CONTENT_SECRET,
  CLEAN_EXPORT_METADATA_LEAK_TOKENS,
  TARGET_DOCUMENT_ID,
  activeContentVariantFixtures,
  activePackageVariantFixture,
  activeUnsafePackageFixture,
  createLeakySourceXlsx,
  expectUnsafePackageScanRedacts,
  externalConnectionAndQueryTableVariantFixture,
  inertCustomXmlPackageFixture,
  redactionCheckPayload,
  scanCleanExportPackage,
} from './xlsx-clean-export-package-scan-test-utils';

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('WorkbookVersion default XLSX clean export package scan', () => {
  it('scrubs Mog customXml package inventory and redacted metadata from the default export', async () => {
    const sourceXlsx = await createLeakySourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: sourceXlsx },
      {
        documentId: TARGET_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }
    installVersionDomainDetectorNoopsOnHandles(imported.handle);

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'Clean export package scan',
      });
      installVersionDomainDetectorNoopsOnWorkbook(wb);

      const exported = await wb.toXlsx();

      expect(
        readAndValidateMogVersionMetadataFromXlsx(exported, {
          expectedDocumentId: TARGET_DOCUMENT_ID,
        }),
      ).toMatchObject({ status: 'absent' });
      const cleanExportScan = await scanCleanExportPackage(
        exported,
        CLEAN_EXPORT_METADATA_LEAK_TOKENS,
      );
      expect(cleanExportScan).toEqual({
        duplicateZipEntries: [],
        mogCustomXmlMetadataParts: [],
        mogContentTypeEntries: [],
        mogRelationshipEntries: [],
        danglingCustomXmlInventory: [],
        unsafePackageDiagnostics: [],
        redactionLeaks: [],
      });
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('blocks active and unsafe package content with redaction-safe diagnostics', async () => {
    const unsafePackage = activeUnsafePackageFixture();
    const diagnostics = await scanXlsxCleanExportPackageDiagnostics(unsafePackage);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT',
      'XLSX_CLEAN_EXPORT_ACTIVEX_CONTENT',
      'XLSX_CLEAN_EXPORT_OLE_OR_EMBEDDED_EXECUTABLE_CONTENT',
      'XLSX_CLEAN_EXPORT_ENCRYPTED_PACKAGE_MARKER',
      'XLSX_CLEAN_EXPORT_DIGITAL_SIGNATURE_MARKER',
      'XLSX_CLEAN_EXPORT_DANGLING_PACKAGE_REFERENCE',
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.count > 0)).toBe(true);

    let error: unknown;
    try {
      await removeMogVersionMetadataPackageInventoryFromXlsx(unsafePackage);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(XlsxCleanExportPackageError);
    expect(error).toMatchObject({
      code: 'XLSX_CLEAN_EXPORT_UNSAFE_PACKAGE',
      diagnostics,
    });
    expect(redactionCheckPayload(error)).not.toContain(ACTIVE_CONTENT_SECRET);
  });

  it('scrubs inert customXml package inventory before clean export safety assertion', async () => {
    const token = 'vc10-custom-xml-clean-export-redacted-target';
    const customXmlPackage = inertCustomXmlPackageFixture(token);
    expect(
      (await scanXlsxCleanExportPackageDiagnostics(customXmlPackage)).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toEqual(['XLSX_CLEAN_EXPORT_CUSTOM_XML_METADATA_CONTENT']);

    const cleaned = await removeMogVersionMetadataPackageInventoryFromXlsx(customXmlPackage);
    const cleanExportScan = await scanCleanExportPackage(cleaned, [token]);

    expect(cleanExportScan).toEqual({
      duplicateZipEntries: [],
      mogCustomXmlMetadataParts: [],
      mogContentTypeEntries: [],
      mogRelationshipEntries: [],
      danglingCustomXmlInventory: [],
      unsafePackageDiagnostics: [],
      redactionLeaks: [],
    });
  });

  it('allows ordinary external hyperlink relationships', () => {
    const diagnostics = scanXlsxCleanExportPackageInventoryDiagnostics(
      [
        '[Content_Types].xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/_rels/sheet1.xml.rels',
      ],
      [
        {
          path: 'xl/worksheets/_rels/sheet1.xml.rels',
          xml: [
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rId1"',
            ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"',
            ' Target="https://example.com" TargetMode="External"/>',
            '</Relationships>',
          ].join(''),
        },
      ],
    );

    expect(diagnostics).toEqual([]);
  });

  it('detects macro, embedded, external connection, and customXml package variants', async () => {
    await expectUnsafePackageScanRedacts(
      activePackageVariantFixture(),
      [
        'XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT',
        'XLSX_CLEAN_EXPORT_ACTIVEX_CONTENT',
        'XLSX_CLEAN_EXPORT_OLE_OR_EMBEDDED_EXECUTABLE_CONTENT',
        'XLSX_CLEAN_EXPORT_EXTERNAL_DATA_CONNECTION_CONTENT',
        'XLSX_CLEAN_EXPORT_EXTERNAL_RELATIONSHIP_CONTENT',
        'XLSX_CLEAN_EXPORT_CUSTOM_XML_METADATA_CONTENT',
        'XLSX_CLEAN_EXPORT_DIGITAL_SIGNATURE_MARKER',
      ],
      [ACTIVE_CONTENT_SECRET],
      [
        'XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT',
        'XLSX_CLEAN_EXPORT_ACTIVEX_CONTENT',
        'XLSX_CLEAN_EXPORT_OLE_OR_EMBEDDED_EXECUTABLE_CONTENT',
        'XLSX_CLEAN_EXPORT_EXTERNAL_DATA_CONNECTION_CONTENT',
        'XLSX_CLEAN_EXPORT_EXTERNAL_RELATIONSHIP_CONTENT',
        'XLSX_CLEAN_EXPORT_DIGITAL_SIGNATURE_MARKER',
      ],
    );
  });

  it('detects external connection and queryTable variants without exposing paths or targets', async () => {
    const redactedToken = 'w5-08-external-redacted-target';
    await expectUnsafePackageScanRedacts(
      externalConnectionAndQueryTableVariantFixture(redactedToken),
      [
        'XLSX_CLEAN_EXPORT_EXTERNAL_DATA_CONNECTION_CONTENT',
        'XLSX_CLEAN_EXPORT_EXTERNAL_RELATIONSHIP_CONTENT',
      ],
      [redactedToken],
    );
  });

  it.each(activeContentVariantFixtures())(
    'detects active-content package variant $name without exposing paths or targets',
    async ({ createXlsxBytes, expectedCodes, redactedToken }) => {
      await expectUnsafePackageScanRedacts(createXlsxBytes(), expectedCodes, [redactedToken]);
    },
  );
});
