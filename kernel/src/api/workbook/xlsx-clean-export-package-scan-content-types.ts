import {
  addCleanExportDiagnostic,
  type XlsxCleanExportPackageDiagnosticCounts,
} from './xlsx-clean-export-package-scan-diagnostics';

export function scanContentType(
  value: string | undefined,
  counts: XlsxCleanExportPackageDiagnosticCounts,
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
