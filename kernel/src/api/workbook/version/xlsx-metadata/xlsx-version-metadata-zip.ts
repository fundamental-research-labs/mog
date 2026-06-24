import {
  MOG_VERSION_METADATA_PART,
  type MogWorkbookVersionXlsxMetadata,
} from './xlsx-version-metadata-schema';
import type { MogWorkbookVersionXlsxMetadataTrustReason } from './xlsx-version-metadata-trust';
import { versionMetadataXml } from './xlsx-version-metadata-xml';

const MOG_VERSION_METADATA_MAX_BYTES = 64 * 1024;

interface CentralDirectoryEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly localHeaderOffset: number;
  readonly generalPurposeBitFlag: number;
  readonly compressionMethod: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

export function rewriteMogVersionMetadataInXlsx(
  xlsxBytes: Uint8Array,
  metadata: MogWorkbookVersionXlsxMetadata | null,
): Uint8Array {
  const view = new DataView(xlsxBytes.buffer, xlsxBytes.byteOffset, xlsxBytes.byteLength);
  const eocd = readEndOfCentralDirectory(view);
  const existingCentralDirectory = readCentralDirectoryEntries(xlsxBytes, view, eocd);
  const keptCentralDirectory = existingCentralDirectory.filter(
    (entry) => !isMogVersionMetadataPart(entry.name),
  );
  if (keptCentralDirectory.length === existingCentralDirectory.length && metadata === null) {
    return xlsxBytes;
  }

  const localFileParts: Uint8Array[] = [];
  const localHeaderOffsets = new Map<CentralDirectoryEntry, number>();
  let localOffset = 0;
  const archivePreamble = archivePreambleBytes(xlsxBytes, existingCentralDirectory);
  if (archivePreamble.byteLength > 0) {
    localFileParts.push(archivePreamble);
    localOffset += archivePreamble.byteLength;
  }
  for (const segment of localFileSegments(xlsxBytes, view, eocd, existingCentralDirectory)) {
    if (isMogVersionMetadataPart(segment.entry.name)) continue;
    localHeaderOffsets.set(segment.entry, localOffset);
    localFileParts.push(segment.bytes);
    localOffset += segment.bytes.byteLength;
  }

  const centralDirectory = keptCentralDirectory.map((entry) => {
    const newOffset = localHeaderOffsets.get(entry);
    if (newOffset === undefined) {
      throw new Error(`missing rewritten ZIP local file offset for ${entry.name}`);
    }
    return centralDirectoryHeaderWithLocalHeaderOffset(entry.bytes, newOffset);
  });

  if (metadata !== null) {
    const metadataBytes = encodeUtf8(versionMetadataXml(metadata));
    const metadataNameBytes = encodeUtf8(MOG_VERSION_METADATA_PART);
    const metadataCrc = crc32(metadataBytes);
    const metadataLocalHeaderOffset = localOffset;
    const metadataLocalFile = concatUint8Arrays([
      localFileHeader(metadataNameBytes, metadataBytes, metadataCrc),
      metadataBytes,
    ]);
    localFileParts.push(metadataLocalFile);
    localOffset += metadataLocalFile.byteLength;
    centralDirectory.push(
      centralDirectoryHeader(
        metadataNameBytes,
        metadataBytes,
        metadataCrc,
        metadataLocalHeaderOffset,
      ),
    );
  }

  const centralDirectoryOffset = localOffset;
  const centralDirectorySize = byteLength(centralDirectory);
  return concatUint8Arrays([
    ...localFileParts,
    ...centralDirectory,
    endOfCentralDirectory(
      centralDirectory.length,
      centralDirectorySize,
      centralDirectoryOffset,
      eocd.comment,
    ),
  ]);
}

export function readMogVersionMetadataXmlFromXlsx(
  xlsxBytes: Uint8Array,
):
  | { readonly status: 'absent' }
  | { readonly status: 'present'; readonly xml: string }
  | { readonly status: 'untrusted'; readonly reason: MogWorkbookVersionXlsxMetadataTrustReason } {
  const view = new DataView(xlsxBytes.buffer, xlsxBytes.byteOffset, xlsxBytes.byteLength);
  const eocd = readEndOfCentralDirectory(view);
  const metadataEntries = readCentralDirectoryEntries(xlsxBytes, view, eocd).filter((entry) =>
    isMogVersionMetadataPart(entry.name),
  );

  if (metadataEntries.length === 0) return { status: 'absent' };
  if (metadataEntries.length !== 1) {
    return { status: 'untrusted', reason: 'duplicate-sidecar' };
  }

  const entry = metadataEntries[0];
  if (!entry) return { status: 'absent' };
  if (entry.compressedSize > MOG_VERSION_METADATA_MAX_BYTES) {
    return { status: 'untrusted', reason: 'sidecar-too-large' };
  }
  if (
    entry.compressionMethod !== 0 ||
    entry.compressedSize !== entry.uncompressedSize ||
    (entry.generalPurposeBitFlag & 0x0008) !== 0
  ) {
    return { status: 'untrusted', reason: 'unsupported-compression' };
  }

  const localHeaderOffset = entry.localHeaderOffset;
  if (
    localHeaderOffset < 0 ||
    localHeaderOffset + 30 > view.byteLength ||
    view.getUint32(localHeaderOffset, true) !== 0x04034b50
  ) {
    return { status: 'untrusted', reason: 'malformed-sidecar' };
  }

  const localGeneralPurposeBitFlag = view.getUint16(localHeaderOffset + 6, true);
  const localCompressionMethod = view.getUint16(localHeaderOffset + 8, true);
  if (
    localCompressionMethod !== entry.compressionMethod ||
    localGeneralPurposeBitFlag !== entry.generalPurposeBitFlag
  ) {
    return { status: 'untrusted', reason: 'malformed-sidecar' };
  }

  const nameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  const localNameStart = localHeaderOffset + 30;
  const localNameEnd = localNameStart + nameLength;
  const localName = decodeUtf8(xlsxBytes.subarray(localNameStart, localNameEnd));
  if (
    dataStart < localHeaderOffset ||
    dataEnd > view.byteLength ||
    dataEnd > eocd.centralDirectoryOffset ||
    normalizePackagePath(localName) !== normalizePackagePath(entry.name) ||
    view.getUint32(localHeaderOffset + 14, true) !== entry.crc32 ||
    view.getUint32(localHeaderOffset + 18, true) !== entry.compressedSize ||
    view.getUint32(localHeaderOffset + 22, true) !== entry.uncompressedSize
  ) {
    return { status: 'untrusted', reason: 'malformed-sidecar' };
  }

  return {
    status: 'present',
    xml: decodeUtf8(xlsxBytes.subarray(dataStart, dataEnd)),
  };
}

