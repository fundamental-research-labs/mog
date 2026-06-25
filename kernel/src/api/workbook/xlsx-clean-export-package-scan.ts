import {
  diagnosticsFromCounts,
  type XlsxCleanExportPackageDiagnosticCounts,
} from './xlsx-clean-export-package-scan-diagnostics';
import {
  isPackageInventoryXmlPath,
  scanContentTypesXml,
  scanRelationshipsXml,
} from './xlsx-clean-export-package-scan-inventory-xml';
import { normalizePackagePath, scanPackagePartPath } from './xlsx-clean-export-package-scan-paths';
import type {
  XlsxCleanExportPackageDiagnostic,
  XlsxCleanExportPackageInventoryXmlPart,
} from './xlsx-clean-export-package-scan-types';

export { isPackageInventoryXmlPath } from './xlsx-clean-export-package-scan-inventory-xml';
export { normalizePackagePath } from './xlsx-clean-export-package-scan-paths';
export type {
  XlsxCleanExportPackageDiagnostic,
  XlsxCleanExportPackageDiagnosticCategory,
  XlsxCleanExportPackageDiagnosticCode,
  XlsxCleanExportPackageInventoryXmlPart,
} from './xlsx-clean-export-package-scan-types';

export function scanXlsxCleanExportPackageInventoryDiagnostics(
  packagePartPaths: readonly string[],
  inventoryXmlParts: readonly XlsxCleanExportPackageInventoryXmlPart[],
): readonly XlsxCleanExportPackageDiagnostic[] {
  const counts: XlsxCleanExportPackageDiagnosticCounts = new Map();
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
