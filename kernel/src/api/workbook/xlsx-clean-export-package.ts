const MOG_VERSION_METADATA_PART = 'customXml/mog-version-metadata.xml';

export type XlsxCleanExportPackageDiagnosticCode =
  | 'XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT'
  | 'XLSX_CLEAN_EXPORT_ACTIVEX_CONTENT'
  | 'XLSX_CLEAN_EXPORT_OLE_OR_EMBEDDED_EXECUTABLE_CONTENT'
  | 'XLSX_CLEAN_EXPORT_EXTERNAL_DATA_CONNECTION_CONTENT'
  | 'XLSX_CLEAN_EXPORT_CUSTOM_XML_METADATA_CONTENT'
  | 'XLSX_CLEAN_EXPORT_ENCRYPTED_PACKAGE_MARKER'
  | 'XLSX_CLEAN_EXPORT_DIGITAL_SIGNATURE_MARKER'
  | 'XLSX_CLEAN_EXPORT_DANGLING_PACKAGE_REFERENCE';

export type XlsxCleanExportPackageDiagnosticCategory =
  | 'macrosVba'
  | 'activeX'
  | 'oleOrEmbeddedExecutable'
  | 'externalDataConnection'
  | 'customXmlMetadata'
  | 'encryptedPackage'
  | 'digitalSignature'
  | 'danglingPackageReference';

export interface XlsxCleanExportPackageDiagnostic {
  readonly code: XlsxCleanExportPackageDiagnosticCode;
  readonly category: XlsxCleanExportPackageDiagnosticCategory;
  readonly severity: 'error';
  readonly count: number;
}

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
  const view = new DataView(xlsxBytes.buffer, xlsxBytes.byteOffset, xlsxBytes.byteLength);
  const eocd = readEndOfCentralDirectory(view);
  const entries = readCentralDirectoryEntries(xlsxBytes, view, eocd);
  const rewrites = new Map<ZipEntry, Uint8Array>();
  let changed = false;

  for (const entry of entries) {
    const normalizedName = normalizePackagePath(entry.name);
    if (isMogVersionMetadataInventoryPath(normalizedName)) {
      changed = true;
      continue;
    }

    if (isPackageInventoryXmlPath(normalizedName)) {
      const xml = decodeUtf8(await readEntryData(xlsxBytes, view, eocd, entry));
      const scrubbed = scrubMogPackageInventoryXml(normalizedName, xml);
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
    (entry) => !isMogVersionMetadataInventoryPath(normalizePackagePath(entry.name)),
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
  const counts = new Map<XlsxCleanExportPackageDiagnosticCode, number>();
  const normalizedNames = entries.map((entry) => normalizePackagePath(entry.name));
  const normalizedNameSet = new Set(normalizedNames);

  for (const name of normalizedNames) {
    scanPackagePartPath(name, counts);
  }

  for (const entry of entries) {
    const path = normalizePackagePath(entry.name);
    if (!isPackageInventoryXmlPath(path)) continue;
    const xml = decodeUtf8(await readEntryData(xlsxBytes, view, eocd, entry));
    if (path === '[Content_Types].xml') {
      scanContentTypesXml(xml, normalizedNameSet, counts);
    } else if (path.endsWith('.rels')) {
      scanRelationshipsXml(path, xml, normalizedNameSet, counts);
    }
  }

  return diagnosticsFromCounts(counts);
}

async function assertXlsxCleanExportPackageIsSafe(xlsxBytes: Uint8Array): Promise<void> {
  const diagnostics = await scanXlsxCleanExportPackageDiagnostics(xlsxBytes);
  if (diagnostics.length > 0) {
    throw new XlsxCleanExportPackageError(diagnostics);
  }
}

function isPackageInventoryXmlPath(path: string): boolean {
  return path === '[Content_Types].xml' || path.endsWith('.rels');
}

function isMogVersionMetadataInventoryPath(path: string): boolean {
  return (
    path === MOG_VERSION_METADATA_PART ||
    path === 'customXml/mog-version-metadata-props.xml' ||
    path === 'customXml/_rels/mog-version-metadata.xml.rels'
  );
}

function scrubMogPackageInventoryXml(path: string, xml: string): string {
  if (path === '[Content_Types].xml') {
    return xml.replace(/<Override\b[^>]*(?:mog-version-metadata|schemas\.mog\.dev)[^>]*\/>/g, '');
  }
  if (path.endsWith('.rels')) {
    return xml.replace(
      /<Relationship\b[^>]*(?:mog-version-metadata|mogVersionMetadata|schemas\.mog\.dev)[^>]*\/>/g,
      '',
    );
  }
  return xml;
}

const CLEAN_EXPORT_DIAGNOSTIC_DEFINITIONS: ReadonlyArray<
  Omit<XlsxCleanExportPackageDiagnostic, 'count'>
> = [
  {
    code: 'XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT',
    category: 'macrosVba',
    severity: 'error',
  },
  {
    code: 'XLSX_CLEAN_EXPORT_ACTIVEX_CONTENT',
    category: 'activeX',
    severity: 'error',
  },
  {
    code: 'XLSX_CLEAN_EXPORT_OLE_OR_EMBEDDED_EXECUTABLE_CONTENT',
    category: 'oleOrEmbeddedExecutable',
    severity: 'error',
  },
  {
    code: 'XLSX_CLEAN_EXPORT_EXTERNAL_DATA_CONNECTION_CONTENT',
    category: 'externalDataConnection',
    severity: 'error',
  },
  {
    code: 'XLSX_CLEAN_EXPORT_CUSTOM_XML_METADATA_CONTENT',
    category: 'customXmlMetadata',
    severity: 'error',
  },
  {
    code: 'XLSX_CLEAN_EXPORT_ENCRYPTED_PACKAGE_MARKER',
    category: 'encryptedPackage',
    severity: 'error',
  },
  {
    code: 'XLSX_CLEAN_EXPORT_DIGITAL_SIGNATURE_MARKER',
    category: 'digitalSignature',
    severity: 'error',
  },
  {
    code: 'XLSX_CLEAN_EXPORT_DANGLING_PACKAGE_REFERENCE',
    category: 'danglingPackageReference',
    severity: 'error',
  },
];

function diagnosticsFromCounts(
  counts: ReadonlyMap<XlsxCleanExportPackageDiagnosticCode, number>,
): readonly XlsxCleanExportPackageDiagnostic[] {
  return CLEAN_EXPORT_DIAGNOSTIC_DEFINITIONS.flatMap((definition) => {
    const count = counts.get(definition.code) ?? 0;
    return count > 0 ? [{ ...definition, count }] : [];
  });
}

function addCleanExportDiagnostic(
  counts: Map<XlsxCleanExportPackageDiagnosticCode, number>,
  code: XlsxCleanExportPackageDiagnosticCode,
): void {
  counts.set(code, (counts.get(code) ?? 0) + 1);
}

function scanPackagePartPath(
  path: string,
  counts: Map<XlsxCleanExportPackageDiagnosticCode, number>,
): void {
  const normalized = normalizePackagePath(path).toLowerCase();
  if (isMacroVbaPath(normalized)) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT');
  }
  if (isActiveXPath(normalized)) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_ACTIVEX_CONTENT');
  }
  if (isOleOrEmbeddedExecutablePath(normalized)) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_OLE_OR_EMBEDDED_EXECUTABLE_CONTENT');
  }
  if (isExternalDataConnectionPath(normalized)) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_EXTERNAL_DATA_CONNECTION_CONTENT');
  }
  if (isCustomXmlMetadataPath(normalized)) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_CUSTOM_XML_METADATA_CONTENT');
  }
  if (isEncryptedPackagePath(normalized)) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_ENCRYPTED_PACKAGE_MARKER');
  }
  if (isDigitalSignaturePath(normalized)) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_DIGITAL_SIGNATURE_MARKER');
  }
}

