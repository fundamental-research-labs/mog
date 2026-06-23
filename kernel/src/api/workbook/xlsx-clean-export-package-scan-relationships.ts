import {
  addCleanExportDiagnostic,
  type XlsxCleanExportPackageDiagnosticCounts,
} from './xlsx-clean-export-package-scan-diagnostics';
import {
  hasUnsafeExecutablePackageExtension,
  isActiveXPath,
  isMacroAdjacentActiveContentPath,
  normalizePackagePath,
  normalizePackageSegments,
  stripRelationshipTargetSuffixes,
} from './xlsx-clean-export-package-scan-paths';

export function scanRelationshipTypeAndTarget(
  type: string,
  target: string,
  counts: XlsxCleanExportPackageDiagnosticCounts,
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

export function isExternalRelationship(target: string, targetMode: string): boolean {
  const normalizedTarget = stripRelationshipTargetSuffixes(target).replace(/\\/g, '/');
  return (
    targetMode.toLowerCase() === 'external' ||
    /^[a-z][a-z0-9+.-]*:/i.test(normalizedTarget) ||
    normalizedTarget.startsWith('//')
  );
}

export function resolveRelationshipTargetPath(relsPath: string, target: string): string | null {
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
