import type { XlsxCleanExportPackageDiagnostic } from '../xlsx-clean-export-package';
import {
  encodeUtf8,
  writeStoredZip,
  type ZipEntry,
} from './xlsx-clean-export-package-zip-test-utils';

export const ACTIVE_CONTENT_SECRET = 'vc10-active-content-secret-sentinel';

export function activeUnsafePackageFixture(): Uint8Array {
  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>',
    '<Override PartName="/xl/activeX/activeX1.xml" ContentType="application/vnd.ms-office.activeX+xml"/>',
    '<Override PartName="/xl/embeddings/oleObject1.bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>',
    `<Override PartName="/xl/embeddings/${ACTIVE_CONTENT_SECRET}.exe" ContentType="application/octet-stream"/>`,
    '<Override PartName="/EncryptionInfo" ContentType="application/vnd.ms-office.encryptionInfo"/>',
    '<Override PartName="/EncryptedPackage" ContentType="application/vnd.ms-office.encryptedPackage"/>',
    '<Override PartName="/_xmlsignatures/origin.sigs" ContentType="application/vnd.openxmlformats-package.digital-signature-origin"/>',
    `<Override PartName="/xl/${ACTIVE_CONTENT_SECRET}.xml" ContentType="application/xml"/>`,
    '</Types>',
  ].join('');
  const rootRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    '<Relationship Id="rIdSignature" Type="http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/origin" Target="_xmlsignatures/origin.sigs"/>',
    `<Relationship Id="rIdDangling" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/${ACTIVE_CONTENT_SECRET}.xml"/>`,
    '</Relationships>',
  ].join('');
  const workbookRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>',
    '<Relationship Id="rIdActiveX" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/control" Target="activeX/activeX1.xml"/>',
    '<Relationship Id="rIdOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/>',
    `<Relationship Id="rIdPackage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="embeddings/${ACTIVE_CONTENT_SECRET}.exe"/>`,
    '</Relationships>',
  ].join('');

  return writeStoredZip([
    { name: '[Content_Types].xml', data: encodeUtf8(contentTypes) },
    { name: '_rels/.rels', data: encodeUtf8(rootRels) },
    { name: 'xl/workbook.xml', data: encodeUtf8('<workbook/>') },
    { name: 'xl/_rels/workbook.xml.rels', data: encodeUtf8(workbookRels) },
    { name: 'xl/vbaProject.bin', data: encodeUtf8('vba') },
    { name: 'xl/activeX/activeX1.xml', data: encodeUtf8('<ax:ocx/>') },
    { name: 'xl/embeddings/oleObject1.bin', data: encodeUtf8('ole') },
    { name: `xl/embeddings/${ACTIVE_CONTENT_SECRET}.exe`, data: encodeUtf8('exe') },
    { name: 'EncryptionInfo', data: encodeUtf8('encryption info') },
    { name: 'EncryptedPackage', data: encodeUtf8('encrypted package') },
    { name: '_xmlsignatures/origin.sigs', data: encodeUtf8('<Signature/>') },
  ]);
}

