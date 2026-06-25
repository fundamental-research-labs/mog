import {
  isPackageInventoryXmlPath,
  normalizePackagePath,
  scanXlsxCleanExportPackageInventoryDiagnostics,
  type XlsxCleanExportPackageDiagnostic,
  type XlsxCleanExportPackageInventoryXmlPart,
} from './xlsx-clean-export-package-scan';
import { resolveRelationshipTargetPath } from './xlsx-clean-export-package-scan-relationships';
import { extractXmlTags, xmlAttribute } from './xlsx-clean-export-package-scan-xml';

const MOG_VERSION_METADATA_PART = 'customXml/mog-version-metadata.xml';

export type {
  XlsxCleanExportPackageDiagnostic,
  XlsxCleanExportPackageDiagnosticCategory,
  XlsxCleanExportPackageDiagnosticCode,
} from './xlsx-clean-export-package-scan';

export class XlsxCleanExportPackageError extends Error {
  readonly code = 'XLSX_CLEAN_EXPORT_UNSAFE_PACKAGE';
  readonly diagnostics: readonly XlsxCleanExportPackageDiagnostic[];

  constructor(diagnostics: readonly XlsxCleanExportPackageDiagnostic[]) {
    super(
      'XLSX clean export blocked because the package contains active, unsafe, or dangling package content.',
    );
    this.name = 'XlsxCleanExportPackageError';
    this.diagnostics = diagnostics;
  }
}

