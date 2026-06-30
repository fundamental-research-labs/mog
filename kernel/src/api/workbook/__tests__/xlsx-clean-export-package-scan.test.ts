import 'fake-indexeddb/auto';

import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import {
  removeCleanExportBlockedPackageInventoryFromXlsx,
  removeMogVersionMetadataPackageInventoryFromXlsx,
  scanXlsxCleanExportPackageDiagnostics,
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
  scanCleanExportPackage,
} from './xlsx-clean-export-package-scan-test-utils';
import {
  decodeUtf8,
  encodeUtf8,
  readZipArchive,
  writeStoredZip,
} from './xlsx-clean-export-package-zip-test-utils';

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

  it('explicitly scrubs active and unsafe package content with redaction-safe diagnostics', async () => {
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

    const cleaned = await removeCleanExportBlockedPackageInventoryFromXlsx(unsafePackage);
    expect(await scanCleanExportPackage(cleaned, [ACTIVE_CONTENT_SECRET])).toEqual({
      duplicateZipEntries: [],
      mogCustomXmlMetadataParts: [],
      mogContentTypeEntries: [],
      mogRelationshipEntries: [],
      danglingCustomXmlInventory: [],
      unsafePackageDiagnostics: [],
      redactionLeaks: [],
    });
  });

  it('does not scrub non-Mog package inventory when removing Mog version metadata', async () => {
    const packageWithThirdPartyInventory = activePackageVariantFixture();
    const diagnosticsBefore = await scanXlsxCleanExportPackageDiagnostics(
      packageWithThirdPartyInventory,
    );

    const cleaned = await removeMogVersionMetadataPackageInventoryFromXlsx(
      packageWithThirdPartyInventory,
    );

    expect(await scanXlsxCleanExportPackageDiagnostics(cleaned)).toEqual(diagnosticsBefore);
    const entryNames = readZipArchive(cleaned).map((entry) => entry.name);
    expect(entryNames).toEqual(expect.arrayContaining(['xl/externalLinks/externalLink1.xml']));
    expect(entryNames).toEqual(expect.arrayContaining(['xl/vbaProjectSignature.bin']));
    expect(entryNames).toEqual(expect.arrayContaining(['customXml/item1.xml']));
  });

  it('scrubs inert customXml package inventory before clean export safety assertion', async () => {
    const token = 'vc10-custom-xml-clean-export-redacted-target';
    const customXmlPackage = inertCustomXmlPackageFixture(token);
    expect(
      (await scanXlsxCleanExportPackageDiagnostics(customXmlPackage)).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toEqual(['XLSX_CLEAN_EXPORT_CUSTOM_XML_METADATA_CONTENT']);

    const cleaned = await removeCleanExportBlockedPackageInventoryFromXlsx(customXmlPackage);
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

  it('removes workbook external references when stripping external links', async () => {
    const externalLinkPackage = writeStoredZip([
      {
        name: '[Content_Types].xml',
        data: encodeUtf8(
          [
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
            '<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/>',
            '</Types>',
          ].join(''),
        ),
      },
      {
        name: '_rels/.rels',
        data: encodeUtf8(
          [
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
            '</Relationships>',
          ].join(''),
        ),
      },
      {
        name: 'xl/workbook.xml',
        data: encodeUtf8(
          [
            '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
            '<externalReferences><externalReference r:id="rIdExternal"/></externalReferences>',
            '</workbook>',
          ].join(''),
        ),
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: encodeUtf8(
          [
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/>',
            '</Relationships>',
          ].join(''),
        ),
      },
      { name: 'xl/externalLinks/externalLink1.xml', data: encodeUtf8('<externalLink/>') },
    ]);

    const cleaned = await removeCleanExportBlockedPackageInventoryFromXlsx(externalLinkPackage);
    const textByPath = new Map(
      readZipArchive(cleaned).map((entry) => [entry.name, decodeUtf8(entry.data)]),
    );

    expect(textByPath.has('xl/externalLinks/externalLink1.xml')).toBe(false);
    expect(textByPath.get('xl/workbook.xml')).not.toContain('externalReferences');
    expect(await scanXlsxCleanExportPackageDiagnostics(cleaned)).toEqual([]);
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