export function activePackageVariantFixture(): Uint8Array {
  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>',
    '<Override PartName="/xl/vbaProjectSignature.bin" ContentType="application/vnd.ms-office.vbaProjectSignature"/>',
    '<Override PartName="/xl/attachedToolbars.bin" ContentType="application/vnd.ms-office.attachedToolbars"/>',
    '<Override PartName="/xl/activeX/activeX1.bin" ContentType="application/vnd.ms-office.activeX"/>',
    '<Override PartName="/xl/embeddings/package1.bin" ContentType="application/vnd.ms-package"/>',
    '<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/>',
    '<Override PartName="/xl/queryTables/queryTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/>',
    '<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/>',
    '<Override PartName="/xl/xmlMaps.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.xmlMaps+xml"/>',
    '<Override PartName="/customXml/item1.xml" ContentType="application/xml"/>',
    '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>',
    '</Types>',
  ].join('');
  const rootRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    '<Relationship Id="rIdCustomXml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="customXml/item1.xml"/>',
    '</Relationships>',
  ].join('');
  const workbookRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rIdVbaSignature" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProjectSignature" Target="vbaProjectSignature.bin"/>',
    '<Relationship Id="rIdAttachedToolbars" Type="http://schemas.microsoft.com/office/2006/relationships/attachedToolbars" Target="attachedToolbars.bin"/>',
    '<Relationship Id="rIdActiveXBinary" Type="http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary" Target="activeX/activeX1.bin"/>',
    '<Relationship Id="rIdEmbeddedPackage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="embeddings/package1.bin"/>',
    '<Relationship Id="rIdConnections" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections" Target="connections.xml"/>',
    '<Relationship Id="rIdExternalLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/>',
    '<Relationship Id="rIdXmlMaps" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/xmlMaps" Target="xmlMaps.xml"/>',
    '</Relationships>',
  ].join('');
  const externalLinkRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    `<Relationship Id="rIdExternalPath" Type="http://schemas.microsoft.com/office/2019/04/relationships/externalLinkLongPath" Target="file:///tmp/${ACTIVE_CONTENT_SECRET}.xlsx" TargetMode="External"/>`,
    '<Relationship Id="rIdExternalStartup" Type="http://schemas.microsoft.com/office/2006/relationships/xlExternalLinkPath/xlStartup" Target="startup.xlsx" TargetMode="External"/>',
    '</Relationships>',
  ].join('');
  const tableRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rIdQueryTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable" Target="../queryTables/queryTable1.xml"/>',
    '</Relationships>',
  ].join('');
  const customXmlRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rIdCustomXmlProps" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/>',
    '</Relationships>',
  ].join('');

  return writeStoredZip([
    { name: '[Content_Types].xml', data: encodeUtf8(contentTypes) },
    { name: '_rels/.rels', data: encodeUtf8(rootRels) },
    { name: 'xl/workbook.xml', data: encodeUtf8('<workbook/>') },
    { name: 'xl/_rels/workbook.xml.rels', data: encodeUtf8(workbookRels) },
    { name: 'xl/vbaProjectSignature.bin', data: encodeUtf8('vba signature') },
    { name: 'xl/attachedToolbars.bin', data: encodeUtf8('toolbar macro state') },
    { name: 'xl/activeX/activeX1.bin', data: encodeUtf8('activex binary') },
    { name: 'xl/embeddings/package1.bin', data: encodeUtf8('embedded package') },
    { name: 'xl/connections.xml', data: encodeUtf8('<connections/>') },
    { name: 'xl/queryTables/queryTable1.xml', data: encodeUtf8('<queryTable/>') },
    { name: 'xl/externalLinks/externalLink1.xml', data: encodeUtf8('<externalLink/>') },
    {
      name: 'xl/externalLinks/_rels/externalLink1.xml.rels',
      data: encodeUtf8(externalLinkRels),
    },
    { name: 'xl/xmlMaps.xml', data: encodeUtf8('<xmlMaps/>') },
    { name: 'xl/tables/table1.xml', data: encodeUtf8('<table/>') },
    { name: 'xl/tables/_rels/table1.xml.rels', data: encodeUtf8(tableRels) },
    {
      name: 'customXml/item1.xml',
      data: encodeUtf8(`<metadata>${ACTIVE_CONTENT_SECRET}</metadata>`),
    },
    { name: 'customXml/_rels/item1.xml.rels', data: encodeUtf8(customXmlRels) },
    {
      name: 'customXml/itemProps1.xml',
      data: encodeUtf8(
        '<ds:datastoreItem ds:itemID="{22222222-2222-2222-2222-222222222222}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>',
      ),
    },
  ]);
}

export function inertCustomXmlPackageFixture(redactedToken: string): Uint8Array {
  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    `<Override PartName="/customXml/${redactedToken}-item1.xml" ContentType="application/xml"/>`,
    `<Override PartName="/customXml/${redactedToken}-itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>`,
    '<Override PartName="/xl/xmlMaps.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.xmlMaps+xml"/>',
    '</Types>',
  ].join('');
  const rootRels = packageRelationshipsXml([
    '<Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    `<Relationship Id="rIdCustomXml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="customXml/${redactedToken}-item1.xml"/>`,
  ]);
  const workbookRels = packageRelationshipsXml([
    '<Relationship Id="rIdXmlMaps" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/xmlMaps" Target="xmlMaps.xml"/>',
  ]);
  const customXmlRels = packageRelationshipsXml([
    `<Relationship Id="rIdCustomXmlProps" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="${redactedToken}-itemProps1.xml"/>`,
  ]);

  return writeStoredZip([
    { name: '[Content_Types].xml', data: encodeUtf8(contentTypes) },
    { name: '_rels/.rels', data: encodeUtf8(rootRels) },
    { name: 'xl/workbook.xml', data: encodeUtf8('<workbook/>') },
    { name: 'xl/_rels/workbook.xml.rels', data: encodeUtf8(workbookRels) },
    {
      name: `customXml/${redactedToken}-item1.xml`,
      data: encodeUtf8(`<metadata>${redactedToken}</metadata>`),
    },
    {
      name: `customXml/_rels/${redactedToken}-item1.xml.rels`,
      data: encodeUtf8(customXmlRels),
    },
    {
      name: `customXml/${redactedToken}-itemProps1.xml`,
      data: encodeUtf8(
        '<ds:datastoreItem ds:itemID="{33333333-3333-3333-3333-333333333333}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>',
      ),
    },
    { name: 'xl/xmlMaps.xml', data: encodeUtf8('<xmlMaps/>') },
  ]);
}

