import type {
  VersionDiagnosticPublicPayload,
  VersionHead,
  VersionResult,
  WorkbookVersion,
  WorkbookXlsxExportOptions,
} from '@mog-sdk/contracts/api';
import type { DocumentContext } from '../../context';

const MOG_VERSION_METADATA_PART = 'customXml/mog-version-metadata.xml';

export interface MogWorkbookVersionXlsxMetadata {
  readonly schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1';
  readonly exportedAt: string;
  readonly documentId: string;
  readonly head: {
    readonly commitId: VersionHead['id'];
    readonly refName?: VersionHead['refName'];
    readonly resolvedFrom?: VersionHead['resolvedFrom'];
    readonly refRevision?: VersionHead['refRevision'];
  } | null;
  readonly diagnostics: readonly VersionDiagnosticPublicPayload[];
  readonly redaction: {
    readonly policy: 'commit-and-document-only';
    readonly omitted: readonly string[];
  };
}

interface CentralDirectoryEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export function createMogWorkbookVersionXlsxMetadata(
  ctx: DocumentContext,
  head: VersionResult<VersionHead>,
): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: new Date(ctx.clock.dateNow()).toISOString(),
    documentId: resolveVersionDocumentId(ctx),
    head: head.ok
      ? {
          commitId: head.value.id,
          ...(head.value.refName ? { refName: head.value.refName } : {}),
          ...(head.value.resolvedFrom ? { resolvedFrom: head.value.resolvedFrom } : {}),
          ...(head.value.refRevision ? { refRevision: head.value.refRevision } : {}),
        }
      : null,
    diagnostics: head.ok ? [] : diagnosticsFromVersionError(head.error),
    redaction: {
      policy: 'commit-and-document-only',
      omitted: ['authors', 'agentTraces', 'rawWorkbookBytes', 'credentials', 'externalDataSecrets'],
    },
  };
}

export function addMogVersionMetadataToXlsx(
  xlsxBytes: Uint8Array,
  metadata: MogWorkbookVersionXlsxMetadata,
): Uint8Array {
  const view = new DataView(xlsxBytes.buffer, xlsxBytes.byteOffset, xlsxBytes.byteLength);
  const eocd = readEndOfCentralDirectory(view);
  const existingCentralDirectory = readCentralDirectoryEntries(xlsxBytes, view, eocd).filter(
    (entry) => normalizePackagePath(entry.name) !== MOG_VERSION_METADATA_PART,
  );

  const prefix = xlsxBytes.subarray(0, eocd.centralDirectoryOffset);
  const metadataBytes = encodeUtf8(versionMetadataXml(metadata));
  const metadataNameBytes = encodeUtf8(MOG_VERSION_METADATA_PART);
  const metadataCrc = crc32(metadataBytes);
  const metadataLocalHeaderOffset = prefix.byteLength;
  const metadataLocalFile = concatUint8Arrays([
    localFileHeader(metadataNameBytes, metadataBytes, metadataCrc),
    metadataBytes,
  ]);
  const metadataCentralEntry = centralDirectoryHeader(
    metadataNameBytes,
    metadataBytes,
    metadataCrc,
    metadataLocalHeaderOffset,
  );
  const centralDirectory = [
    ...existingCentralDirectory.map((entry) => entry.bytes),
    metadataCentralEntry,
  ];
  const centralDirectoryOffset = prefix.byteLength + metadataLocalFile.byteLength;
  const centralDirectorySize = byteLength(centralDirectory);
  return concatUint8Arrays([
    prefix,
    metadataLocalFile,
    ...centralDirectory,
    endOfCentralDirectory(
      existingCentralDirectory.length + 1,
      centralDirectorySize,
      centralDirectoryOffset,
      eocd.comment,
    ),
  ]);
}

export async function maybeAddMogVersionMetadataToXlsx(
  ctx: DocumentContext,
  version: Pick<WorkbookVersion, 'getHead'>,
  xlsxBytes: Uint8Array,
  options: WorkbookXlsxExportOptions | undefined,
): Promise<Uint8Array> {
  if (options?.versionMetadata !== 'include') return xlsxBytes;
  return addMogVersionMetadataToXlsx(
    xlsxBytes,
    createMogWorkbookVersionXlsxMetadata(ctx, await version.getHead()),
  );
}

