import {
  addCleanExportDiagnostic,
  type XlsxCleanExportPackageDiagnosticCounts,
} from './xlsx-clean-export-package-scan-diagnostics';

export function normalizePackagePath(value: string): string {
  return normalizePackageSegments(value.replace(/\\/g, '/').replace(/^\/+/, ''));
}

export function scanPackagePartPath(
  path: string,
  counts: XlsxCleanExportPackageDiagnosticCounts,
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

export function isMacroAdjacentActiveContentPath(path: string): boolean {
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

export function isActiveXPath(path: string): boolean {
  return path.includes('/activex/') || path.includes('/ctrlprops/') || path.includes('activex');
}

export function hasUnsafeExecutablePackageExtension(path: string): boolean {
  const normalized = stripRelationshipTargetSuffixes(path).toLowerCase();
  return UNSAFE_EMBEDDED_PACKAGE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

export function stripRelationshipTargetSuffixes(target: string): string {
  return target.split(/[?#]/, 1)[0] ?? '';
}

export function normalizePackageSegments(path: string): string {
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