export function externalConnectionAndQueryTableVariantFixture(redactedToken: string): Uint8Array {
  return syntheticPackageFixture({
    contentTypeOverrides: [
      `<Override PartName="/xl/${redactedToken}-connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/>`,
      `<Override PartName="/xl/queryTables/${redactedToken}-queryTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/>`,
      '<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/>',
    ],
    workbookRelationships: [
      `<Relationship Id="rIdStrictConnections" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/connections" Target="${redactedToken}-connections.xml?token=${redactedToken}"/>`,
      '<Relationship Id="rIdExternalLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/>',
    ],
    extraEntries: [
      { name: `xl/${redactedToken}-connections.xml`, data: encodeUtf8('<connections/>') },
      { name: 'xl/externalLinks/externalLink1.xml', data: encodeUtf8('<externalLink/>') },
      {
        name: 'xl/externalLinks/_rels/externalLink1.xml.rels',
        data: encodeUtf8(
          packageRelationshipsXml([
            `<Relationship Id="rIdExternalLongPath" Type="http://schemas.microsoft.com/office/2019/04/relationships/externalLinkLongPath" Target="file:///tmp/${redactedToken}.xlsx" TargetMode="External"/>`,
            `<Relationship Id="rIdExternalPath" Type="http://schemas.microsoft.com/office/2006/relationships/xlExternalLinkPath/xlPathMissing" Target="https://example.invalid/${redactedToken}.xlsx" TargetMode="External"/>`,
          ]),
        ),
      },
      { name: 'xl/tables/table1.xml', data: encodeUtf8('<table/>') },
      {
        name: 'xl/tables/_rels/table1.xml.rels',
        data: encodeUtf8(
          packageRelationshipsXml([
            `<Relationship Id="rIdStrictQueryTable" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/queryTable" Target="../queryTables/${redactedToken}-queryTable1.xml?token=${redactedToken}"/>`,
          ]),
        ),
      },
      {
        name: `xl/queryTables/${redactedToken}-queryTable1.xml`,
        data: encodeUtf8('<queryTable/>'),
      },
    ],
  });
}