function readCentralDirectoryEntries(
  bytes: Uint8Array,
  view: DataView,
  eocd: ReturnType<typeof readEndOfCentralDirectory>,
): CentralDirectoryEntry[] {
  const entries: CentralDirectoryEntry[] = [];
  let offset = eocd.centralDirectoryOffset;
  const end = eocd.centralDirectoryOffset + eocd.centralDirectorySize;
  if (
    eocd.centralDirectoryOffset < 0 ||
    eocd.centralDirectorySize < 0 ||
    end < eocd.centralDirectoryOffset ||
    end > view.byteLength
  ) {
    throw new Error('invalid ZIP central directory bounds');
  }
  while (offset < end) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`invalid ZIP central directory header at ${offset}`);
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nextOffset = nameStart + nameLength + extraLength + commentLength;
    if (nextOffset < nameStart || nextOffset > end || nextOffset > view.byteLength) {
      throw new Error(`invalid ZIP central directory entry bounds at ${offset}`);
    }
    const name = decodeUtf8(bytes.subarray(nameStart, nameStart + nameLength));
    entries.push({
      name,
      bytes: bytes.subarray(offset, nextOffset),
      localHeaderOffset: view.getUint32(offset + 42, true),
      generalPurposeBitFlag: view.getUint16(offset + 8, true),
      compressionMethod: view.getUint16(offset + 10, true),
      crc32: view.getUint32(offset + 16, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
    });
    offset = nextOffset;
  }
  if (entries.length !== eocd.entryCount) {
    throw new Error(`ZIP central directory entry count mismatch: ${entries.length}`);
  }
  return entries;
}

function archivePreambleBytes(
  bytes: Uint8Array,
  entries: readonly CentralDirectoryEntry[],
): Uint8Array {
  if (entries.length === 0) return bytes.subarray(0, 0);
  const firstLocalHeaderOffset = Math.min(...entries.map((entry) => entry.localHeaderOffset));
  return bytes.subarray(0, firstLocalHeaderOffset);
}

function localFileSegments(
  bytes: Uint8Array,
  view: DataView,
  eocd: ReturnType<typeof readEndOfCentralDirectory>,
  entries: readonly CentralDirectoryEntry[],
): Array<{ readonly entry: CentralDirectoryEntry; readonly bytes: Uint8Array }> {
  const sortedEntries = [...entries].sort((left, right) => {
    if (left.localHeaderOffset !== right.localHeaderOffset) {
      return left.localHeaderOffset - right.localHeaderOffset;
    }
    return left.name.localeCompare(right.name);
  });
  const segments: Array<{ readonly entry: CentralDirectoryEntry; readonly bytes: Uint8Array }> = [];
  for (let index = 0; index < sortedEntries.length; index += 1) {
    const entry = sortedEntries[index];
    if (!entry) continue;
    const start = entry.localHeaderOffset;
    const nextEntry = sortedEntries[index + 1];
    const end = nextEntry ? nextEntry.localHeaderOffset : eocd.centralDirectoryOffset;
    if (start >= eocd.centralDirectoryOffset || start < 0 || end <= start) {
      throw new Error(`invalid ZIP local file offset for ${entry.name}`);
    }
    if (view.getUint32(start, true) !== 0x04034b50) {
      throw new Error(`invalid ZIP local file header for ${entry.name}`);
    }
    segments.push({ entry, bytes: bytes.subarray(start, end) });
  }
  return segments;
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

function centralDirectoryHeaderWithLocalHeaderOffset(
  entryBytes: Uint8Array,
  localHeaderOffset: number,
): Uint8Array {
  const header = new Uint8Array(entryBytes);
  new DataView(header.buffer).setUint32(42, localHeaderOffset, true);
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

function isMogVersionMetadataPart(value: string): boolean {
  return normalizePackagePath(value) === MOG_VERSION_METADATA_PART;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
