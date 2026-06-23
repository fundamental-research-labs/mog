import 'fake-indexeddb/auto';

import { inflateRawSync } from 'node:zlib';

import type { ObjectDigest, Workbook, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { createWorkbook } from '../create-workbook';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  removeMogVersionMetadataPackageInventoryFromXlsx,
  scanXlsxCleanExportPackageDiagnostics,
  XlsxCleanExportPackageError,
  type XlsxCleanExportPackageDiagnostic,
} from '../xlsx-clean-export-package';
import {
  addMogVersionMetadataToXlsx,
  MOG_VERSION_METADATA_PART,
  readAndValidateMogVersionMetadataFromXlsx,
  type MogWorkbookVersionXlsxMetadata,
} from '../xlsx-version-metadata';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';

const TARGET_DOCUMENT_ID = 'vc10-clean-export-package-scan-target';
const SOURCE_DOCUMENT_ID = 'vc10-clean-export-package-scan-source';
const LEAK_DOCUMENT_ID = 'vc10-clean-export-package-scan-leak-document';
const LEAK_REF_REVISION = 'vc10-clean-export-ref-revision-sentinel';
const LEAK_DIAGNOSTIC_SENTINEL = 'vc10-clean-export-diagnostic-sentinel';
const LEAK_REDACTION_SENTINEL = 'vc10-clean-export-redaction-sentinel';
const LEAK_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
const SEMANTIC_CHANGE_SET_DIGEST = objectDigest('d');
const SNAPSHOT_ROOT_DIGEST = objectDigest('e');
const ACTIVE_CONTENT_SECRET = 'vc10-active-content-secret-sentinel';

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('WorkbookVersion default XLSX clean export package scan', () => {
  it('scrubs Mog customXml package inventory and redacted metadata from the default export', async () => {
    const sourceXlsx = addMogMetadataPackageInventory(
      addMogVersionMetadataToXlsx(await createSourceXlsx(), leakMetadata()),
    );
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

      const exported = await wb.toXlsx();

      expect(
        readAndValidateMogVersionMetadataFromXlsx(exported, {
          expectedDocumentId: TARGET_DOCUMENT_ID,
        }),
      ).toMatchObject({ status: 'absent' });
      const cleanExportScan = await scanCleanExportPackage(exported, [
        LEAK_DOCUMENT_ID,
        LEAK_COMMIT_ID,
        LEAK_REF_REVISION,
        SEMANTIC_CHANGE_SET_DIGEST.digest,
        SNAPSHOT_ROOT_DIGEST.digest,
        LEAK_DIAGNOSTIC_SENTINEL,
        LEAK_REDACTION_SENTINEL,
        'mog.workbookVersion.xlsxMetadata.v1',
        'https://schemas.mog.dev/workbook/version-metadata/1',
      ]);
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
});

async function createSourceXlsx(): Promise<Uint8Array> {
  const wb = await createWorkbook({ documentId: SOURCE_DOCUMENT_ID, userTimezone: 'UTC' });
  try {
    await wb.activeSheet.setCell('A1', 'Clean export package scan');
    await wb.activeSheet.setCell('B1', 10);
    return wb.toXlsx();
  } finally {
    await wb.close('skipSave').catch(() => {
      wb.dispose();
    });
  }
}

function leakMetadata(): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: '2026-06-21T00:00:00.000Z',
    documentId: LEAK_DOCUMENT_ID,
    head: {
      commitId: LEAK_COMMIT_ID,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: { kind: 'opaque', value: LEAK_REF_REVISION },
      semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
      snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
    },
    diagnostics: [{ leakSentinel: LEAK_DIAGNOSTIC_SENTINEL }],
    redaction: {
      policy: 'commit-document-and-object-digests-only',
      omitted: ['authors', 'agentTraces', LEAK_REDACTION_SENTINEL],
    },
  };
}

function objectDigest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}

function addMogMetadataPackageInventory(xlsxBytes: Uint8Array): Uint8Array {
  const entries = new Map(readZipArchive(xlsxBytes).map((entry) => [entry.name, entry.data]));
  const contentTypes = decodeUtf8(requiredEntry(entries, '[Content_Types].xml'));
  const rootRels = decodeUtf8(requiredEntry(entries, '_rels/.rels'));

  entries.set(
    '[Content_Types].xml',
    encodeUtf8(
      insertBeforeClosingTag(
        contentTypes,
        '</Types>',
        [
          `<Override PartName="/${MOG_VERSION_METADATA_PART}" ContentType="application/vnd.mog.workbook-version-metadata+xml"/>`,
          '<Override PartName="/customXml/mog-version-metadata-props.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>',
        ].join(''),
      ),
    ),
  );
  entries.set(
    '_rels/.rels',
    encodeUtf8(
      insertBeforeClosingTag(
        rootRels,
        '</Relationships>',
        `<Relationship Id="rIdMogVersionMetadata" Type="https://schemas.mog.dev/officeDocument/relationships/mogVersionMetadata" Target="${MOG_VERSION_METADATA_PART}"/>`,
      ),
    ),
  );
  entries.set(
    'customXml/_rels/mog-version-metadata.xml.rels',
    encodeUtf8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rIdMogMetadataProps" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="mog-version-metadata-props.xml"/>',
        '</Relationships>',
      ].join(''),
    ),
  );
  entries.set(
    'customXml/mog-version-metadata-props.xml',
    encodeUtf8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<ds:datastoreItem ds:itemID="{11111111-1111-1111-1111-111111111111}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">',
        '<ds:schemaRefs/>',
        '</ds:datastoreItem>',
      ].join(''),
    ),
  );

  return writeStoredZip(
    Array.from(entries, ([name, data]) => ({
      name,
      data,
    })),
  );
}

