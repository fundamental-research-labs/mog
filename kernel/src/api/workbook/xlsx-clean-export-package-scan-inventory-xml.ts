import { scanContentType } from './xlsx-clean-export-package-scan-content-types';
import {
  addCleanExportDiagnostic,
  type XlsxCleanExportPackageDiagnosticCounts,
} from './xlsx-clean-export-package-scan-diagnostics';
import { normalizePackagePath, scanPackagePartPath } from './xlsx-clean-export-package-scan-paths';
import {
  isExternalRelationship,
  resolveRelationshipTargetPath,
  scanRelationshipTypeAndTarget,
} from './xlsx-clean-export-package-scan-relationships';
import { extractXmlTags, xmlAttribute } from './xlsx-clean-export-package-scan-xml';

export function isPackageInventoryXmlPath(path: string): boolean {
  return path === '[Content_Types].xml' || path.endsWith('.rels');
}

export function scanContentTypesXml(
  xml: string,
  normalizedNameSet: ReadonlySet<string>,
  counts: XlsxCleanExportPackageDiagnosticCounts,
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

export function scanRelationshipsXml(
  relsPath: string,
  xml: string,
  normalizedNameSet: ReadonlySet<string>,
  counts: XlsxCleanExportPackageDiagnosticCounts,
): void {
  for (const tag of extractXmlTags(xml, 'Relationship')) {
    const type = xmlAttribute(tag, 'Type') ?? '';
    const target = xmlAttribute(tag, 'Target') ?? '';
    const targetMode = xmlAttribute(tag, 'TargetMode') ?? '';
    if (isExternalRelationship(target, targetMode) && !isHyperlinkRelationshipType(type)) {
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

function isHyperlinkRelationshipType(type: string): boolean {
  return type.toLowerCase().endsWith('/hyperlink');
}
