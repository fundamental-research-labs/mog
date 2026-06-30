import {
  removeCleanExportBlockedPackageInventoryFromXlsx,
  scanXlsxCleanExportPackageDiagnostics,
  type XlsxCleanExportPackageDiagnostic,
} from '../xlsx-clean-export-package';
import { scanCleanExportPackage } from './xlsx-clean-export-package-scan-helpers-report';

export async function expectUnsafePackageScanRedacts(
  xlsxBytes: Uint8Array,
  expectedCodes: readonly XlsxCleanExportPackageDiagnostic['code'][],
  redactedTokens: readonly string[],
): Promise<void> {
  const diagnostics = await scanXlsxCleanExportPackageDiagnostics(xlsxBytes);
  expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expectedCodes);
  expect(diagnostics.every((diagnostic) => diagnostic.count > 0)).toBe(true);
  expectRedactedPayload({ diagnostics }, redactedTokens);

  const cleaned = await removeCleanExportBlockedPackageInventoryFromXlsx(xlsxBytes);
  expect(await scanCleanExportPackage(cleaned, redactedTokens)).toEqual({
    duplicateZipEntries: [],
    mogCustomXmlMetadataParts: [],
    mogContentTypeEntries: [],
    mogRelationshipEntries: [],
    danglingCustomXmlInventory: [],
    unsafePackageDiagnostics: [],
    redactionLeaks: [],
  });
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
