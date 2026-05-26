/**
 * BinaryMutationReader — Zero-allocation reader for binary mutation results.
 *
 * Reads the compact binary wire format produced by Rust's `mutation_binary.rs`.
 * Used by `BinaryViewportBuffer.applyBinaryMutation()` to splice cell patches
 * directly into the viewport buffer without JSON parsing.
 *
 * Wire Layout (all little-endian):
 *   Header (16 bytes):
 *     patch_count     u32  (offset 0)   number of cell patches
 *     string_bytes    u32  (offset 4)   total bytes in patch string pool
 *     sheet_id_len    u16  (offset 8)   length of sheet_id UTF-8
 *     flags           u8   (offset 10)  bit 0: has_projection_changes, bit 1: has_errors, bit 2: has_palette
 *     generation      u8   (offset 11)  mutation generation counter
 *     reserved        u32  (offset 12)  (future use)
 *
 *   Sheet ID:       UTF-8 string (sheet_id_len bytes, starts at offset 16)
 *
 *   Cell Patches:   patch_count × 40 bytes each (starts after sheet_id)
 *     row             u32  0-3
 *     col             u32  4-7
 *     <cell record>   32B  8-39  (same layout as ViewportCellRecord)
 *
 *   String Pool:    string_bytes of UTF-8 (after cell patches)
 *
 * The 32-byte cell record layout (same as viewport):
 *     number_value    f64  offset 0
 *     display_off     u32  offset 8   (into the mutation's string pool)
 *     error_off       u32  offset 12  (0xFFFFFFFF = none)
 *     flags           u16  offset 16
 *     format_idx      u16  offset 18
 *     display_len     u16  offset 20
 *     error_len       u16  offset 22
 *     bg_color_override  u32  offset 24
 *     font_color_override u32  offset 28
 */

import type { CellFormat, FormattedText } from '@mog-sdk/contracts/core';
import { asFormattedText } from '@mog-sdk/contracts/core';
import { decodePaletteBinary } from './palette-binary';
import {
  MUT_HAS_ERRORS,
  MUT_HAS_PALETTE,
  MUT_HAS_PROJECTION_CHANGES,
  MUTATION_HEADER_SIZE,
  NO_STRING,
  OFF_DISPLAY_LEN,
  OFF_DISPLAY_OFF,
  OFF_ERROR_LEN,
  OFF_ERROR_OFF,
  PATCH_STRIDE,
} from './constants.gen';

// Module-level singleton TextDecoder — avoid per-instance allocation
const sharedDecoder = new TextDecoder('utf-8');

export class BinaryMutationReader {
  /** @internal DataView for reading typed fields */
  readonly _view: DataView;
  private _bytes: Uint8Array;
  private _patchCount: number;
  private _stringBytes: number;
  private _sheetIdLen: number;
  private _flags: number;
  private _generation: number;
  private _sheetIdStart: number;
  private _patchesStart: number;
  private _stringPoolStart: number;
  private _projSectionStart: number;
  private _projCount: number;
  private _projPatchesStart: number;
  private _paletteStartIndex: number = 0;
  private _paletteFormats: CellFormat[] = [];

  constructor(buffer: Uint8Array) {
    this._bytes = buffer;
    this._view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // Parse header (16 bytes, little-endian)
    this._patchCount = this._view.getUint32(0, true);
    this._stringBytes = this._view.getUint32(4, true);
    this._sheetIdLen = this._view.getUint16(8, true);
    this._flags = this._view.getUint8(10);
    this._generation = this._view.getUint8(11);

    // Compute section offsets
    this._sheetIdStart = MUTATION_HEADER_SIZE;
    this._patchesStart = this._sheetIdStart + this._sheetIdLen;
    this._stringPoolStart = this._patchesStart + this._patchCount * PATCH_STRIDE;

    // Spill section (after string pool, if has_projection_changes flag is set)
    this._projSectionStart = this._stringPoolStart + this._stringBytes;
    if (
      (this._flags & MUT_HAS_PROJECTION_CHANGES) !== 0 &&
      this._projSectionStart + 4 <= buffer.byteLength
    ) {
      this._projCount = this._view.getUint32(this._projSectionStart, true);
      this._projPatchesStart = this._projSectionStart + 4;
    } else {
      this._projCount = 0;
      this._projPatchesStart = this._projSectionStart;
    }

    // Palette section (after spill section, if has_palette flag bit 2 is set)
    if (this.hasPalette) {
      const paletteStart =
        this._projSectionStart +
        (this.hasProjectionChanges ? 4 + this._projCount * PATCH_STRIDE : 0);
      if (paletteStart + 6 <= buffer.byteLength) {
        this._paletteStartIndex = this._view.getUint16(paletteStart, true);
        const paletteLen = this._view.getUint32(paletteStart + 2, true);
        if (paletteStart + 6 + paletteLen <= buffer.byteLength) {
          const decoded = decodePaletteBinary(this._view, paletteStart + 6, paletteLen);
          this._paletteFormats = decoded.formats;
        }
      }
    }
  }

