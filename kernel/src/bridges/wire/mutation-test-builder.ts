/**
 * mutation-test-builder.ts — Constructs binary mutation buffers in pure
 * TypeScript for testing.
 *
 * Usage:
 *   const buf = buildTestMutationBuffer({ patches: [{ row: 0, col: 0, display: 'Hello' }] });
 *   const reader = new BinaryMutationReader(buf);
 */

import { MUTATION_HEADER_SIZE, NO_STRING, PATCH_STRIDE } from './constants.gen';
import { encodePaletteBinary } from './palette-binary';

// Module-level singleton TextEncoder
const sharedEncoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface TestMutationPatch {
  row: number;
  col: number;
  numberValue?: number;
  display?: string;
  error?: string;
  flags?: number;
  formatIdx?: number;
  bgColorOverride?: number;
  fontColorOverride?: number;
}

export interface TestMutationPalette {
  /** Starting index in the global palette for these new entries. */
  startIndex: number;
  /** New CellFormat entries to append. */
  formats: import('@mog-sdk/contracts/core').CellFormat[];
}

export interface TestMutationOptions {
  sheetId?: string;
  patches?: TestMutationPatch[];
  spillPatches?: TestMutationPatch[];
  generation?: number;
  hasErrors?: boolean;
  /** Format palette delta — new palette entries from this mutation. */
  palette?: TestMutationPalette;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ResolvedStringInfo {
  displayOff: number;
  displayLen: number;
  errorOff: number;
  errorLen: number;
}

/**
 * Collect string pool entries from a list of patches and return per-patch
 * offset/length info. Appends encoded parts to `poolParts` and advances
 * `poolSize` in place via the returned new size.
 */
function collectStrings(
  patches: TestMutationPatch[],
  poolParts: Uint8Array[],
  poolSize: number,
): { infos: ResolvedStringInfo[]; poolSize: number } {
  const infos: ResolvedStringInfo[] = new Array(patches.length);

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    let displayOff = NO_STRING;
    let displayLen = 0;
    let errorOff = NO_STRING;
    let errorLen = 0;

    if (patch.display !== undefined && patch.display !== null) {
      const encoded = sharedEncoder.encode(patch.display);
      displayOff = poolSize;
      displayLen = encoded.byteLength;
      poolParts.push(encoded);
      poolSize += encoded.byteLength;
    }

    if (patch.error !== undefined && patch.error !== null) {
      const encoded = sharedEncoder.encode(patch.error);
      errorOff = poolSize;
      errorLen = encoded.byteLength;
      poolParts.push(encoded);
      poolSize += encoded.byteLength;
    }

    infos[i] = { displayOff, displayLen, errorOff, errorLen };
  }

  return { infos, poolSize };
}

/**
 * Write an array of patches into the buffer at the given byte offset.
 * Returns the byte offset immediately after the last patch written.
 */
function writePatches(
  view: DataView,
  offset: number,
  patches: TestMutationPatch[],
  stringInfos: ResolvedStringInfo[],
): number {
  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const info = stringInfos[i];

    // row + col (8 bytes)
    view.setUint32(offset + 0, patch.row, true);
    view.setUint32(offset + 4, patch.col, true);

    // 32-byte cell record (offset + 8)
    const rec = offset + 8;
    view.setFloat64(rec + 0, patch.numberValue ?? NaN, true);
    view.setUint32(rec + 8, info.displayOff, true);
    view.setUint32(rec + 12, info.errorOff, true);
    view.setUint16(rec + 16, patch.flags ?? 0, true);
    view.setUint16(rec + 18, patch.formatIdx ?? 0, true);
    view.setUint16(rec + 20, info.displayLen, true);
    view.setUint16(rec + 22, info.errorLen, true);
    view.setUint32(rec + 24, patch.bgColorOverride ?? 0, true); // bg_color_override
    view.setUint32(rec + 28, patch.fontColorOverride ?? 0, true); // font_color_override

    offset += PATCH_STRIDE;
  }

  return offset;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a binary mutation buffer following the exact protocol specification.
 *
 * Sections in order:
 *   1. Header (16 bytes)
 *   2. Sheet ID (UTF-8 bytes)
 *   3. Cell patches (patch_count × 40 bytes)
 *   4. String pool (packed UTF-8, shared by regular and spill patches)
 *   5. Spill section (optional: u32 count + spill_count × 40 bytes)
 */
