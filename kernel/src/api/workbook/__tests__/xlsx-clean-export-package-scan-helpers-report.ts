import {
  scanXlsxCleanExportPackageDiagnostics,
  type XlsxCleanExportPackageDiagnostic,
} from '../xlsx-clean-export-package';
import { MOG_VERSION_METADATA_PART } from '../version/xlsx-metadata/xlsx-version-metadata';
import {
  decodeUtf8,
  readZipArchive,
  type ZipEntry,
} from './xlsx-clean-export-package-zip-test-utils';

export interface CleanExportPackageScanReport {
  readonly duplicateZipEntries: readonly string[];
  readonly mogCustomXmlMetadataParts: readonly string[];
  readonly mogContentTypeEntries: readonly string[];
  readonly mogRelationshipEntries: readonly string[];
  readonly danglingCustomXmlInventory: readonly string[];
  readonly unsafePackageDiagnostics: readonly XlsxCleanExportPackageDiagnostic[];
  readonly redactionLeaks: readonly RedactionLeakDiagnostic[];
}

export async function scanCleanExportPackage(
  xlsxBytes: Uint8Array,
  leakTokens: readonly string[],
): Promise<CleanExportPackageScanReport> {
  const entries = readZipArchive(xlsxBytes);
  const normalizedNames = entries.map((entry) => normalizePackagePath(entry.name));
  const textByPath = new Map(
    entries.map((entry) => [normalizePackagePath(entry.name), decodeUtf8(entry.data)]),
  );
  const contentTypesXml = textByPath.get('[Content_Types].xml') ?? '';
  const contentTypeEntries = extractXmlTags(contentTypesXml, 'Override').filter((tag) =>
    hasMogCustomXmlMarker(tag),
  );
  const relationshipEntries = entries.flatMap((entry) => {
    const path = normalizePackagePath(entry.name);
    if (!path.endsWith('.rels')) return [];
    return extractXmlTags(decodeUtf8(entry.data), 'Relationship')
      .filter((tag) => hasMogCustomXmlMarker(tag))
      .map((tag) => `${path}: ${tag}`);
  });
  const customXmlInventory = [
    ...normalizedNames.filter(
      (name) => name.startsWith('customXml/') || name.includes('/customXml/'),
    ),
    ...contentTypeEntries.map((entry) => `[Content_Types].xml: ${entry}`),
    ...relationshipEntries,
  ];

  return {
    duplicateZipEntries: duplicateValues(normalizedNames),
    mogCustomXmlMetadataParts: normalizedNames.filter(isMogVersionMetadataPath),
    mogContentTypeEntries: contentTypeEntries,
    mogRelationshipEntries: relationshipEntries,
    danglingCustomXmlInventory: customXmlInventory,
    unsafePackageDiagnostics: await scanXlsxCleanExportPackageDiagnostics(xlsxBytes),
    redactionLeaks: redactionLeaks(entries, leakTokens),
  };
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function extractXmlTags(xml: string, tagName: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${tagName}\\b[^>]*>`, 'g'))].map(
    (match) => match[0] ?? '',
  );
}

function hasMogCustomXmlMarker(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('customxml/mog-version-metadata') ||
    normalized.includes('mog-version-metadata') ||
    normalized.includes('mogversionmetadata') ||
    normalized.includes('schemas.mog.dev/workbook/version-metadata') ||
    normalized.includes('schemas.mog.dev/officedocument/relationships/mogversionmetadata') ||
    normalized.includes('mog.workbookversion.xlsxmetadata')
  );
}

function isMogVersionMetadataPath(path: string): boolean {
  return normalizePackagePath(path) === MOG_VERSION_METADATA_PART;
}

export interface RedactionLeakDiagnostic {
  readonly code: 'VC10_CLEAN_EXPORT_REDACTION_TOKEN_LEAK';
  readonly tokenIndex: number;
  readonly location: 'entryName' | 'entryData';
  readonly count: number;
}

function redactionLeaks(
  entries: readonly ZipEntry[],
  leakTokens: readonly string[],
): RedactionLeakDiagnostic[] {
  const leakCounts = new Map<string, RedactionLeakDiagnostic>();
  leakTokens.forEach((token, tokenIndex) => {
    for (const entry of entries) {
      const name = normalizePackagePath(entry.name);
      if (name.includes(token)) recordRedactionLeak(leakCounts, tokenIndex, 'entryName');
      if (decodeUtf8(entry.data).includes(token))
        recordRedactionLeak(leakCounts, tokenIndex, 'entryData');
    }
  });
  return [...leakCounts.values()].sort(
    (left, right) =>
      left.tokenIndex - right.tokenIndex || left.location.localeCompare(right.location),
  );
}

function recordRedactionLeak(
  leakCounts: Map<string, RedactionLeakDiagnostic>,
  tokenIndex: number,
  location: RedactionLeakDiagnostic['location'],
): void {
  const key = `${tokenIndex}:${location}`;
  const existing = leakCounts.get(key);
  leakCounts.set(key, {
    code: 'VC10_CLEAN_EXPORT_REDACTION_TOKEN_LEAK',
    tokenIndex,
    location,
    count: (existing?.count ?? 0) + 1,
  });
}

function normalizePackagePath(value: string): string {
  return value.replace(/^\/+/, '');
}