interface CleanExportPackageScanReport {
  readonly duplicateZipEntries: readonly string[];
  readonly mogCustomXmlMetadataParts: readonly string[];
  readonly mogContentTypeEntries: readonly string[];
  readonly mogRelationshipEntries: readonly string[];
  readonly danglingCustomXmlInventory: readonly string[];
  readonly unsafePackageDiagnostics: readonly XlsxCleanExportPackageDiagnostic[];
  readonly redactionLeaks: readonly RedactionLeakDiagnostic[];
}

async function scanCleanExportPackage(
  xlsxBytes: Uint8Array,
  leakTokens: readonly string[],
): Promise<CleanExportPackageScanReport> {
  const entries = readZipArchive(xlsxBytes);
  const normalizedNames = entries.map((entry) => normalizePackagePath(entry.name));
  const textByPath = new Map(
    entries.map((entry) => [normalizePackagePath(entry.name), decodeUtf8(entry.data)]),
  );
  const contentTypesXml = textByPath.get('[Content_Types].xml') ?? '';
  const contentTypeEntries = extractXmlTags(contentTypesXml, 'Override').filter((tag) =>
    hasMogCustomXmlMarker(tag),
  );
  const relationshipEntries = entries.flatMap((entry) => {
    const path = normalizePackagePath(entry.name);
    if (!path.endsWith('.rels')) return [];
    return extractXmlTags(decodeUtf8(entry.data), 'Relationship')
      .filter((tag) => hasMogCustomXmlMarker(tag))
      .map((tag) => `${path}: ${tag}`);
  });
  const customXmlInventory = [
    ...normalizedNames.filter(
      (name) => name.startsWith('customXml/') || name.includes('/customXml/'),
    ),
    ...contentTypeEntries.map((entry) => `[Content_Types].xml: ${entry}`),
    ...relationshipEntries,
  ];

  return {
    duplicateZipEntries: duplicateValues(normalizedNames),
    mogCustomXmlMetadataParts: normalizedNames.filter(isMogVersionMetadataPath),
    mogContentTypeEntries: contentTypeEntries,
    mogRelationshipEntries: relationshipEntries,
    danglingCustomXmlInventory: customXmlInventory,
    unsafePackageDiagnostics: await scanXlsxCleanExportPackageDiagnostics(xlsxBytes),
    redactionLeaks: redactionLeaks(entries, leakTokens),
  };
}