  /** Number of cell patches in this mutation result. */
  get patchCount(): number {
    return this._patchCount;
  }

  /** Mutation generation counter (for stale-buffer detection). */
  get generation(): number {
    return this._generation;
  }

  /** Whether this mutation produced spill changes that need separate handling. */
  get hasProjectionChanges(): boolean {
    return (this._flags & MUT_HAS_PROJECTION_CHANGES) !== 0;
  }

  /** Whether this mutation produced cell errors. */
  get hasErrors(): boolean {
    return (this._flags & MUT_HAS_ERRORS) !== 0;
  }

  /** Whether this mutation includes a format palette delta. */
  get hasPalette(): boolean {
    return (this._flags & MUT_HAS_PALETTE) !== 0;
  }

  /** The starting index in the global palette for the new formats. */
  get paletteStartIndex(): number {
    return this._paletteStartIndex;
  }

  /** The new CellFormat entries to append to the palette. */
  get paletteFormats(): CellFormat[] {
    return this._paletteFormats;
  }

  /** Decode the sheet ID from the header region. */
  sheetId(): string {
    return sharedDecoder.decode(
      this._bytes.subarray(this._sheetIdStart, this._sheetIdStart + this._sheetIdLen),
    );
  }

  /** Get the row index for the patch at position i. */
  patchRow(i: number): number {
    const off = this._patchesStart + i * PATCH_STRIDE;
    return this._view.getUint32(off, true);
  }

  /** Get the column index for the patch at position i. */
  patchCol(i: number): number {
    const off = this._patchesStart + i * PATCH_STRIDE;
    return this._view.getUint32(off + 4, true);
  }

  /**
   * Get the byte offset where the 24-byte cell record starts for patch i.
   * This is the start of the record within the overall buffer (absolute offset).
   */
  patchRecordOffset(i: number): number {
    return this._patchesStart + i * PATCH_STRIDE + 8;
  }

  /**
   * Decode display text for patch i from the mutation's string pool.
   * Returns null if no display text is present.
   */
  patchDisplayText(i: number): FormattedText | null {
    const recOff = this.patchRecordOffset(i);
    const displayOff = this._view.getUint32(recOff + OFF_DISPLAY_OFF, true);
    const displayLen = this._view.getUint16(recOff + OFF_DISPLAY_LEN, true);
    if (displayOff === NO_STRING || displayLen === 0) return null;

    const start = this._stringPoolStart + displayOff;
    return asFormattedText(sharedDecoder.decode(this._bytes.subarray(start, start + displayLen)));
  }

  /**
   * Get a zero-copy subarray view of the raw UTF-8 display bytes for patch i.
   * Returns null if no display text is present.
   * The returned Uint8Array is a VIEW into the mutation buffer — no allocation.
   */
  patchDisplayBytes(i: number): Uint8Array | null {
    const recOff = this.patchRecordOffset(i);
    const displayOff = this._view.getUint32(recOff + OFF_DISPLAY_OFF, true);
    const displayLen = this._view.getUint16(recOff + OFF_DISPLAY_LEN, true);
    if (displayOff === NO_STRING || displayLen === 0) return null;

    const start = this._stringPoolStart + displayOff;
    return this._bytes.subarray(start, start + displayLen);
  }

