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