function scanContentTypesXml(
  xml: string,
  normalizedNameSet: ReadonlySet<string>,
  counts: Map<XlsxCleanExportPackageDiagnosticCode, number>,
): void {
  for (const tag of extractXmlTags(xml, 'Default')) {
    scanContentType(xmlAttribute(tag, 'ContentType'), counts);
  }

  for (const tag of extractXmlTags(xml, 'Override')) {
    const partName = normalizePackagePath(xmlAttribute(tag, 'PartName') ?? '');
    if (partName.length > 0) {
      scanPackagePartPath(partName, counts);
      if (!normalizedNameSet.has(partName)) {
        addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_DANGLING_PACKAGE_REFERENCE');
      }
    }
    scanContentType(xmlAttribute(tag, 'ContentType'), counts);
  }
}

function scanRelationshipsXml(
  relsPath: string,
  xml: string,
  normalizedNameSet: ReadonlySet<string>,
  counts: Map<XlsxCleanExportPackageDiagnosticCode, number>,
): void {
  for (const tag of extractXmlTags(xml, 'Relationship')) {
    const type = xmlAttribute(tag, 'Type') ?? '';
    const target = xmlAttribute(tag, 'Target') ?? '';
    const targetMode = xmlAttribute(tag, 'TargetMode') ?? '';
    scanRelationshipTypeAndTarget(type, target, counts);
    if (target.length === 0 || targetMode.toLowerCase() === 'external') continue;

    const targetPath = resolveRelationshipTargetPath(relsPath, target);
    if (!targetPath) continue;
    scanPackagePartPath(targetPath, counts);
    if (!normalizedNameSet.has(targetPath)) {
      addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_DANGLING_PACKAGE_REFERENCE');
    }
  }
}