  /**
   * Decode error text for patch i from the mutation's string pool.
   * Returns null if no error text is present.
   */
  patchErrorText(i: number): string | null {
    const recOff = this.patchRecordOffset(i);
    const errorOff = this._view.getUint32(recOff + OFF_ERROR_OFF, true);
    const errorLen = this._view.getUint16(recOff + OFF_ERROR_LEN, true);
    if (errorOff === NO_STRING || errorLen === 0) return null;

    const start = this._stringPoolStart + errorOff;
    return sharedDecoder.decode(this._bytes.subarray(start, start + errorLen));
  }

  /**
   * Get a zero-copy subarray view of the raw UTF-8 error bytes for patch i.
   * Returns null if no error text is present.
   * The returned Uint8Array is a VIEW into the mutation buffer — no allocation.
   */
  patchErrorBytes(i: number): Uint8Array | null {
    const recOff = this.patchRecordOffset(i);
    const errorOff = this._view.getUint32(recOff + OFF_ERROR_OFF, true);
    const errorLen = this._view.getUint16(recOff + OFF_ERROR_LEN, true);
    if (errorOff === NO_STRING || errorLen === 0) return null;

    const start = this._stringPoolStart + errorOff;
    return this._bytes.subarray(start, start + errorLen);
  }

  // -------------------------------------------------------------------
  // Typed field accessors (cell record fields for patch i)
  // -------------------------------------------------------------------

  /** Read the f64 number value from the cell record of patch i. */
  patchNumberValue(i: number): number {
    return this._view.getFloat64(this.patchRecordOffset(i), true);
  }

  /** Read the u32 display string offset from the cell record of patch i. */
  patchDisplayOff(i: number): number {
    return this._view.getUint32(this.patchRecordOffset(i) + 8, true);
  }

  /** Read the u32 error string offset from the cell record of patch i. */
  patchErrorOff(i: number): number {
    return this._view.getUint32(this.patchRecordOffset(i) + 12, true);
  }

  /** Read the u16 flags from the cell record of patch i. */
  patchFlags(i: number): number {
    return this._view.getUint16(this.patchRecordOffset(i) + 16, true);
  }

  /** Read the u16 format palette index from the cell record of patch i. */
  patchFormatIdx(i: number): number {
    return this._view.getUint16(this.patchRecordOffset(i) + 18, true);
  }

  /** Read the u16 display string length from the cell record of patch i. */
  patchDisplayLen(i: number): number {
    return this._view.getUint16(this.patchRecordOffset(i) + 20, true);
  }

  /** Read the u16 error string length from the cell record of patch i. */
  patchErrorLen(i: number): number {
    return this._view.getUint16(this.patchRecordOffset(i) + 22, true);
  }

  /** Read the u32 background color override from the cell record of patch i. */
  patchBgColorOverride(i: number): number {
    return this._view.getUint32(this.patchRecordOffset(i) + 24, true);
  }

  /** Read the u32 font color override from the cell record of patch i. */
  patchFontColorOverride(i: number): number {
    return this._view.getUint32(this.patchRecordOffset(i) + 28, true);
  }

  // -------------------------------------------------------------------
  // Spill patch accessors
  // -------------------------------------------------------------------

  /** Number of spill cell patches in this mutation result. */
  get spillPatchCount(): number {
    return this._projCount;
  }

  /** Get the row index for the spill patch at position i. */
  spillPatchRow(i: number): number {
    const off = this._projPatchesStart + i * PATCH_STRIDE;
    return this._view.getUint32(off, true);
  }

  /** Get the column index for the spill patch at position i. */
  spillPatchCol(i: number): number {
    const off = this._projPatchesStart + i * PATCH_STRIDE;
    return this._view.getUint32(off + 4, true);
  }

  /**
   * Get the byte offset where the 24-byte cell record starts for spill patch i.
   * This is the start of the record within the overall buffer (absolute offset).
   */
  spillPatchRecordOffset(i: number): number {
    return this._projPatchesStart + i * PATCH_STRIDE + 8;
  }

  // -------------------------------------------------------------------
  // Spill typed field accessors (cell record fields for spill patch i)
  // -------------------------------------------------------------------

  /** Read the f64 number value from the cell record of spill patch i. */
  spillPatchNumberValue(i: number): number {
    return this._view.getFloat64(this.spillPatchRecordOffset(i), true);
  }