export function activeContentVariantFixtures(): Array<{
  readonly name: string;
  readonly expectedCodes: readonly XlsxCleanExportPackageDiagnostic['code'][];
  readonly redactedToken: string;
  readonly createXlsxBytes: () => Uint8Array;
}> {
  const macrosheetToken = 'w5-08-macrosheet-redacted-target';
  const dialogsheetToken = 'w5-08-dialogsheet-redacted-target';
  const customUiToken = 'w5-08-customui-redacted-target';
  const customUi14Token = 'w5-08-customui14-redacted-target';
  const webExtensionToken = 'w5-08-webextension-redacted-target';

  return [
    {
      name: 'macrosheet',
      expectedCodes: ['XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT'],
      redactedToken: macrosheetToken,
      createXlsxBytes: () =>
        syntheticPackageFixture({
          contentTypeOverrides: [
            `<Override PartName="/xl/macrosheets/${macrosheetToken}-sheet1.xml" ContentType="application/vnd.ms-excel.macrosheet+xml"/>`,
          ],
          workbookRelationships: [
            `<Relationship Id="rIdMacroSheet" Type="http://schemas.microsoft.com/office/2006/relationships/xlMacrosheet" Target="macrosheets/${macrosheetToken}-sheet1.xml?token=${macrosheetToken}"/>`,
          ],
          extraEntries: [
            {
              name: `xl/macrosheets/${macrosheetToken}-sheet1.xml`,
              data: encodeUtf8('<xm:macrosheet/>'),
            },
          ],
        }),
    },
    {
      name: 'dialogsheet',
      expectedCodes: ['XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT'],
      redactedToken: dialogsheetToken,
      createXlsxBytes: () =>
        syntheticPackageFixture({
          contentTypeOverrides: [
            `<Override PartName="/xl/dialogsheets/${dialogsheetToken}-sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.dialogsheet+xml"/>`,
          ],
          workbookRelationships: [
            `<Relationship Id="rIdDialogSheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/dialogsheet" Target="dialogsheets/${dialogsheetToken}-sheet1.xml?token=${dialogsheetToken}"/>`,
          ],
          extraEntries: [
            {
              name: `xl/dialogsheets/${dialogsheetToken}-sheet1.xml`,
              data: encodeUtf8('<dialogsheet/>'),
            },
          ],
        }),
    },
    {
      name: 'customUI',
      expectedCodes: ['XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT'],
      redactedToken: customUiToken,
      createXlsxBytes: () =>
        syntheticPackageFixture({
          rootRelationships: [
            `<Relationship Id="rIdCustomUi" Type="http://schemas.microsoft.com/office/2006/relationships/ui/extensibility" Target="customUI/${customUiToken}-customUI.xml?token=${customUiToken}"/>`,
          ],
          extraEntries: [
            {
              name: `customUI/${customUiToken}-customUI.xml`,
              data: encodeUtf8('<customUI/>'),
            },
          ],
        }),
    },
    {
      name: 'customUI14',
      expectedCodes: ['XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT'],
      redactedToken: customUi14Token,
      createXlsxBytes: () =>
        syntheticPackageFixture({
          rootRelationships: [
            `<Relationship Id="rIdCustomUi14" Type="http://schemas.microsoft.com/office/2007/relationships/ui/extensibility" Target="customUI14/${customUi14Token}-customUI.xml?token=${customUi14Token}"/>`,
          ],
          extraEntries: [
            {
              name: `customUI14/${customUi14Token}-customUI.xml`,
              data: encodeUtf8('<customUI/>'),
            },
          ],
        }),
    },
    {
      name: 'webExtension',
      expectedCodes: ['XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT'],
      redactedToken: webExtensionToken,
      createXlsxBytes: () =>
        syntheticPackageFixture({
          contentTypeOverrides: [
            `<Override PartName="/xl/webextensions/${webExtensionToken}-webextension1.xml" ContentType="application/vnd.ms-office.webextension+xml"/>`,
          ],
          workbookRelationships: [
            `<Relationship Id="rIdWebExtension" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextensions/${webExtensionToken}-webextension1.xml?token=${webExtensionToken}"/>`,
          ],
          extraEntries: [
            {
              name: `xl/webextensions/${webExtensionToken}-webextension1.xml`,
              data: encodeUtf8('<webextension/>'),
            },
          ],
        }),
    },
  ];
}

function syntheticPackageFixture(options: {
  readonly contentTypeOverrides?: readonly string[];
  readonly rootRelationships?: readonly string[];
  readonly workbookRelationships?: readonly string[];
  readonly extraEntries?: readonly ZipEntry[];
}): Uint8Array {
  const contentTypeOverrides = options.contentTypeOverrides ?? [];
  const rootRelationships = options.rootRelationships ?? [];
  const workbookRelationships = options.workbookRelationships ?? [];
  return writeStoredZip([
    {
      name: '[Content_Types].xml',
      data: encodeUtf8(
        [
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
          '<Default Extension="xml" ContentType="application/xml"/>',
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
          ...contentTypeOverrides,
          '</Types>',
        ].join(''),
      ),
    },
    {
      name: '_rels/.rels',
      data: encodeUtf8(
        packageRelationshipsXml([
          '<Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
          ...rootRelationships,
        ]),
      ),
    },
    { name: 'xl/workbook.xml', data: encodeUtf8('<workbook/>') },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: encodeUtf8(packageRelationshipsXml(workbookRelationships)),
    },
    ...(options.extraEntries ?? []),
  ]);
}

function packageRelationshipsXml(relationships: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...relationships,
    '</Relationships>',
  ].join('');
}