interface ZipEntry {
  readonly name: string;
  readonly centralDirectoryBytes: Uint8Array;
  readonly localHeaderOffset: number;
  readonly generalPurposeBitFlag: number;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

export async function removeMogVersionMetadataPackageInventoryFromXlsx(
  xlsxBytes: Uint8Array,
): Promise<Uint8Array> {
  return removeCleanExportBlockedPackageInventoryFromXlsx(xlsxBytes);
}

export async function removeCleanExportBlockedPackageInventoryFromXlsx(
  xlsxBytes: Uint8Array,
): Promise<Uint8Array> {
  const view = new DataView(xlsxBytes.buffer, xlsxBytes.byteOffset, xlsxBytes.byteLength);
  const eocd = readEndOfCentralDirectory(view);
  const entries = readCentralDirectoryEntries(xlsxBytes, view, eocd);
  const rewrites = new Map<ZipEntry, Uint8Array>();
  let changed = false;

  for (const entry of entries) {
    const normalizedName = normalizePackagePath(entry.name);
    if (isCleanExportScrubbedPackagePath(normalizedName)) {
      changed = true;
      continue;
    }

    if (isPackageInventoryXmlPath(normalizedName)) {
      const xml = decodeUtf8(await readEntryData(xlsxBytes, view, eocd, entry));
      const scrubbed = scrubCleanExportPackageInventoryXml(normalizedName, xml);
      if (scrubbed !== xml) {
        rewrites.set(entry, encodeUtf8(scrubbed));
        changed = true;
      }
    }
  }

  if (!changed) {
    await assertXlsxCleanExportPackageIsSafe(xlsxBytes);
    return xlsxBytes;
  }

  const keptEntries = entries.filter(
    (entry) => !isCleanExportScrubbedPackagePath(normalizePackagePath(entry.name)),
  );
  const localFileParts: Uint8Array[] = [];
  const centralDirectoryParts: Uint8Array[] = [];
  let localOffset = 0;
  const preamble = archivePreambleBytes(xlsxBytes, entries);
  if (preamble.byteLength > 0) {
    localFileParts.push(preamble);
    localOffset += preamble.byteLength;
  }

  for (const segment of localFileSegments(xlsxBytes, view, eocd, entries)) {
    if (!keptEntries.includes(segment.entry)) continue;
    const replacement = rewrites.get(segment.entry);
    if (replacement) {
      const nameBytes = encodeUtf8(segment.entry.name);
      const crc = crc32(replacement);
      localFileParts.push(localFileHeader(nameBytes, replacement, crc));
      localFileParts.push(replacement);
      centralDirectoryParts.push(centralDirectoryHeader(nameBytes, replacement, crc, localOffset));
      localOffset += 30 + nameBytes.byteLength + replacement.byteLength;
    } else {
      localFileParts.push(segment.bytes);
      centralDirectoryParts.push(
        centralDirectoryHeaderWithLocalHeaderOffset(
          segment.entry.centralDirectoryBytes,
          localOffset,
        ),
      );
      localOffset += segment.bytes.byteLength;
    }
  }

  const centralDirectoryOffset = localOffset;
  const centralDirectorySize = byteLength(centralDirectoryParts);
  const cleaned = concatUint8Arrays([
    ...localFileParts,
    ...centralDirectoryParts,
    endOfCentralDirectory(
      centralDirectoryParts.length,
      centralDirectorySize,
      centralDirectoryOffset,
      eocd.comment,
    ),
  ]);
  await assertXlsxCleanExportPackageIsSafe(cleaned);
  return cleaned;
}

export async function scanXlsxCleanExportPackageDiagnostics(
  xlsxBytes: Uint8Array,
): Promise<readonly XlsxCleanExportPackageDiagnostic[]> {
  const view = new DataView(xlsxBytes.buffer, xlsxBytes.byteOffset, xlsxBytes.byteLength);
  const eocd = readEndOfCentralDirectory(view);
  const entries = readCentralDirectoryEntries(xlsxBytes, view, eocd);
  const inventoryXmlParts = await readPackageInventoryXmlParts(xlsxBytes, view, eocd, entries);
  return scanXlsxCleanExportPackageInventoryDiagnostics(
    entries.map((entry) => entry.name),
    inventoryXmlParts,
  );
}

async function readPackageInventoryXmlParts(
  xlsxBytes: Uint8Array,
  view: DataView,
  eocd: ReturnType<typeof readEndOfCentralDirectory>,
  entries: readonly ZipEntry[],
): Promise<XlsxCleanExportPackageInventoryXmlPart[]> {
  const inventoryXmlParts: XlsxCleanExportPackageInventoryXmlPart[] = [];
  for (const entry of entries) {
    const path = normalizePackagePath(entry.name);
    if (!isPackageInventoryXmlPath(path)) continue;
    inventoryXmlParts.push({
      path,
      xml: decodeUtf8(await readEntryData(xlsxBytes, view, eocd, entry)),
    });
  }
  return inventoryXmlParts;
}

async function assertXlsxCleanExportPackageIsSafe(xlsxBytes: Uint8Array): Promise<void> {
  const diagnostics = await scanXlsxCleanExportPackageDiagnostics(xlsxBytes);
  if (diagnostics.length > 0) {
    throw new XlsxCleanExportPackageError(diagnostics);
  }
}

function isMogVersionMetadataInventoryPath(path: string): boolean {
  return (
    path === MOG_VERSION_METADATA_PART ||
    path === 'customXml/mog-version-metadata-props.xml' ||
    path === 'customXml/_rels/mog-version-metadata.xml.rels'
  );
}

function isCleanExportScrubbedPackagePath(path: string): boolean {
  return isMogVersionMetadataInventoryPath(path) || isCustomXmlMetadataInventoryPath(path);
}

function isCustomXmlMetadataInventoryPath(path: string): boolean {
  return path.startsWith('customXml/') || path.includes('/customXml/') || path === 'xl/xmlMaps.xml';
}

function scrubCleanExportPackageInventoryXml(path: string, xml: string): string {
  if (path === '[Content_Types].xml') {
    return removeXmlTags(xml, 'Override', shouldDropCleanExportContentTypeOverride);
  }
  if (path.endsWith('.rels')) {
    return removeXmlTags(xml, 'Relationship', (tag) =>
      shouldDropCleanExportRelationship(path, tag),
    );
  }
  return xml;
}

function shouldDropCleanExportContentTypeOverride(tag: string): boolean {
  const partName = normalizePackagePath(xmlAttribute(tag, 'PartName') ?? '');
  if (partName.length > 0 && isCleanExportScrubbedPackagePath(partName)) return true;
  return hasCleanExportCustomXmlMetadataMarker(xmlAttribute(tag, 'ContentType') ?? '');
}

function shouldDropCleanExportRelationship(relsPath: string, tag: string): boolean {
  const targetMode = xmlAttribute(tag, 'TargetMode') ?? '';
  if (targetMode.toLowerCase() === 'external') return false;

  const type = xmlAttribute(tag, 'Type') ?? '';
  if (hasCleanExportCustomXmlMetadataMarker(type)) return true;

  const target = xmlAttribute(tag, 'Target') ?? '';
  const targetPath = resolveRelationshipTargetPath(relsPath, target);
  return targetPath !== null && isCleanExportScrubbedPackagePath(targetPath);
}

function removeXmlTags(xml: string, tagName: string, predicate: (tag: string) => boolean): string {
  let scrubbed = xml;
  for (const tag of extractXmlTags(xml, tagName)) {
    if (predicate(tag)) {
      scrubbed = scrubbed.replace(tag, '');
    }
  }
  return scrubbed;
}

function hasCleanExportCustomXmlMetadataMarker(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('customxml') ||
    normalized.includes('customxmlprops') ||
    normalized.includes('datastoreitem') ||
    normalized.includes('xmlmaps') ||
    normalized.includes('mog-version-metadata') ||
    normalized.includes('mogversionmetadata') ||
    normalized.includes('schemas.mog.dev/workbook/version-metadata') ||
    normalized.includes('schemas.mog.dev/officedocument/relationships/mogversionmetadata')
  );
}