function activeUnsafePackageFixture(): Uint8Array {
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

function requiredEntry(entries: ReadonlyMap<string, Uint8Array>, name: string): Uint8Array {
  const entry = entries.get(name);
  if (!entry) throw new Error(`missing XLSX package part ${name}`);
  return entry;
}

function insertBeforeClosingTag(xml: string, closingTag: string, insertion: string): string {
  const offset = xml.lastIndexOf(closingTag);
  if (offset === -1) throw new Error(`missing closing XML tag ${closingTag}`);
  return `${xml.slice(0, offset)}${insertion}${xml.slice(offset)}`;
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function extractXmlTags(xml: string, tagName: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${tagName}\\b[^>]*>`, 'g'))].map(
    (match) => match[0] ?? '',
  );
}

function hasMogCustomXmlMarker(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('customxml/mog-version-metadata') ||
    normalized.includes('mog-version-metadata') ||
    normalized.includes('mogversionmetadata') ||
    normalized.includes('schemas.mog.dev/workbook/version-metadata') ||
    normalized.includes('schemas.mog.dev/officedocument/relationships/mogversionmetadata') ||
    normalized.includes('mog.workbookversion.xlsxmetadata')
  );
}

function isMogVersionMetadataPath(path: string): boolean {
  return normalizePackagePath(path) === MOG_VERSION_METADATA_PART;
}

interface RedactionLeakDiagnostic {
  readonly code: 'VC10_CLEAN_EXPORT_REDACTION_TOKEN_LEAK';
  readonly tokenIndex: number;
  readonly location: 'entryName' | 'entryData';
  readonly count: number;
}

function redactionLeaks(
  entries: readonly ZipEntry[],
  leakTokens: readonly string[],
): RedactionLeakDiagnostic[] {
  const leakCounts = new Map<string, RedactionLeakDiagnostic>();
  leakTokens.forEach((token, tokenIndex) => {
    for (const entry of entries) {
      const name = normalizePackagePath(entry.name);
      if (name.includes(token)) recordRedactionLeak(leakCounts, tokenIndex, 'entryName');
      if (decodeUtf8(entry.data).includes(token))
        recordRedactionLeak(leakCounts, tokenIndex, 'entryData');
    }
  });
  return [...leakCounts.values()].sort(
    (left, right) =>
      left.tokenIndex - right.tokenIndex || left.location.localeCompare(right.location),
  );
}

function recordRedactionLeak(
  leakCounts: Map<string, RedactionLeakDiagnostic>,
  tokenIndex: number,
  location: RedactionLeakDiagnostic['location'],
): void {
  const key = `${tokenIndex}:${location}`;
  const existing = leakCounts.get(key);
  leakCounts.set(key, {
    code: 'VC10_CLEAN_EXPORT_REDACTION_TOKEN_LEAK',
    tokenIndex,
    location,
    count: (existing?.count ?? 0) + 1,
  });
}

function redactionCheckPayload(error: unknown): string {
  return JSON.stringify({
    name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : String(error),
    diagnostics: isRecord(error) ? error.diagnostics : undefined,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

function readZipArchive(bytes: Uint8Array): ZipEntry[] {
  const view = dataView(bytes);
  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;
  while (offset < end) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`invalid ZIP central directory header at ${offset}`);
    }
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const name = decodeUtf8(bytes.subarray(nameStart, nameStart + nameLength));
    entries.push({
      name,
      data: readZipEntryData(bytes, view, {
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      }),
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  if (entries.length !== entryCount) {
    throw new Error(`ZIP central directory entry count mismatch: ${entries.length}`);
  }
  return entries;
}

function readZipEntryData(
  bytes: Uint8Array,
  view: DataView,
  entry: {
    readonly name: string;
    readonly compressionMethod: number;
    readonly compressedSize: number;
    readonly uncompressedSize: number;
    readonly localHeaderOffset: number;
  },
): Uint8Array {
  if (view.getUint32(entry.localHeaderOffset, true) !== 0x04034b50) {
    throw new Error(`invalid ZIP local file header for ${entry.name}`);
  }
  const localNameLength = view.getUint16(entry.localHeaderOffset + 26, true);
  const localExtraLength = view.getUint16(entry.localHeaderOffset + 28, true);
  const dataStart = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) {
    const inflated = new Uint8Array(inflateRawSync(compressed));
    if (inflated.byteLength !== entry.uncompressedSize) {
      throw new Error(`ZIP inflated size mismatch for ${entry.name}`);
    }
    return inflated;
  }
  throw new Error(
    `unsupported ZIP compression method ${entry.compressionMethod} for ${entry.name}`,
  );
}

function writeStoredZip(entries: readonly ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encodeUtf8(entry.name);
    const crc = crc32(entry.data);
    const localHeader = localFileHeader(nameBytes, entry.data, crc);
    localParts.push(localHeader, entry.data);
    centralParts.push(centralDirectoryHeader(nameBytes, entry.data, crc, offset));
    offset += localHeader.byteLength + entry.data.byteLength;
  }
  const centralDirectoryOffset = offset;
  const centralDirectorySize = byteLength(centralParts);
  return concatUint8Arrays([
    ...localParts,
    ...centralParts,
    endOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset),
  ]);
}

function localFileHeader(nameBytes: Uint8Array, data: Uint8Array, crc: number): Uint8Array {
  const header = new Uint8Array(30 + nameBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.byteLength, true);
  view.setUint32(22, data.byteLength, true);
  view.setUint16(26, nameBytes.byteLength, true);
  header.set(nameBytes, 30);
  return header;
}

function centralDirectoryHeader(
  nameBytes: Uint8Array,
  data: Uint8Array,
  crc: number,
  localHeaderOffset: number,
): Uint8Array {
  const header = new Uint8Array(46 + nameBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, data.byteLength, true);
  view.setUint32(24, data.byteLength, true);
  view.setUint16(28, nameBytes.byteLength, true);
  view.setUint32(42, localHeaderOffset, true);
  header.set(nameBytes, 46);
  return header;
}

function endOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Uint8Array {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  return record;
}

function findEndOfCentralDirectory(view: DataView): number {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('missing ZIP end of central directory');
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = new Uint32Array(
  Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  }),
);

function byteLength(parts: readonly Uint8Array[]): number {
  return parts.reduce((sum, part) => sum + part.byteLength, 0);
}

function concatUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(byteLength(parts));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function normalizePackagePath(value: string): string {
  return value.replace(/^\/+/, '');
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
