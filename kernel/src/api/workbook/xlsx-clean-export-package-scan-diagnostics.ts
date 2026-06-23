import type {
  XlsxCleanExportPackageDiagnostic,
  XlsxCleanExportPackageDiagnosticCode,
} from './xlsx-clean-export-package-scan-types';

export type XlsxCleanExportPackageDiagnosticCounts = Map<
  XlsxCleanExportPackageDiagnosticCode,
  number
>;

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

export function diagnosticsFromCounts(
  counts: ReadonlyMap<XlsxCleanExportPackageDiagnosticCode, number>,
): readonly XlsxCleanExportPackageDiagnostic[] {
  return CLEAN_EXPORT_DIAGNOSTIC_DEFINITIONS.flatMap((definition) => {
    const count = counts.get(definition.code) ?? 0;
    return count > 0 ? [{ ...definition, count }] : [];
  });
}

export function addCleanExportDiagnostic(
  counts: XlsxCleanExportPackageDiagnosticCounts,
  code: XlsxCleanExportPackageDiagnosticCode,
): void {
  counts.set(code, (counts.get(code) ?? 0) + 1);
}