function scanContentType(
  value: string | undefined,
  counts: Map<XlsxCleanExportPackageDiagnosticCode, number>,
): void {
  if (!value) return;
  const normalized = value.toLowerCase();
  if (
    normalized.includes('vbaproject') ||
    normalized.includes('vba') ||
    normalized.includes('macroenabled') ||
    normalized.includes('attachedtoolbars')
  ) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT');
  }
  if (normalized.includes('activex')) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_ACTIVEX_CONTENT');
  }
  if (normalized.includes('oleobject') || normalized.includes('vnd.ms-package')) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_OLE_OR_EMBEDDED_EXECUTABLE_CONTENT');
  }
  if (
    normalized.includes('spreadsheetml.connections') ||
    normalized.includes('spreadsheetml.querytable') ||
    normalized.includes('spreadsheetml.externallink')
  ) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_EXTERNAL_DATA_CONNECTION_CONTENT');
  }
  if (
    normalized.includes('customxml') ||
    normalized.includes('xmlmaps') ||
    normalized.includes('datastoreitem')
  ) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_CUSTOM_XML_METADATA_CONTENT');
  }
  if (normalized.includes('encryptedpackage') || normalized.includes('encryptioninfo')) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_ENCRYPTED_PACKAGE_MARKER');
  }
  if (normalized.includes('digital-signature') || normalized.includes('xmlsignature')) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_DIGITAL_SIGNATURE_MARKER');
  }
}

function scanRelationshipTypeAndTarget(
  type: string,
  target: string,
  counts: Map<XlsxCleanExportPackageDiagnosticCode, number>,
): void {
  const normalizedType = type.toLowerCase();
  const normalizedTarget = stripRelationshipTargetSuffixes(target).toLowerCase();

  if (
    normalizedType.includes('/vbaproject') ||
    normalizedType.includes('/vbadata') ||
    normalizedType.includes('/attachedtoolbars')
  ) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT');
  }
  if (
    normalizedType.includes('/activex') ||
    (normalizedType.endsWith('/control') && isActiveXPath(normalizedTarget))
  ) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_ACTIVEX_CONTENT');
  }
  if (
    normalizedType.includes('/oleobject') ||
    (normalizedType.endsWith('/package') &&
      (hasUnsafeExecutablePackageExtension(normalizedTarget) ||
        normalizedTarget.includes('/embeddings/'))) ||
    (normalizedTarget.includes('/embeddings/') &&
      (normalizedType.endsWith('/package') || normalizedType.includes('/oleobject')))
  ) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_OLE_OR_EMBEDDED_EXECUTABLE_CONTENT');
  }
  if (
    normalizedType.includes('/digital-signature/') ||
    normalizedTarget.startsWith('_xmlsignatures/') ||
    normalizedTarget.includes('/_xmlsignatures/')
  ) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_DIGITAL_SIGNATURE_MARKER');
  }
  if (
    normalizedType.endsWith('/connections') ||
    normalizedType.endsWith('/querytable') ||
    normalizedType.endsWith('/externallink') ||
    normalizedType.endsWith('/externallinkpath') ||
    normalizedType.endsWith('/externallinklongpath') ||
    normalizedType.includes('/externallinkpath/') ||
    normalizedType.includes('/xlexternallinkpath/') ||
    normalizedType.includes('/xlexternallinklongpath/')
  ) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_EXTERNAL_DATA_CONNECTION_CONTENT');
  }
  if (
    normalizedType.endsWith('/customxml') ||
    normalizedType.endsWith('/customxmlprops') ||
    normalizedType.endsWith('/xmlmaps') ||
    normalizedTarget.startsWith('customxml/') ||
    normalizedTarget.includes('/customxml/')
  ) {
    addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_CUSTOM_XML_METADATA_CONTENT');
  }
}

function isMacroVbaPath(path: string): boolean {
  return (
    path.includes('vbaproject') ||
    path.endsWith('/vbadata.xml') ||
    path.endsWith('/attachedtoolbars.bin') ||
    path.endsWith('.vba') ||
    path.endsWith('.bas') ||
    path.endsWith('.xla') ||
    path.endsWith('.xlam') ||
    path.endsWith('.xlsm') ||
    path.endsWith('.xltm')
  );
}

function isActiveXPath(path: string): boolean {
  return path.includes('/activex/') || path.includes('/ctrlprops/') || path.includes('activex');
}