async function readEntryData(
  bytes: Uint8Array,
  view: DataView,
  eocd: ReturnType<typeof readEndOfCentralDirectory>,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const localHeaderOffset = entry.localHeaderOffset;
  if (
    localHeaderOffset < 0 ||
    localHeaderOffset + 30 > view.byteLength ||
    view.getUint32(localHeaderOffset, true) !== 0x04034b50
  ) {
    throw new Error(`invalid ZIP local file header for ${entry.name}`);
  }
  const nameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart < localHeaderOffset || dataEnd > eocd.centralDirectoryOffset) {
    throw new Error(`invalid ZIP local file data for ${entry.name}`);
  }
  const compressed = bytes.subarray(dataStart, dataEnd);
  if (entry.compressionMethod === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new Error(`stored XLSX package entry size mismatch: ${entry.name}`);
    }
    return compressed;
  }
  if (entry.compressionMethod === 8) {
    const inflated = await inflateRaw(compressed);
    if (inflated.byteLength !== entry.uncompressedSize) {
      throw new Error(`deflated XLSX package entry size mismatch: ${entry.name}`);
    }
    return inflated;
  }
  throw new Error(`unsupported XLSX package compression method for ${entry.name}`);
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('deflated XLSX package cleanup requires DecompressionStream');
  }
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readCentralDirectoryEntries(
  bytes: Uint8Array,
  view: DataView,
  eocd: ReturnType<typeof readEndOfCentralDirectory>,
): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = eocd.centralDirectoryOffset;
  const end = eocd.centralDirectoryOffset + eocd.centralDirectorySize;
  while (offset < end) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`invalid ZIP central directory header at ${offset}`);
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nextOffset = nameStart + nameLength + extraLength + commentLength;
    entries.push({
      name: decodeUtf8(bytes.subarray(nameStart, nameStart + nameLength)),
      centralDirectoryBytes: bytes.subarray(offset, nextOffset),
      localHeaderOffset: view.getUint32(offset + 42, true),
      generalPurposeBitFlag: view.getUint16(offset + 8, true),
      compressionMethod: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
    });
    offset = nextOffset;
  }
  if (entries.length !== eocd.entryCount) {
    throw new Error(`ZIP central directory entry count mismatch: ${entries.length}`);
  }
  return entries;
}

function archivePreambleBytes(bytes: Uint8Array, entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length === 0) return bytes.subarray(0, 0);
  return bytes.subarray(0, Math.min(...entries.map((entry) => entry.localHeaderOffset)));
}

function localFileSegments(
  bytes: Uint8Array,
  view: DataView,
  eocd: ReturnType<typeof readEndOfCentralDirectory>,
  entries: readonly ZipEntry[],
): Array<{ readonly entry: ZipEntry; readonly bytes: Uint8Array }> {
  return [...entries]
    .sort((left, right) => left.localHeaderOffset - right.localHeaderOffset)
    .map((entry, index, sortedEntries) => {
      const nextEntry = sortedEntries[index + 1];
      const start = entry.localHeaderOffset;
      const end = nextEntry ? nextEntry.localHeaderOffset : eocd.centralDirectoryOffset;
      if (start >= eocd.centralDirectoryOffset || start < 0 || end <= start) {
        throw new Error(`invalid ZIP local file offset for ${entry.name}`);
      }
      if (view.getUint32(start, true) !== 0x04034b50) {
        throw new Error(`invalid ZIP local file header for ${entry.name}`);
      }
      return { entry, bytes: bytes.subarray(start, end) };
    });
}

function readEndOfCentralDirectory(view: DataView): {
  readonly entryCount: number;
  readonly centralDirectorySize: number;
  readonly centralDirectoryOffset: number;
  readonly comment: Uint8Array;
} {
  const offset = findEndOfCentralDirectory(view);
  const commentLength = view.getUint16(offset + 20, true);
  return {
    entryCount: view.getUint16(offset + 10, true),
    centralDirectorySize: view.getUint32(offset + 12, true),
    centralDirectoryOffset: view.getUint32(offset + 16, true),
    comment: new Uint8Array(view.buffer, view.byteOffset + offset + 22, commentLength),
  };
}

function findEndOfCentralDirectory(view: DataView): number {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('missing ZIP end of central directory');
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

function centralDirectoryHeaderWithLocalHeaderOffset(
  entryBytes: Uint8Array,
  localHeaderOffset: number,
): Uint8Array {
  const header = new Uint8Array(entryBytes);
  new DataView(header.buffer).setUint32(42, localHeaderOffset, true);
  return header;
}

function endOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
  comment: Uint8Array,
): Uint8Array {
  const record = new Uint8Array(22 + comment.byteLength);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, comment.byteLength, true);
  record.set(comment, 22);
  return record;
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

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