  /** Read the u32 display string offset from the cell record of spill patch i. */
  spillPatchDisplayOff(i: number): number {
    return this._view.getUint32(this.spillPatchRecordOffset(i) + 8, true);
  }

  /** Read the u32 error string offset from the cell record of spill patch i. */
  spillPatchErrorOff(i: number): number {
    return this._view.getUint32(this.spillPatchRecordOffset(i) + 12, true);
  }

  /** Read the u16 flags from the cell record of spill patch i. */
  spillPatchFlags(i: number): number {
    return this._view.getUint16(this.spillPatchRecordOffset(i) + 16, true);
  }

  /** Read the u16 format palette index from the cell record of spill patch i. */
  spillPatchFormatIdx(i: number): number {
    return this._view.getUint16(this.spillPatchRecordOffset(i) + 18, true);
  }

  /** Read the u16 display string length from the cell record of spill patch i. */
  spillPatchDisplayLen(i: number): number {
    return this._view.getUint16(this.spillPatchRecordOffset(i) + 20, true);
  }

  /** Read the u16 error string length from the cell record of spill patch i. */
  spillPatchErrorLen(i: number): number {
    return this._view.getUint16(this.spillPatchRecordOffset(i) + 22, true);
  }

  /** Read the u32 background color override from the cell record of spill patch i. */
  spillPatchBgColorOverride(i: number): number {
    return this._view.getUint32(this.spillPatchRecordOffset(i) + 24, true);
  }

  /** Read the u32 font color override from the cell record of spill patch i. */
  spillPatchFontColorOverride(i: number): number {
    return this._view.getUint32(this.spillPatchRecordOffset(i) + 28, true);
  }

  /**
   * Decode display text for spill patch i from the mutation's string pool.
   * Returns null if no display text is present.
   */
  spillPatchDisplayText(i: number): FormattedText | null {
    const recOff = this.spillPatchRecordOffset(i);
    const displayOff = this._view.getUint32(recOff + OFF_DISPLAY_OFF, true);
    const displayLen = this._view.getUint16(recOff + OFF_DISPLAY_LEN, true);
    if (displayOff === NO_STRING || displayLen === 0) return null;

    const start = this._stringPoolStart + displayOff;
    return asFormattedText(sharedDecoder.decode(this._bytes.subarray(start, start + displayLen)));
  }

  /**
   * Get a zero-copy subarray view of the raw UTF-8 display bytes for spill patch i.
   * Returns null if no display text is present.
   */
  spillPatchDisplayBytes(i: number): Uint8Array | null {
    const recOff = this.spillPatchRecordOffset(i);
    const displayOff = this._view.getUint32(recOff + OFF_DISPLAY_OFF, true);
    const displayLen = this._view.getUint16(recOff + OFF_DISPLAY_LEN, true);
    if (displayOff === NO_STRING || displayLen === 0) return null;

    const start = this._stringPoolStart + displayOff;
    return this._bytes.subarray(start, start + displayLen);
  }

  /**
   * Decode error text for spill patch i from the mutation's string pool.
   * Returns null if no error text is present.
   */
  spillPatchErrorText(i: number): string | null {
    const recOff = this.spillPatchRecordOffset(i);
    const errorOff = this._view.getUint32(recOff + OFF_ERROR_OFF, true);
    const errorLen = this._view.getUint16(recOff + OFF_ERROR_LEN, true);
    if (errorOff === NO_STRING || errorLen === 0) return null;

    const start = this._stringPoolStart + errorOff;
    return sharedDecoder.decode(this._bytes.subarray(start, start + errorLen));
  }

  /**
   * Get a zero-copy subarray view of the raw UTF-8 error bytes for spill patch i.
   * Returns null if no error text is present.
   */
  spillPatchErrorBytes(i: number): Uint8Array | null {
    const recOff = this.spillPatchRecordOffset(i);
    const errorOff = this._view.getUint32(recOff + OFF_ERROR_OFF, true);
    const errorLen = this._view.getUint16(recOff + OFF_ERROR_LEN, true);
    if (errorOff === NO_STRING || errorLen === 0) return null;

    const start = this._stringPoolStart + errorOff;
    return this._bytes.subarray(start, start + errorLen);
  }
}