function isOleOrEmbeddedExecutablePath(path: string): boolean {
  return path.includes('/embeddings/') || hasUnsafeExecutablePackageExtension(path);
}

function isEncryptedPackagePath(path: string): boolean {
  return (
    path === 'encryptedpackage' || path === 'encryptioninfo' || path.endsWith('/encryptedpackage')
  );
}

function isDigitalSignaturePath(path: string): boolean {
  return path.startsWith('_xmlsignatures/') || path.includes('/_xmlsignatures/');
}

function isExternalDataConnectionPath(path: string): boolean {
  return (
    path === 'xl/connections.xml' ||
    (path.startsWith('xl/querytables/') && path.endsWith('.xml')) ||
    path.startsWith('xl/externallinks/')
  );
}

function isCustomXmlMetadataPath(path: string): boolean {
  return (
    path.startsWith('customxml/') ||
    path.includes('/customxml/') ||
    path === 'xl/xmlmaps.xml'
  );
}

function hasUnsafeExecutablePackageExtension(path: string): boolean {
  const normalized = stripRelationshipTargetSuffixes(path).toLowerCase();
  return UNSAFE_EMBEDDED_PACKAGE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

const UNSAFE_EMBEDDED_PACKAGE_EXTENSIONS = [
  '.ade',
  '.adp',
  '.app',
  '.application',
  '.appref-ms',
  '.bas',
  '.bat',
  '.chm',
  '.cmd',
  '.com',
  '.cpl',
  '.crt',
  '.dll',
  '.exe',
  '.fxp',
  '.gadget',
  '.hlp',
  '.hta',
  '.inf',
  '.ins',
  '.isp',
  '.jar',
  '.js',
  '.jse',
  '.lnk',
  '.mda',
  '.mdb',
  '.mde',
  '.mdt',
  '.mdw',
  '.mdz',
  '.msc',
  '.msi',
  '.msp',
  '.mst',
  '.ops',
  '.pcd',
  '.pif',
  '.prf',
  '.prg',
  '.ps1',
  '.ps1xml',
  '.ps2',
  '.ps2xml',
  '.psc1',
  '.psc2',
  '.reg',
  '.scf',
  '.scr',
  '.sct',
  '.shb',
  '.shs',
  '.url',
  '.vb',
  '.vbe',
  '.vbs',
  '.vsmacros',
  '.vss',
  '.vst',
  '.vsw',
  '.ws',
  '.wsc',
  '.wsf',
  '.wsh',
  '.xla',
  '.xlam',
  '.xlsm',
  '.xltm',
];

function extractXmlTags(xml: string, tagName: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${tagName}\\b[^>]*>`, 'g'))].map(
    (match) => match[0] ?? '',
  );
}

function xmlAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? undefined : decodeXmlAttributeValue(value);
}

function decodeXmlAttributeValue(value: string): string {
  return value.replace(
    /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|amp|lt|gt|quot|apos);/g,
    (match, hex, dec) => {
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
      switch (match) {
        case '&amp;':
          return '&';
        case '&lt;':
          return '<';
        case '&gt;':
          return '>';
        case '&quot;':
          return '"';
        case '&apos;':
          return "'";
        default:
          return match;
      }
    },
  );
}

function resolveRelationshipTargetPath(relsPath: string, target: string): string | null {
  const normalizedTarget = stripRelationshipTargetSuffixes(target).replace(/\\/g, '/');
  if (normalizedTarget.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(normalizedTarget)) return null;
  const basePath = relationshipBasePath(relsPath);
  if (basePath === null) return null;
  return normalizePackageSegments(
    normalizePackagePath(
      normalizedTarget.startsWith('/') ? normalizedTarget : `${basePath}${normalizedTarget}`,
    ),
  );
}

function relationshipBasePath(relsPath: string): string | null {
  if (relsPath === '_rels/.rels') return '';
  if (!relsPath.endsWith('.rels')) return null;
  const marker = '/_rels/';
  const markerOffset = relsPath.lastIndexOf(marker);
  if (markerOffset === -1) return null;
  const sourceDirectory = relsPath.slice(0, markerOffset);
  const sourceFile = relsPath.slice(markerOffset + marker.length, -'.rels'.length);
  const sourcePath = `${sourceDirectory}/${sourceFile}`;
  const separatorOffset = sourcePath.lastIndexOf('/');
  return separatorOffset === -1 ? '' : `${sourcePath.slice(0, separatorOffset)}/`;
}

function stripRelationshipTargetSuffixes(target: string): string {
  return target.split(/[?#]/, 1)[0] ?? '';
}

function normalizePackageSegments(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
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

function normalizePackagePath(value: string): string {
  return value.replace(/^\/+/, '');
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