export function buildTestMutationBuffer(options: TestMutationOptions): Uint8Array {
  const {
    sheetId = 'sheet-1',
    patches = [],
    spillPatches = [],
    generation = 0,
    hasErrors = false,
    palette,
  } = options;

  // -----------------------------------------------------------------------
  // Build the shared string pool from ALL patches (regular + spill)
  // -----------------------------------------------------------------------

  const stringPoolParts: Uint8Array[] = [];
  let stringPoolSize = 0;

  const regularResult = collectStrings(patches, stringPoolParts, stringPoolSize);
  const regularInfos = regularResult.infos;
  stringPoolSize = regularResult.poolSize;

  const spillResult = collectStrings(spillPatches, stringPoolParts, stringPoolSize);
  const spillInfos = spillResult.infos;
  stringPoolSize = spillResult.poolSize;

  // -----------------------------------------------------------------------
  // Encode sheet ID
  // -----------------------------------------------------------------------

  const sheetIdBytes = sharedEncoder.encode(sheetId);

  // -----------------------------------------------------------------------
  // Encode palette delta (if present)
  // Layout: [u16 start_index] [u32 palette_len] [palette binary bytes]
  // -----------------------------------------------------------------------

  let paletteBytes: Uint8Array | null = null;
  if (palette && palette.formats.length > 0) {
    const paletteBin = encodePaletteBinary(palette.startIndex, palette.formats);
    paletteBytes = new Uint8Array(2 + 4 + paletteBin.byteLength);
    const pv = new DataView(paletteBytes.buffer, paletteBytes.byteOffset, paletteBytes.byteLength);
    pv.setUint16(0, palette.startIndex, true);
    pv.setUint32(2, paletteBin.byteLength, true);
    paletteBytes.set(paletteBin, 6);
  }

  // -----------------------------------------------------------------------
  // Compute total buffer size and allocate
  // -----------------------------------------------------------------------

  const patchesSize = patches.length * PATCH_STRIDE;
  const spillSectionSize = spillPatches.length > 0 ? 4 + spillPatches.length * PATCH_STRIDE : 0;
  const paletteSectionSize = paletteBytes ? paletteBytes.byteLength : 0;

  const totalSize =
    MUTATION_HEADER_SIZE +
    sheetIdBytes.byteLength +
    patchesSize +
    stringPoolSize +
    spillSectionSize +
    paletteSectionSize;

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // -----------------------------------------------------------------------
  // Write header (16 bytes)
  // -----------------------------------------------------------------------

  let flags = 0;
  if (spillPatches.length > 0) flags |= 0x01; // bit 0: has_projection_changes
  if (hasErrors) flags |= 0x02; // bit 1: has_errors
  if (paletteBytes) flags |= 0x04; // bit 2: has_palette

  view.setUint32(0, patches.length, true); // patch_count
  view.setUint32(4, stringPoolSize, true); // string_bytes
  view.setUint16(8, sheetIdBytes.byteLength, true); // sheet_id_len
  view.setUint8(10, flags); // flags
  view.setUint8(11, generation); // generation
  view.setUint32(12, 0, true); // reserved

  // -----------------------------------------------------------------------
  // Write sheet ID
  // -----------------------------------------------------------------------

  buffer.set(sheetIdBytes, MUTATION_HEADER_SIZE);

  // -----------------------------------------------------------------------
  // Write cell patches (40 bytes each)
  // -----------------------------------------------------------------------

  const patchesStart = MUTATION_HEADER_SIZE + sheetIdBytes.byteLength;
  writePatches(view, patchesStart, patches, regularInfos);

  // -----------------------------------------------------------------------
  // Write string pool
  // -----------------------------------------------------------------------

  let poolOffset = patchesStart + patchesSize;
  for (const part of stringPoolParts) {
    buffer.set(part, poolOffset);
    poolOffset += part.byteLength;
  }

  // -----------------------------------------------------------------------
  // Write spill section (if present)
  // -----------------------------------------------------------------------

  if (spillPatches.length > 0) {
    const spillStart = poolOffset;
    view.setUint32(spillStart, spillPatches.length, true);
    writePatches(view, spillStart + 4, spillPatches, spillInfos);
    poolOffset += spillSectionSize;
  }

  // -----------------------------------------------------------------------
  // Write palette delta section (if present)
  // -----------------------------------------------------------------------

  if (paletteBytes) {
    buffer.set(paletteBytes, poolOffset);
  }

  return buffer;
}

// ---------------------------------------------------------------------------
// Multi-viewport packer
// ---------------------------------------------------------------------------

/**
 * Build a packed multi-viewport mutation buffer.
 *
 * Layout:
 *   [u16 viewport_count]
 *   For each viewport:
 *     [u8 id_len] [id_bytes UTF-8] [u32 patch_len] [patch_bytes...]
 */
export function buildPackedMultiViewportPatches(
  entries: { viewportId: string; mutationBuffer: Uint8Array }[],
): Uint8Array {
  // Pre-encode viewport IDs and compute total size
  const encoded: { idBytes: Uint8Array; buf: Uint8Array }[] = [];
  let totalSize = 2; // u16 viewport_count

  for (const entry of entries) {
    const idBytes = sharedEncoder.encode(entry.viewportId);
    encoded.push({ idBytes, buf: entry.mutationBuffer });
    totalSize += 1 + idBytes.byteLength + 4 + entry.mutationBuffer.byteLength;
  }

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let offset = 0;

  // Viewport count
  view.setUint16(offset, entries.length, true);
  offset += 2;

  // Each viewport entry
  for (const { idBytes, buf } of encoded) {
    view.setUint8(offset, idBytes.byteLength);
    offset += 1;

    buffer.set(idBytes, offset);
    offset += idBytes.byteLength;

    view.setUint32(offset, buf.byteLength, true);
    offset += 4;

    buffer.set(buf, offset);
    offset += buf.byteLength;
  }

  return buffer;
}