function resolveVersionDocumentId(ctx: DocumentContext): string {
  const runtime = ctx as {
    readonly versioning?: unknown;
    readonly versionStore?: unknown;
    readonly version?: unknown;
  };
  for (const services of [runtime.versioning, runtime.versionStore, runtime.version]) {
    if (!isRecord(services)) continue;
    const provider = services.provider;
    if (isRecord(provider)) {
      const scope = provider.documentScope;
      if (isRecord(scope) && typeof scope.documentId === 'string') return scope.documentId;
    }
  }
  return ctx.workbookLinkScope().requestingDocumentId;
}

function diagnosticsFromVersionError(
  error: Extract<VersionResult<VersionHead>, { readonly ok: false }>['error'],
): readonly VersionDiagnosticPublicPayload[] {
  return 'diagnostics' in error && Array.isArray(error.diagnostics)
    ? error.diagnostics.map(diagnosticPublicPayload)
    : [];
}

function diagnosticPublicPayload(value: unknown): VersionDiagnosticPublicPayload {
  if (!isRecord(value)) return {};
  const payload: Record<string, string | number | boolean | null> = {};
  for (const key of ['code', 'severity', 'message', 'dependency']) {
    const field = value[key];
    if (isPublicPrimitive(field)) payload[key] = field;
  }
  return payload;
}

function versionMetadataXml(metadata: MogWorkbookVersionXlsxMetadata): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<mogVersionMetadata xmlns="https://schemas.mog.dev/workbook/version-metadata/1">',
    `<json>${escapeXml(JSON.stringify(metadata))}</json>`,
    '</mogVersionMetadata>',
  ].join('');
}

function readCentralDirectoryEntries(
  bytes: Uint8Array,
  view: DataView,
  eocd: ReturnType<typeof readEndOfCentralDirectory>,
): CentralDirectoryEntry[] {
  const entries: CentralDirectoryEntry[] = [];
  let offset = eocd.centralDirectoryOffset;
  const end = eocd.centralDirectoryOffset + eocd.centralDirectorySize;
  while (offset < end) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`invalid ZIP central directory header at ${offset}`);
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nextOffset = nameStart + nameLength + extraLength + commentLength;
    const name = decodeUtf8(bytes.subarray(nameStart, nameStart + nameLength));
    entries.push({ name, bytes: bytes.subarray(offset, nextOffset) });
    offset = nextOffset;
  }
  if (entries.length !== eocd.entryCount) {
    throw new Error(`ZIP central directory entry count mismatch: ${entries.length}`);
  }
  return entries;
}

function readEndOfCentralDirectory(view: DataView): {
  readonly entryCount: number;
  readonly centralDirectorySize: number;
  readonly centralDirectoryOffset: number;
  readonly comment: Uint8Array;
} {
  const offset = findEndOfCentralDirectory(view);
  const commentLength = view.getUint16(offset + 20, true);
  return {
    entryCount: view.getUint16(offset + 10, true),
    centralDirectorySize: view.getUint32(offset + 12, true),
    centralDirectoryOffset: view.getUint32(offset + 16, true),
    comment: new Uint8Array(view.buffer, view.byteOffset + offset + 22, commentLength),
  };
}

function localFileHeader(nameBytes: Uint8Array, data: Uint8Array, crc: number): Uint8Array {
  const header = new Uint8Array(30 + nameBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.byteLength, true);
  view.setUint32(22, data.byteLength, true);
  view.setUint16(26, nameBytes.byteLength, true);
  header.set(nameBytes, 30);
  return header;
}

function centralDirectoryHeader(
  nameBytes: Uint8Array,
  data: Uint8Array,
  crc: number,
  localHeaderOffset: number,
): Uint8Array {
  const header = new Uint8Array(46 + nameBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, data.byteLength, true);
  view.setUint32(24, data.byteLength, true);
  view.setUint16(28, nameBytes.byteLength, true);
  view.setUint32(42, localHeaderOffset, true);
  header.set(nameBytes, 46);
  return header;
}

function endOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
  comment: Uint8Array,
): Uint8Array {
  const record = new Uint8Array(22 + comment.byteLength);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, comment.byteLength, true);
  record.set(comment, 22);
  return record;
}

function findEndOfCentralDirectory(view: DataView): number {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('missing ZIP end of central directory');
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = new Uint32Array(
  Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  }),
);

function byteLength(parts: readonly Uint8Array[]): number {
  return parts.reduce((sum, part) => sum + part.byteLength, 0);
}

function concatUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(byteLength(parts));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function normalizePackagePath(value: string): string {
  return value.replace(/^\/+/, '');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPublicPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}
