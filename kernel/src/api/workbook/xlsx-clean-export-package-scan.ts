export type XlsxCleanExportPackageDiagnosticCode =
  | 'XLSX_CLEAN_EXPORT_MACRO_VBA_CONTENT'
  | 'XLSX_CLEAN_EXPORT_ACTIVEX_CONTENT'
  | 'XLSX_CLEAN_EXPORT_OLE_OR_EMBEDDED_EXECUTABLE_CONTENT'
  | 'XLSX_CLEAN_EXPORT_EXTERNAL_DATA_CONNECTION_CONTENT'
  | 'XLSX_CLEAN_EXPORT_EXTERNAL_RELATIONSHIP_CONTENT'
  | 'XLSX_CLEAN_EXPORT_CUSTOM_XML_METADATA_CONTENT'
  | 'XLSX_CLEAN_EXPORT_ENCRYPTED_PACKAGE_MARKER'
  | 'XLSX_CLEAN_EXPORT_DIGITAL_SIGNATURE_MARKER'
  | 'XLSX_CLEAN_EXPORT_DANGLING_PACKAGE_REFERENCE';

export type XlsxCleanExportPackageDiagnosticCategory =
  | 'macrosVba'
  | 'activeX'
  | 'oleOrEmbeddedExecutable'
  | 'externalDataConnection'
  | 'externalRelationship'
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

export interface XlsxCleanExportPackageInventoryXmlPart {
  readonly path: string;
  readonly xml: string;
}

export function scanXlsxCleanExportPackageInventoryDiagnostics(
  packagePartPaths: readonly string[],
  inventoryXmlParts: readonly XlsxCleanExportPackageInventoryXmlPart[],
): readonly XlsxCleanExportPackageDiagnostic[] {
  const counts = new Map<XlsxCleanExportPackageDiagnosticCode, number>();
  const normalizedNames = packagePartPaths.map((path) => normalizePackagePath(path));
  const normalizedNameSet = new Set(normalizedNames);

  for (const name of normalizedNames) {
    scanPackagePartPath(name, counts);
  }

  for (const part of inventoryXmlParts) {
    const path = normalizePackagePath(part.path);
    if (path === '[Content_Types].xml') {
      scanContentTypesXml(part.xml, normalizedNameSet, counts);
    } else if (path.endsWith('.rels')) {
      scanRelationshipsXml(path, part.xml, normalizedNameSet, counts);
    }
  }

  return diagnosticsFromCounts(counts);
}

export function isPackageInventoryXmlPath(path: string): boolean {
  return path === '[Content_Types].xml' || path.endsWith('.rels');
}

export function normalizePackagePath(value: string): string {
  return normalizePackageSegments(value.replace(/\\/g, '/').replace(/^\/+/, ''));
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
    code: 'XLSX_CLEAN_EXPORT_EXTERNAL_RELATIONSHIP_CONTENT',
    category: 'externalRelationship',
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
  if (isMacroAdjacentActiveContentPath(normalized)) {
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
    if (isExternalRelationship(target, targetMode)) {
      addCleanExportDiagnostic(counts, 'XLSX_CLEAN_EXPORT_EXTERNAL_RELATIONSHIP_CONTENT');
    }
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
    normalized.includes('attachedtoolbars') ||
    normalized.includes('macrosheet') ||
    normalized.includes('dialogsheet') ||
    normalized.includes('customui') ||
    normalized.includes('webextension') ||
    normalized.includes('office.addin')
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
  if (
    normalized.includes('digital-signature') ||
    normalized.includes('xmlsignature') ||
    normalized.includes('vbaprojectsignature')
  ) {
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
    normalizedType.includes('/attachedtoolbars') ||
    normalizedType.includes('/xlmacrosheet') ||
    normalizedType.endsWith('/macrosheet') ||
    normalizedType.endsWith('/dialogsheet') ||
    normalizedType.includes('/ui/extensibility') ||
    normalizedType.includes('/office.addin') ||
    normalizedType.includes('/webextension') ||
    isMacroAdjacentActiveContentPath(normalizedTarget)
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
    normalizedType.includes('/oleobjects') ||
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
    normalizedType.includes('/vbaprojectsignature') ||
    normalizedTarget.includes('vbaprojectsignature') ||
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

function isMacroAdjacentActiveContentPath(path: string): boolean {
  return (
    path.startsWith('xl/macrosheets/') ||
    path.startsWith('xl/dialogsheets/') ||
    path.startsWith('customui/') ||
    path.startsWith('customui14/') ||
    path.includes('/customui/') ||
    path.includes('/customui14/') ||
    path.startsWith('xl/webextensions/') ||
    path.includes('/webextensions/') ||
    path.startsWith('xl/webextension/') ||
    path.includes('/webextension/') ||
    path.startsWith('xl/addins/') ||
    path.includes('/addins/')
  );
}

function isActiveXPath(path: string): boolean {
  return path.includes('/activex/') || path.includes('/ctrlprops/') || path.includes('activex');
}

function isOleOrEmbeddedExecutablePath(path: string): boolean {
  return (
    path.includes('/embeddings/') ||
    path.includes('/oleobjects/') ||
    path.includes('/oleobject') ||
    hasUnsafeExecutablePackageExtension(path)
  );
}

function isEncryptedPackagePath(path: string): boolean {
  return (
    path === 'encryptedpackage' || path === 'encryptioninfo' || path.endsWith('/encryptedpackage')
  );
}

function isDigitalSignaturePath(path: string): boolean {
  return (
    path.startsWith('_xmlsignatures/') ||
    path.includes('/_xmlsignatures/') ||
    path.includes('vbaprojectsignature')
  );
}

function isExternalDataConnectionPath(path: string): boolean {
  return (
    path === 'xl/connections.xml' ||
    (path.startsWith('xl/querytables/') && path.endsWith('.xml')) ||
    path.startsWith('xl/externallinks/')
  );
}

function isCustomXmlMetadataPath(path: string): boolean {
  return path.startsWith('customxml/') || path.includes('/customxml/') || path === 'xl/xmlmaps.xml';
}

function isExternalRelationship(target: string, targetMode: string): boolean {
  const normalizedTarget = stripRelationshipTargetSuffixes(target).replace(/\\/g, '/');
  return (
    targetMode.toLowerCase() === 'external' ||
    /^[a-z][a-z0-9+.-]*:/i.test(normalizedTarget) ||
    normalizedTarget.startsWith('//')
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
