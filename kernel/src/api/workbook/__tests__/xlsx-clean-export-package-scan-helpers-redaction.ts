import {
  removeMogVersionMetadataPackageInventoryFromXlsx,
  scanXlsxCleanExportPackageDiagnostics,
  XlsxCleanExportPackageError,
  type XlsxCleanExportPackageDiagnostic,
} from '../xlsx-clean-export-package';

export async function expectUnsafePackageScanRedacts(
  xlsxBytes: Uint8Array,
  expectedCodes: readonly XlsxCleanExportPackageDiagnostic['code'][],
  redactedTokens: readonly string[],
  expectedPostScrubCodes: readonly XlsxCleanExportPackageDiagnostic['code'][] = expectedCodes,
): Promise<void> {
  const diagnostics = await scanXlsxCleanExportPackageDiagnostics(xlsxBytes);
  expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expectedCodes);
  expect(diagnostics.every((diagnostic) => diagnostic.count > 0)).toBe(true);
  expectRedactedPayload({ diagnostics }, redactedTokens);

  let error: unknown;
  try {
    await removeMogVersionMetadataPackageInventoryFromXlsx(xlsxBytes);
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(XlsxCleanExportPackageError);
  const postScrubDiagnostics = (error as XlsxCleanExportPackageError).diagnostics;
  expect(postScrubDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(expectedPostScrubCodes);
  expect(error).toMatchObject({
    code: 'XLSX_CLEAN_EXPORT_UNSAFE_PACKAGE',
    diagnostics: postScrubDiagnostics,
  });
  expectRedactedPayload(error, redactedTokens);
}

export function redactionCheckPayload(error: unknown): string {
  return JSON.stringify({
    name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : String(error),
    diagnostics: isRecord(error) ? error.diagnostics : undefined,
  });
}

function expectRedactedPayload(value: unknown, redactedTokens: readonly string[]): void {
  const payload = redactionCheckPayload(value);
  for (const token of redactedTokens) {
    expect(payload).not.toContain(token);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
