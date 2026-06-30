import {
  isPackageInventoryXmlPath,
  normalizePackagePath,
  scanXlsxCleanExportPackageInventoryDiagnostics,
  type XlsxCleanExportPackageDiagnostic,
  type XlsxCleanExportPackageInventoryXmlPart,
} from './xlsx-clean-export-package-scan';
import { hasCleanExportBlockedContentType } from './xlsx-clean-export-package-scan-content-types';
import { isCleanExportBlockedPackagePath } from './xlsx-clean-export-package-scan-paths';
import {
  hasCleanExportBlockedRelationship,
  isExternalRelationship,
  resolveRelationshipTargetPath,
} from './xlsx-clean-export-package-scan-relationships';
import { extractXmlTags, xmlAttribute } from './xlsx-clean-export-package-scan-xml';

const MOG_VERSION_METADATA_PART = 'customXml/mog-version-metadata.xml';
const XLSX_WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

export type {
  XlsxCleanExportPackageDiagnostic,
  XlsxCleanExportPackageDiagnosticCategory,
  XlsxCleanExportPackageDiagnosticCode,
} from './xlsx-clean-export-package-scan';

interface ZipEntry {
  readonly name: string;
  readonly centralDirectoryBytes: Uint8Array;
  readonly localHeaderOffset: number;
  readonly generalPurposeBitFlag: number;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

interface PackageInventoryCleanupPolicy {
  readonly collectScrubbedPackagePaths: (
    xlsxBytes: Uint8Array,
    view: DataView,
    eocd: ReturnType<typeof readEndOfCentralDirectory>,
    entries: readonly ZipEntry[],
  ) => Promise<Set<string>>;
  readonly isRewritableXmlPath: (path: string) => boolean;
  readonly scrubPackageXml: (
    path: string,
    xml: string,
    scrubbedPaths: ReadonlySet<string>,
    keptNameSet: ReadonlySet<string>,
  ) => string;
}

export async function removeMogVersionMetadataPackageInventoryFromXlsx(
  xlsxBytes: Uint8Array,
): Promise<Uint8Array> {
  return removeXlsxPackageInventory(xlsxBytes, {
    collectScrubbedPackagePaths: collectMogVersionMetadataScrubbedPackagePaths,
    isRewritableXmlPath: isPackageInventoryXmlPath,
    scrubPackageXml: scrubMogVersionMetadataPackageXml,
  });
}

export async function removeCleanExportBlockedPackageInventoryFromXlsx(
  xlsxBytes: Uint8Array,
): Promise<Uint8Array> {
  return removeXlsxPackageInventory(xlsxBytes, {
    collectScrubbedPackagePaths: collectCleanExportScrubbedPackagePaths,
    isRewritableXmlPath: isCleanExportRewritableXmlPath,
    scrubPackageXml: scrubCleanExportPackageXml,
  });
}

async function removeXlsxPackageInventory(
  xlsxBytes: Uint8Array,
  policy: PackageInventoryCleanupPolicy,
): Promise<Uint8Array> {
  const view = new DataView(xlsxBytes.buffer, xlsxBytes.byteOffset, xlsxBytes.byteLength);
  const eocd = readEndOfCentralDirectory(view);
  const entries = readCentralDirectoryEntries(xlsxBytes, view, eocd);
  const scrubbedPaths = await policy.collectScrubbedPackagePaths(xlsxBytes, view, eocd, entries);
  const keptNameSet = new Set(
    entries
      .map((entry) => normalizePackagePath(entry.name))
      .filter((path) => !scrubbedPaths.has(path)),
  );
  const rewrites = new Map<ZipEntry, Uint8Array>();
  let changed = scrubbedPaths.size > 0;

  for (const entry of entries) {
    const normalizedName = normalizePackagePath(entry.name);
    if (scrubbedPaths.has(normalizedName)) continue;

    if (policy.isRewritableXmlPath(normalizedName)) {
      const xml = decodeUtf8(await readEntryData(xlsxBytes, view, eocd, entry));
      const scrubbed = policy.scrubPackageXml(normalizedName, xml, scrubbedPaths, keptNameSet);
      if (scrubbed !== xml) {
        rewrites.set(entry, encodeUtf8(scrubbed));
        changed = true;
      }
    }
  }

  if (!changed) {
    return xlsxBytes;
  }

  const keptEntries = entries.filter(
    (entry) => !scrubbedPaths.has(normalizePackagePath(entry.name)),
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

function isMogVersionMetadataInventoryPath(path: string): boolean {
  return (
    path === MOG_VERSION_METADATA_PART ||
    path === 'customXml/mog-version-metadata-props.xml' ||
    path === 'customXml/_rels/mog-version-metadata.xml.rels'
  );
}

async function collectMogVersionMetadataScrubbedPackagePaths(
  xlsxBytes: Uint8Array,
  view: DataView,
  eocd: ReturnType<typeof readEndOfCentralDirectory>,
  entries: readonly ZipEntry[],
): Promise<Set<string>> {
  const scrubbedPaths = new Set<string>();
  for (const entry of entries) {
    const path = normalizePackagePath(entry.name);
    if (isMogVersionMetadataInventoryPath(path)) scrubbedPaths.add(path);
  }

  for (const entry of entries) {
    const path = normalizePackagePath(entry.name);
    if (!isPackageInventoryXmlPath(path)) continue;
    const xml = decodeUtf8(await readEntryData(xlsxBytes, view, eocd, entry));
    if (path === '[Content_Types].xml') {
      collectMogVersionMetadataContentTypeScrubbedPackagePaths(xml, scrubbedPaths);
    } else if (path.endsWith('.rels')) {
      collectMogVersionMetadataRelationshipScrubbedPackagePaths(path, xml, scrubbedPaths);
    }
  }
  return scrubbedPaths;
}

function collectMogVersionMetadataContentTypeScrubbedPackagePaths(
  xml: string,
  scrubbedPaths: Set<string>,
): void {
  for (const tag of extractXmlTags(xml, 'Override')) {
    const partName = normalizePackagePath(xmlAttribute(tag, 'PartName') ?? '');
    const contentType = xmlAttribute(tag, 'ContentType') ?? '';
    if (isMogVersionMetadataInventoryPath(partName) || hasMogVersionMetadataMarker(contentType)) {
      scrubbedPaths.add(partName);
    }
  }
}

function collectMogVersionMetadataRelationshipScrubbedPackagePaths(
  relsPath: string,
  xml: string,
  scrubbedPaths: Set<string>,
): void {
  for (const tag of extractXmlTags(xml, 'Relationship')) {
    const type = xmlAttribute(tag, 'Type') ?? '';
    const target = xmlAttribute(tag, 'Target') ?? '';
    const targetPath = resolveRelationshipTargetPath(relsPath, target);
    if (
      hasMogVersionMetadataMarker(type) ||
      hasMogVersionMetadataMarker(target) ||
      (targetPath !== null && isMogVersionMetadataInventoryPath(targetPath))
    ) {
      if (targetPath !== null) scrubbedPaths.add(targetPath);
    }
  }
}

function scrubMogVersionMetadataPackageXml(
  path: string,
  xml: string,
  scrubbedPaths: ReadonlySet<string>,
): string {
  if (path === '[Content_Types].xml') {
    return removeXmlTags(xml, 'Override', (tag) =>
      shouldDropMogVersionMetadataContentTypeOverride(tag, scrubbedPaths),
    );
  }
  if (path.endsWith('.rels')) {
    return removeXmlTags(xml, 'Relationship', (tag) =>
      shouldDropMogVersionMetadataRelationship(path, tag, scrubbedPaths),
    );
  }
  return xml;
}

function shouldDropMogVersionMetadataContentTypeOverride(
  tag: string,
  scrubbedPaths: ReadonlySet<string>,
): boolean {
  const partName = normalizePackagePath(xmlAttribute(tag, 'PartName') ?? '');
  const contentType = xmlAttribute(tag, 'ContentType') ?? '';
  return (
    scrubbedPaths.has(partName) ||
    isMogVersionMetadataInventoryPath(partName) ||
    hasMogVersionMetadataMarker(contentType)
  );
}

function shouldDropMogVersionMetadataRelationship(
  relsPath: string,
  tag: string,
  scrubbedPaths: ReadonlySet<string>,
): boolean {
  const type = xmlAttribute(tag, 'Type') ?? '';
  const target = xmlAttribute(tag, 'Target') ?? '';
  const targetPath = resolveRelationshipTargetPath(relsPath, target);
  return (
    hasMogVersionMetadataMarker(type) ||
    hasMogVersionMetadataMarker(target) ||
    (targetPath !== null &&
      (scrubbedPaths.has(targetPath) || isMogVersionMetadataInventoryPath(targetPath)))
  );
}

function isCleanExportScrubbedPackagePath(path: string): boolean {
  return isMogVersionMetadataInventoryPath(path) || isCleanExportBlockedPackagePath(path);
}

async function collectCleanExportScrubbedPackagePaths(
  xlsxBytes: Uint8Array,
  view: DataView,
  eocd: ReturnType<typeof readEndOfCentralDirectory>,
  entries: readonly ZipEntry[],
): Promise<Set<string>> {
  const scrubbedPaths = new Set<string>();
  for (const entry of entries) {
    const path = normalizePackagePath(entry.name);
    if (isCleanExportScrubbedPackagePath(path)) scrubbedPaths.add(path);
  }

  for (const entry of entries) {
    const path = normalizePackagePath(entry.name);
    if (!isPackageInventoryXmlPath(path)) continue;
    const xml = decodeUtf8(await readEntryData(xlsxBytes, view, eocd, entry));
    if (path === '[Content_Types].xml') {
      collectContentTypeScrubbedPackagePaths(xml, scrubbedPaths);
    } else if (path.endsWith('.rels')) {
      collectRelationshipScrubbedPackagePaths(path, xml, scrubbedPaths);
    }
  }
  return scrubbedPaths;
}

function collectContentTypeScrubbedPackagePaths(xml: string, scrubbedPaths: Set<string>): void {
  for (const tag of extractXmlTags(xml, 'Override')) {
    const partName = normalizePackagePath(xmlAttribute(tag, 'PartName') ?? '');
    if (partName.length === 0) continue;
    const contentType = xmlAttribute(tag, 'ContentType') ?? '';
    if (
      isCleanExportScrubbedPackagePath(partName) ||
      shouldScrubPackagePartForContentType(partName, contentType)
    ) {
      scrubbedPaths.add(partName);
    }
  }
}

function collectRelationshipScrubbedPackagePaths(
  relsPath: string,
  xml: string,
  scrubbedPaths: Set<string>,
): void {
  for (const tag of extractXmlTags(xml, 'Relationship')) {
    const type = xmlAttribute(tag, 'Type') ?? '';
    const target = xmlAttribute(tag, 'Target') ?? '';
    if (
      !hasCleanExportBlockedRelationship(type, target) &&
      !hasCleanExportCustomXmlMetadataMarker(type)
    ) {
      continue;
    }
    const targetPath = resolveRelationshipTargetPath(relsPath, target);
    if (targetPath) scrubbedPaths.add(targetPath);
  }
}

function isCleanExportRewritableXmlPath(path: string): boolean {
  return isPackageInventoryXmlPath(path) || path === 'xl/workbook.xml';
}

function scrubCleanExportPackageXml(
  path: string,
  xml: string,
  scrubbedPaths: ReadonlySet<string>,
  keptNameSet: ReadonlySet<string>,
): string {
  if (path === '[Content_Types].xml') {
    const downgraded = rewriteCleanExportWorkbookContentType(xml);
    const withoutDefaults = removeXmlTags(
      downgraded,
      'Default',
      shouldDropCleanExportContentTypeDefault,
    );
    return removeXmlTags(withoutDefaults, 'Override', (tag) =>
      shouldDropCleanExportContentTypeOverride(tag, scrubbedPaths, keptNameSet),
    );
  }
  if (path.endsWith('.rels')) {
    return removeXmlTags(xml, 'Relationship', (tag) =>
      shouldDropCleanExportRelationship(path, tag, scrubbedPaths, keptNameSet),
    );
  }
  if (path === 'xl/workbook.xml') return removeWorkbookExternalReferences(xml);
  return xml;
}

function shouldDropCleanExportContentTypeDefault(tag: string): boolean {
  return shouldDropCleanExportContentTypeValue(xmlAttribute(tag, 'ContentType') ?? '');
}

function shouldDropCleanExportContentTypeOverride(
  tag: string,
  scrubbedPaths: ReadonlySet<string>,
  keptNameSet: ReadonlySet<string>,
): boolean {
  const partName = normalizePackagePath(xmlAttribute(tag, 'PartName') ?? '');
  if (partName.length === 0) return false;
  if (scrubbedPaths.has(partName) || !keptNameSet.has(partName)) return true;
  return shouldScrubPackagePartForContentType(partName, xmlAttribute(tag, 'ContentType') ?? '');
}

function shouldDropCleanExportRelationship(
  relsPath: string,
  tag: string,
  scrubbedPaths: ReadonlySet<string>,
  keptNameSet: ReadonlySet<string>,
): boolean {
  const targetMode = xmlAttribute(tag, 'TargetMode') ?? '';
  const type = xmlAttribute(tag, 'Type') ?? '';
  const target = xmlAttribute(tag, 'Target') ?? '';
  if (isExternalRelationship(target, targetMode) && !isHyperlinkRelationshipType(type)) {
    return true;
  }
  if (hasCleanExportBlockedRelationship(type, target)) return true;
  if (hasCleanExportCustomXmlMetadataMarker(type)) return true;
  if (targetMode.toLowerCase() === 'external') return false;

  const targetPath = resolveRelationshipTargetPath(relsPath, target);
  return targetPath !== null && (scrubbedPaths.has(targetPath) || !keptNameSet.has(targetPath));
}

function shouldScrubPackagePartForContentType(partName: string, contentType: string): boolean {
  if (isRewritableWorkbookContentType(partName, contentType)) return false;
  return shouldDropCleanExportContentTypeValue(contentType);
}

function shouldDropCleanExportContentTypeValue(contentType: string): boolean {
  return (
    hasCleanExportBlockedContentType(contentType) ||
    hasCleanExportCustomXmlMetadataMarker(contentType)
  );
}

function rewriteCleanExportWorkbookContentType(xml: string): string {
  let scrubbed = xml;
  for (const tag of extractXmlTags(xml, 'Override')) {
    const partName = normalizePackagePath(xmlAttribute(tag, 'PartName') ?? '');
    const contentType = xmlAttribute(tag, 'ContentType') ?? '';
    if (!isRewritableWorkbookContentType(partName, contentType)) continue;
    scrubbed = scrubbed.replace(
      tag,
      replaceXmlAttribute(tag, 'ContentType', XLSX_WORKBOOK_CONTENT_TYPE),
    );
  }
  return scrubbed;
}

function isRewritableWorkbookContentType(partName: string, contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return partName === 'xl/workbook.xml' && normalized.includes('macroenabled.main+xml');
}

function replaceXmlAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])[^"']*\\1`);
  return tag.replace(pattern, (_match, quote: string) => `${name}=${quote}${value}${quote}`);
}

function removeWorkbookExternalReferences(xml: string): string {
  return xml
    .replace(/<(?:[\w-]+:)?externalReferences\b[^>]*\/>/g, '')
    .replace(
      /<(?:[\w-]+:)?externalReferences\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?externalReferences>/g,
      '',
    );
}

function isHyperlinkRelationshipType(type: string): boolean {
  return type.toLowerCase().endsWith('/hyperlink');
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

function hasMogVersionMetadataMarker(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
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
