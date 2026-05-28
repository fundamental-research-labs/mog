/**
 * BinaryViewportBuffer — Zero-copy binary buffer reader for viewport data.
 *
 * Reads the binary viewport protocol directly via DataView without
 * deserializing into JS objects. Cell data is accessed through a
 * flyweight CellAccessor that reads fields on demand.
 *
 * Binary layout:
 *   Header: 36 bytes
 *   Cell Records: cell_count * 32 bytes (dense row-major)
 *   String Pool: packed UTF-8
 *   Merge Records: merge_count * 16 bytes
 *   Row Dimensions: row_dim_count * 12 bytes
 *   Col Dimensions: col_dim_count * 12 bytes
 *   Format Palette: JSON-encoded
 *   Data Bars: data_bar_count * 24 bytes
 *   Icons: icon_count * 8 bytes
 *   Row Positions: viewport_rows * 8 bytes (f64 LE)
 *   Col Positions: viewport_cols * 8 bytes (f64 LE)
 */

import type { CellFormat, FormattedText } from '@mog-sdk/contracts/core';
import { asFormattedText, displayStringOrNull } from '@mog-sdk/contracts/core';
import type { OSDevToolsViewportBufferEvent } from '../../global';
import { BinaryMutationReader } from './binary-mutation-reader';
import { decodePaletteBinary, encodePaletteBinary } from './palette-binary';

// ---------------------------------------------------------------------------
// Module-level singleton TextEncoder/TextDecoder — avoid per-call allocation
// ---------------------------------------------------------------------------

const sharedEncoder = new TextEncoder();
const sharedDecoder = new TextDecoder('utf-8');

function copyF64Section(buffer: Uint8Array, start: number, count: number): Float64Array {
  const byteLength = count * 8;
  const bytes = new Uint8Array(byteLength);
  bytes.set(buffer.subarray(start, start + byteLength));
  return new Float64Array(bytes.buffer, 0, count);
}

function f64SectionView(buffer: Uint8Array, start: number, count: number): Float64Array {
  const absoluteOffset = buffer.byteOffset + start;
  if (absoluteOffset % 8 === 0) {
    return new Float64Array(buffer.buffer, absoluteOffset, count);
  }
  return copyF64Section(buffer, start, count);
}

function reportViewportBuffer(event: OSDevToolsViewportBufferEvent): void {
  globalThis.window?.__OS_DEVTOOLS__?.reportViewportBuffer?.(event);
}

/** Current viewport bounds. */
export interface ViewportBounds {
  sheetId: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

// ---------------------------------------------------------------------------
// Binary layout constants — generated from Rust (single source of truth)
// ---------------------------------------------------------------------------

export {
  CELL_STRIDE,
  DATA_BAR_ENTRY_STRIDE,
  DIM_STRIDE,
  HAS_CF_EXTRAS,
  HAS_CELL_IMAGE,
  HAS_COMMENT,
  HAS_FORMULA,
  HAS_HYPERLINK,
  HAS_SPARKLINE,
  HAS_VALIDATION_ERROR,
  HEADER_SIZE,
  ICON_ENTRY_STRIDE,
  IS_CHECKBOX,
  IS_SPILL_MEMBER,
  MERGE_STRIDE,
  NO_STRING,
  OFF_BG_COLOR_OVERRIDE,
  OFF_DISPLAY_LEN,
  OFF_DISPLAY_OFF,
  OFF_ERROR_LEN,
  OFF_ERROR_OFF,
  OFF_FLAGS,
  OFF_FONT_COLOR_OVERRIDE,
  OFF_FORMAT_IDX,
  OFF_NUMBER_VALUE,
  POSITION_ENTRY_SIZE,
  VALUE_TYPE_BOOL,
  VALUE_TYPE_ERROR,
  VALUE_TYPE_IMAGE,
  VALUE_TYPE_MASK,
  VALUE_TYPE_NULL,
  VALUE_TYPE_NUMBER,
  VALUE_TYPE_TEXT,
  ValueType,
} from './constants.gen';

import {
  CELL_STRIDE,
  DATA_BAR_ENTRY_STRIDE,
  DIM_STRIDE,
  HAS_CELL_IMAGE,
  HEADER_SIZE,
  ICON_ENTRY_STRIDE,
  ICON_SET_NAMES,
  MERGE_STRIDE,
  NO_STRING,
  OFF_BG_COLOR_OVERRIDE,
  OFF_DISPLAY_LEN,
  OFF_DISPLAY_OFF,
  OFF_ERROR_LEN,
  OFF_ERROR_OFF,
  OFF_FLAGS,
  OFF_FONT_COLOR_OVERRIDE,
  OFF_FORMAT_IDX,
  OFF_NUMBER_VALUE,
  VALUE_TYPE_IMAGE,
} from './constants.gen';

// Patch key column multiplier (must be > max columns; Excel max = 16384)
// TS-specific constant, not in the Rust wire format
export const PATCH_KEY_COL_BITS = 0x100000;

// ---------------------------------------------------------------------------
// Parsed format palette
// ---------------------------------------------------------------------------

interface FormatPalette {
  start_index: number;
  formats: CellFormat[];
}

// ---------------------------------------------------------------------------
// Merge region (matches ViewportMerge shape)
// ---------------------------------------------------------------------------

export interface BinaryMergeRegion {
  start_row: number;
  start_col: number;
  end_row: number;
  end_col: number;
}

// ---------------------------------------------------------------------------
// Dimension records
// ---------------------------------------------------------------------------

export interface BinaryRowDimension {
  row: number;
  height: number;
  hidden: boolean;
}

export interface BinaryColDimension {
  col: number;
  width: number;
  hidden: boolean;
}

// ---------------------------------------------------------------------------
// Empty CellFormat singleton
// ---------------------------------------------------------------------------

const EMPTY_FORMAT: CellFormat = Object.freeze({});

// ---------------------------------------------------------------------------
// CF extras types
// ---------------------------------------------------------------------------

/** Renderer-friendly data bar information for a single cell. */
export interface DataBarData {
  fillPercent: number;
  color: string; // hex "#RRGGBB"
  isNegative: boolean;
  gradient: boolean;
  showValue: boolean;
  showAxis: boolean;
  axisPosition: number;
  negativeColor: string; // hex "#RRGGBB"
}

/** Renderer-friendly icon information for a single cell. */
export interface IconData {
  setName: string; // e.g. "3Arrows"
  iconIndex: number;
  iconOnly: boolean;
}

// ICON_SET_NAMES imported from ./constants.gen (generated from Rust CfIconSetName enum)

/**
 * Convert a u32 RGBA value (R in highest byte, A in lowest) to a hex color
 * string "#RRGGBB" (alpha is discarded).
 */
function rgbaU32ToHex(value: number): string {
  const r = (value >>> 24) & 0xff;
  const g = (value >>> 16) & 0xff;
  const b = (value >>> 8) & 0xff;
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase();
}

// ---------------------------------------------------------------------------
// BinaryViewportBuffer
// ---------------------------------------------------------------------------

export class BinaryViewportBuffer {
  // Raw backing buffer + DataView
  private _buffer: Uint8Array | null = null;
  private _view: DataView | null = null;

  // Header fields (parsed on setBuffer)
  private _startRow = 0;
  private _startCol = 0;
  private _cellCount = 0;
  private _formatPaletteLen = 0;
  private _stringPoolBytes = 0;
  private _viewportRows = 0;
  private _viewportCols = 0;
  private _mergeCount = 0;
  private _rowDimCount = 0;
  private _colDimCount = 0;
  private _flags = 0;
  private _generation = 0;
  private _dataBarCount = 0;
  private _iconCount = 0;

  // Computed section offsets
  private _cellsOffset = HEADER_SIZE;
  private _stringPoolOffset = HEADER_SIZE;
  private _mergesOffset = 0;
  private _rowDimOffset = 0;
  private _colDimOffset = 0;
  private _paletteOffset = 0;

  // Decoded format palette (JSON parsed once per setBuffer)
  private _palette: FormatPalette = { start_index: 0, formats: [] };

  // CF extras maps (parsed eagerly on setBuffer, keyed by cell index)
  private _dataBars: Map<number, DataBarData> = new Map();
  private _icons: Map<number, IconData> = new Map();

  // Overflow string pool for mutation patches (binary mutation path).
  // Main string pool: bytes [0, _mainPoolSize) — immutable, from last viewport fetch.
  // Overflow pool: bytes [_mainPoolSize, _mainPoolSize + _overflowSize) — growable, from mutations.
  // display_off values < _mainPoolSize → read from main pool.
  // display_off values >= _mainPoolSize → read from overflow pool (offset by _mainPoolSize).
  // On next viewport fetch (setBuffer()): overflow pool is cleared.
  private _mainPoolSize = 0;
  private _overflowPool: Uint8Array = new Uint8Array(0);
  private _overflowSize = 0; // bytes used in overflow pool

  // String decode cache: keyed by cell byte offset within string pool
  // Invalidated per-cell on patch
  private _stringCache: Map<number, string> = new Map();

  // Lazy dimension index for O(1) lookup
  private _rowDimIndex: Map<number, BinaryRowDimension> | null = null;
  private _colDimIndex: Map<number, BinaryColDimension> | null = null;

  // Position arrays: Float64Array views into the binary buffer.
  // Absolute pixel positions for each row/col in the viewport range.
  // null when LayoutIndex is not yet available (empty arrays from Rust).
  private _rowPositions: Float64Array | null = null;
  private _colPositions: Float64Array | null = null;

  // Sheet ID for getBounds()
  private _sheetId: string = '';

  // Visible window for overscan (optional)
  private _visibleWindow: ViewportBounds | null = null;

  // Scroll behavior — drives the moveTo gate.
  // - 'free' (main viewport): both row and col can leak from frozen panes via
  //   bidirectional overscan, so gate both axes.
  // - 'horizontal-only' (frozen-rows): vw.startRow is always 0; horizontal scroll
  //   moves vw.startCol but cells in [frozenCols, vw.startCol) legitimately belong
  //   to this viewport. Don't gate col.
  // - 'vertical-only' (frozen-cols): symmetric; don't gate row.
  // - 'none' (corner): vw is fixed, no overscan, no gate needed.
  // Default 'free' matches the conservative behavior for un-tagged buffers.
  private _scrollBehavior: 'free' | 'horizontal-only' | 'vertical-only' | 'none' = 'free';

  // -------------------------------------------------------------------
  // Buffer management
  // -------------------------------------------------------------------

  /**
   * Swap in a new binary buffer. Parses the header and JSON palette.
   * Clears all patch overlays and caches.
   */
  setBuffer(buffer: Uint8Array): void {
    this._buffer = buffer;
    this._view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // Parse header (36 bytes, little-endian)
    const v = this._view;
    this._startRow = v.getUint32(0, true);
    this._startCol = v.getUint32(4, true);
    this._cellCount = v.getUint32(8, true);
    this._formatPaletteLen = v.getUint32(12, true);
    this._stringPoolBytes = v.getUint32(16, true);
    this._viewportRows = v.getUint16(20, true);
    this._viewportCols = v.getUint16(22, true);
    this._mergeCount = v.getUint16(24, true);
    this._rowDimCount = v.getUint16(26, true);
    this._colDimCount = v.getUint16(28, true);
    this._flags = v.getUint8(30);
    this._generation = v.getUint8(31);
    this._dataBarCount = v.getUint16(32, true);
    this._iconCount = v.getUint16(34, true);

    // Compute section offsets
    this._cellsOffset = HEADER_SIZE;
    this._stringPoolOffset = this._cellsOffset + this._cellCount * CELL_STRIDE;
    this._mergesOffset = this._stringPoolOffset + this._stringPoolBytes;
    this._rowDimOffset = this._mergesOffset + this._mergeCount * MERGE_STRIDE;
    this._colDimOffset = this._rowDimOffset + this._rowDimCount * DIM_STRIDE;
    this._paletteOffset = this._colDimOffset + this._colDimCount * DIM_STRIDE;

    // Parse binary palette
    if (this._formatPaletteLen > 0) {
      const decoded = decodePaletteBinary(v, this._paletteOffset, this._formatPaletteLen);
      this._palette = {
        start_index: decoded.startIndex,
        formats: decoded.formats,
      };
    } else {
      this._palette = { start_index: 0, formats: [] };
    }

    // Parse CF extras (data bars and icons) from after the palette
    this._dataBars = new Map();
    this._icons = new Map();
    if (this._dataBarCount > 0 || this._iconCount > 0) {
      const cfExtrasStart = this._paletteOffset + this._formatPaletteLen;
      // Parse data bar entries (24 bytes each)
      for (let i = 0; i < this._dataBarCount; i++) {
        const off = cfExtrasStart + i * DATA_BAR_ENTRY_STRIDE;
        const cellIndex = v.getUint32(off, true);
        const fillPercent = v.getFloat32(off + 4, true);
        const color = v.getUint32(off + 8, true);
        const dbFlags = v.getUint32(off + 12, true);
        const axisPosition = v.getFloat32(off + 16, true);
        const negativeColor = v.getUint32(off + 20, true);
        this._dataBars.set(cellIndex, {
          fillPercent,
          color: rgbaU32ToHex(color),
          gradient: (dbFlags & 0x1) !== 0,
          isNegative: (dbFlags & 0x2) !== 0,
          showValue: (dbFlags & 0x4) !== 0,
          showAxis: (dbFlags & 0x8) !== 0,
          axisPosition,
          negativeColor: rgbaU32ToHex(negativeColor),
        });
      }
      // Parse icon entries (8 bytes each)
      const iconStart = cfExtrasStart + this._dataBarCount * DATA_BAR_ENTRY_STRIDE;
      for (let i = 0; i < this._iconCount; i++) {
        const off = iconStart + i * ICON_ENTRY_STRIDE;
        const cellIndex = v.getUint32(off, true);
        const setNameIndex = v.getUint8(off + 4);
        const iconIndex = v.getUint8(off + 5);
        const iconFlags = v.getUint8(off + 6);
        this._icons.set(cellIndex, {
          setName: ICON_SET_NAMES[setNameIndex] ?? 'NoIcons',
          iconIndex,
          iconOnly: (iconFlags & 0x1) !== 0,
        });
      }
    }

    // Parse position arrays (f64 LE, after icons section).
    // Wire ships viewportRows + 1 / viewportCols + 1 entries — the +1 is a
    // trailing sentinel (top edge of the row past the range / left edge of
    // the col past the range). VPI uses this to derive the height/width of
    // the last in-range row/col. Empty viewports carry no entries.
    {
      const positionsStart =
        this._paletteOffset +
        this._formatPaletteLen +
        this._dataBarCount * DATA_BAR_ENTRY_STRIDE +
        this._iconCount * ICON_ENTRY_STRIDE;
      const rowPosCount = this._viewportRows > 0 ? this._viewportRows + 1 : 0;
      const colPosCount = this._viewportCols > 0 ? this._viewportCols + 1 : 0;
      if (rowPosCount > 0 && positionsStart + rowPosCount * 8 <= buffer.byteLength) {
        // N-API may hand us a Buffer/Uint8Array with an arbitrary byteOffset.
        // Keep the browser/WASM path zero-copy and copy only when JS typed-array
        // alignment rules require it.
        this._rowPositions = f64SectionView(buffer, positionsStart, rowPosCount);
      } else {
        this._rowPositions = null;
      }
      const colPosOffset = positionsStart + rowPosCount * 8;
      if (colPosCount > 0 && colPosOffset + colPosCount * 8 <= buffer.byteLength) {
        this._colPositions = f64SectionView(buffer, colPosOffset, colPosCount);
      } else {
        this._colPositions = null;
      }
    }

    // Track main pool size for overflow pool reads
    this._mainPoolSize = this._stringPoolBytes;

    // Clear caches, overflow pool, and dimension index
    this._stringCache.clear();
    this._overflowPool = new Uint8Array(0);
    this._overflowSize = 0;
    this._rowDimIndex = null;
    this._colDimIndex = null;

    // Report to devtools (zero cost when devtools not loaded)
    reportViewportBuffer({
      kind: 'full-refresh' as const,
      viewportId: 'main',
      patchCount: this._cellCount,
      skippedOutOfBounds: 0,
      bufferBounds: {
        startRow: this._startRow,
        startCol: this._startCol,
        rows: this._viewportRows,
        cols: this._viewportCols,
      },
      generation: this._generation,
      overflowPoolBytes: 0,
    });

    // NOTE: markGeometryDirty/markAllDirty removed — the ViewportCoordinator
    // emits 'fetch-committed' after calling setBuffer(), and the subscriber
    // in renderer-execution.ts handles VPI rebuild + render scheduling.
  }

  // -------------------------------------------------------------------
  // Getters for header fields
  // -------------------------------------------------------------------

  getStartRow(): number {
    return this._startRow;
  }

  getStartCol(): number {
    return this._startCol;
  }

  getRows(): number {
    return this._viewportRows;
  }

  getCols(): number {
    return this._viewportCols;
  }

  getCellCount(): number {
    return this._cellCount;
  }

  getGeneration(): number {
    return this._generation;
  }

  isDelta(): boolean {
    return (this._flags & 0x1) !== 0;
  }

  getProtocolVersion(): number {
    return (this._flags >> 4) & 0xf;
  }

  /** Returns true if a buffer has been set. */
  hasBuffer(): boolean {
    return this._buffer !== null;
  }

  // -------------------------------------------------------------------
  // Cell offset computation
  // -------------------------------------------------------------------

  /**
   * Compute the byte offset of a cell record given absolute row/col.
   * Returns -1 if the cell is outside the viewport.
   */
  cellOffset(row: number, col: number): number {
    const localRow = row - this._startRow;
    const localCol = col - this._startCol;
    if (
      localRow < 0 ||
      localRow >= this._viewportRows ||
      localCol < 0 ||
      localCol >= this._viewportCols
    ) {
      return -1;
    }
    const cellIndex = localRow * this._viewportCols + localCol;
    return this._cellsOffset + cellIndex * CELL_STRIDE;
  }

  /**
   * Compute the dense cell index for a given absolute row/col.
   * Returns -1 if out of bounds.
   */
  cellIndex(row: number, col: number): number {
    const localRow = row - this._startRow;
    const localCol = col - this._startCol;
    if (
      localRow < 0 ||
      localRow >= this._viewportRows ||
      localCol < 0 ||
      localCol >= this._viewportCols
    ) {
      return -1;
    }
    return localRow * this._viewportCols + localCol;
  }

  // -------------------------------------------------------------------
  // Format index accessors — used to preserve format across value-only mutations
  // -------------------------------------------------------------------

  /** Read the raw format_idx (u16) for the cell at (row, col). Returns 0 if out of viewport. */
  getFormatIdxAt(row: number, col: number): number {
    if (!this._view) return 0;
    const offset = this.cellOffset(row, col);
    if (offset < 0) return 0;
    return this._view.getUint16(offset + OFF_FORMAT_IDX, true);
  }

  /** Write a format_idx (u16) for the cell at (row, col). No-op if out of viewport. */
  setFormatIdxAt(row: number, col: number, formatIdx: number): void {
    if (!this._view) return;
    const offset = this.cellOffset(row, col);
    if (offset < 0) return;
    this._view.setUint16(offset + OFF_FORMAT_IDX, formatIdx, true);
  }

  // -------------------------------------------------------------------
  // CellAccessor factory
  // -------------------------------------------------------------------

  /** Create a reusable flyweight accessor bound to this buffer. */
  createAccessor(): CellAccessor {
    return new CellAccessor(this);
  }

  // -------------------------------------------------------------------
  // Overflow string pool (for binary mutation patches)
  // -------------------------------------------------------------------

  /**
   * Append a UTF-8 string to the overflow pool and return its offset/length.
   *
   * The returned offset is relative to the main pool start (i.e., it includes
   * the _mainPoolSize prefix) so it can be written directly into cell record
   * display_off/error_off fields.
   */
  appendToOverflowPool(text: string): { offset: number; length: number } {
    const encoded = sharedEncoder.encode(text);
    return this.appendRawBytesToOverflowPool(encoded);
  }

  /**
   * Append raw UTF-8 bytes directly to the overflow pool — zero TextEncoder overhead.
   *
   * This is the fast path used by _applyMutationPatch(): the raw bytes are already
   * sitting in the mutation buffer's string pool, so we memcpy them directly into
   * the overflow pool without materializing a JS string.
   *
   * Returns { offset, length } where offset is relative to main pool start.
   */
  appendRawBytesToOverflowPool(bytes: Uint8Array): { offset: number; length: number } {
    const byteLen = bytes.byteLength;
    // Grow if needed
    if (this._overflowSize + byteLen > this._overflowPool.length) {
      const newSize = Math.max(this._overflowPool.length * 2, this._overflowSize + byteLen + 256);
      const newPool = new Uint8Array(newSize);
      newPool.set(this._overflowPool.subarray(0, this._overflowSize));
      this._overflowPool = newPool;
    }
    const localOffset = this._overflowSize;
    this._overflowPool.set(bytes, localOffset);
    this._overflowSize += byteLen;
    // Return offset relative to main pool so getOrDecodeString can route correctly
    return { offset: this._mainPoolSize + localOffset, length: byteLen };
  }

  // -------------------------------------------------------------------
  // Binary mutation application
  // -------------------------------------------------------------------

  /**
   * Apply a binary mutation result directly into the viewport buffer.
   *
   * Reads cell patches from the BinaryMutationReader and writes them into
   * the viewport buffer's cell record area. String references are rebased
   * from the mutation's string pool into the viewport's overflow pool.
   *
   * This is the zero-JSON-parse fast path for mutation results.
   *
   * @param reader - A BinaryMutationReader wrapping the binary mutation blob
   */
  applyBinaryMutation(reader: BinaryMutationReader, viewportId?: string): void {
    if (!this._view || !this._buffer) return;

    let patchedCount = 0;
    let skippedOutOfBounds = 0;
    const sampleCells: Array<{ row: number; col: number; displayText: string | null }> = [];
    const dirtyCells: { row: number; col: number }[] = [];

    // Apply regular cell patches.
    //
    // No same-batch dedup is required: the Rust scheduler guarantees that a
    // single mutation result never carries contradictory patches for the same
    // cell. When a user writes a value to a spill member, the scheduler emits
    // exactly one regular patch (the user's value) and suppresses the
    // would-be teardown null for the same position before the wire layer.
    // See `compute/core/src/scheduler/spill.rs::append_filtered_teardowns`.
    for (let i = 0; i < reader.patchCount; i++) {
      const row = reader.patchRow(i);
      const col = reader.patchCol(i);
      const offset = this.cellOffset(row, col);
      if (offset < 0) {
        skippedOutOfBounds++;
      } else {
        patchedCount++;
        dirtyCells.push({ row, col });
        if (sampleCells.length < 5) {
          sampleCells.push({
            row,
            col,
            displayText: displayStringOrNull(reader.patchDisplayText(i)),
          });
        }
      }
      this._applyMutationPatch(reader, i, false);
    }

    // Apply spill cell patches (same shape as regular, different section).
    for (let i = 0; i < reader.spillPatchCount; i++) {
      const row = reader.spillPatchRow(i);
      const col = reader.spillPatchCol(i);
      const offset = this.cellOffset(row, col);
      if (offset < 0) {
        skippedOutOfBounds++;
      } else {
        patchedCount++;
        dirtyCells.push({ row, col });
        if (sampleCells.length < 5) {
          sampleCells.push({
            row,
            col,
            displayText: displayStringOrNull(reader.spillPatchDisplayText(i)),
          });
        }
      }
      this._applyMutationPatch(reader, i, true);
    }

    // Apply palette delta from mutation response (format mutations include new palette entries).
    // The Rust-side palette may have grown beyond the TS palette between fetches
    // (e.g., from format mutations whose deltas were empty because the intern
    // reused an existing index). Fill any gap so that global indices stay aligned.
    if (reader.hasPalette) {
      const deltaFormats = reader.paletteFormats;
      if (deltaFormats.length > 0) {
        for (let i = 0; i < deltaFormats.length; i++) {
          const globalIdx = reader.paletteStartIndex + i;
          const localIdx = globalIdx - this._palette.start_index;
          while (this._palette.formats.length <= localIdx) {
            this._palette.formats.push({} as CellFormat);
          }
          this._palette.formats[localIdx] = deltaFormats[i];
        }
      }
    }

    // Invalidate dimension index (mutations may include dim changes in the future)
    this._rowDimIndex = null;
    this._colDimIndex = null;

    // Report to devtools (zero cost when devtools not loaded)
    reportViewportBuffer({
      kind: 'mutation-applied' as const,
      viewportId: viewportId ?? 'main',
      patchCount: patchedCount,
      skippedOutOfBounds,
      bufferBounds: {
        startRow: this._startRow,
        startCol: this._startCol,
        rows: this._viewportRows,
        cols: this._viewportCols,
      },
      generation: this._generation,
      overflowPoolBytes: this._overflowSize,
      sampleCells,
    });

    // Render scheduling is handled by the ViewportCoordinator's subscriber model
    // (cells-patched event), not here — same pattern as setBuffer/patchRowDimension/patchColDimension.
  }

  /**
   * Apply a single patch from the mutation reader into the viewport buffer.
   * Shared between regular cell patches and spill cell patches.
   *
   * @param reader - The BinaryMutationReader
   * @param idx - Patch index within the regular or spill section
   * @param isSpill - Whether to read from the spill section
   */
  private _applyMutationPatch(reader: BinaryMutationReader, idx: number, isSpill: boolean): void {
    if (!this._view) return;

    const row = isSpill ? reader.spillPatchRow(idx) : reader.patchRow(idx);
    const col = isSpill ? reader.spillPatchCol(idx) : reader.patchCol(idx);
    const offset = this.cellOffset(row, col);
    if (offset < 0) return; // cell not in viewport

    // Read fields from the mutation cell record via typed accessors
    const numberValue = isSpill ? reader.spillPatchNumberValue(idx) : reader.patchNumberValue(idx);
    const displayOff = isSpill ? reader.spillPatchDisplayOff(idx) : reader.patchDisplayOff(idx);
    const errorOff = isSpill ? reader.spillPatchErrorOff(idx) : reader.patchErrorOff(idx);
    const flags = isSpill ? reader.spillPatchFlags(idx) : reader.patchFlags(idx);
    const formatIdx = isSpill ? reader.spillPatchFormatIdx(idx) : reader.patchFormatIdx(idx);
    const displayLen = isSpill ? reader.spillPatchDisplayLen(idx) : reader.patchDisplayLen(idx);
    const errorLen = isSpill ? reader.spillPatchErrorLen(idx) : reader.patchErrorLen(idx);
    const bgColorOverride = isSpill
      ? reader.spillPatchBgColorOverride(idx)
      : reader.patchBgColorOverride(idx);
    const fontColorOverride = isSpill
      ? reader.spillPatchFontColorOverride(idx)
      : reader.patchFontColorOverride(idx);

    // Invalidate string cache for the cell's OLD string offsets
    const oldDisplayOff = this._view.getUint32(offset + OFF_DISPLAY_OFF, true);
    const oldErrorOff = this._view.getUint32(offset + OFF_ERROR_OFF, true);
    if (oldDisplayOff !== NO_STRING) {
      this._stringCache.delete(oldDisplayOff);
    }
    if (oldErrorOff !== NO_STRING) {
      this._stringCache.delete(oldErrorOff);
    }

    // Write numeric fields directly into the viewport buffer
    this._view.setFloat64(offset + OFF_NUMBER_VALUE, numberValue, true);
    this._view.setUint16(offset + OFF_FLAGS, flags, true);
    this._view.setUint16(offset + OFF_FORMAT_IDX, formatIdx, true);
    this._view.setUint32(offset + OFF_BG_COLOR_OVERRIDE, bgColorOverride, true);
    this._view.setUint32(offset + OFF_FONT_COLOR_OVERRIDE, fontColorOverride, true);

    // Rebase display string into overflow pool (raw byte copy — no TextDecoder/TextEncoder)
    if (displayOff !== NO_STRING && displayLen > 0) {
      const displayBytes = isSpill
        ? reader.spillPatchDisplayBytes(idx)
        : reader.patchDisplayBytes(idx);
      if (displayBytes !== null) {
        const { offset: newDisplayOff, length: newDisplayLen } =
          this.appendRawBytesToOverflowPool(displayBytes);
        this._view.setUint32(offset + OFF_DISPLAY_OFF, newDisplayOff, true);
        this._view.setUint16(offset + OFF_DISPLAY_LEN, newDisplayLen, true);
      }
    } else {
      this._view.setUint32(offset + OFF_DISPLAY_OFF, NO_STRING, true);
      this._view.setUint16(offset + OFF_DISPLAY_LEN, 0, true);
    }

    // Rebase error string into overflow pool (raw byte copy — no TextDecoder/TextEncoder)
    if (errorOff !== NO_STRING && errorLen > 0) {
      const errorBytes = isSpill ? reader.spillPatchErrorBytes(idx) : reader.patchErrorBytes(idx);
      if (errorBytes !== null) {
        const { offset: newErrorOff, length: newErrorLen } =
          this.appendRawBytesToOverflowPool(errorBytes);
        this._view.setUint32(offset + OFF_ERROR_OFF, newErrorOff, true);
        this._view.setUint16(offset + OFF_ERROR_LEN, newErrorLen, true);
      }
    } else {
      this._view.setUint32(offset + OFF_ERROR_OFF, NO_STRING, true);
      this._view.setUint16(offset + OFF_ERROR_LEN, 0, true);
    }
  }

  // -------------------------------------------------------------------
  // String access (used by CellAccessor)
  // -------------------------------------------------------------------

  /**
   * Decode a string from the string pool (or overflow pool), with caching.
   *
   * byteOff is relative to the start of the string pool section:
   * - byteOff < _mainPoolSize → read from the main pool (binary viewport buffer)
   * - byteOff >= _mainPoolSize → read from the overflow pool (mutation patches)
   *
   * Returns null if byteOff is NO_STRING.
   */
  getOrDecodeString(byteOff: number, byteLen: number): string | null {
    if (byteOff === NO_STRING || byteLen === 0) {
      return null;
    }

    const cached = this._stringCache.get(byteOff);
    if (cached !== undefined) {
      return cached;
    }

    let decoded: string;
    if (byteOff >= this._mainPoolSize && this._overflowSize > 0) {
      // Read from overflow pool (mutation patches)
      const overflowOff = byteOff - this._mainPoolSize;
      const slice = this._overflowPool.subarray(overflowOff, overflowOff + byteLen);
      decoded = sharedDecoder.decode(slice);
    } else {
      // Read from main pool (binary viewport buffer)
      const absOff = this._stringPoolOffset + byteOff;
      const slice = this._buffer!.subarray(absOff, absOff + byteLen);
      decoded = sharedDecoder.decode(slice);
    }

    this._stringCache.set(byteOff, decoded);
    return decoded;
  }

  // -------------------------------------------------------------------
  // Format palette access
  // -------------------------------------------------------------------

  /**
   * Get a CellFormat by palette index. Returns frozen empty format for index 0
   * or out-of-range indices.
   */
  getFormatByIndex(idx: number): CellFormat {
    const adjusted = idx - this._palette.start_index;
    if (adjusted < 0 || adjusted >= this._palette.formats.length) {
      return EMPTY_FORMAT;
    }
    return this._palette.formats[adjusted];
  }

  // -------------------------------------------------------------------
  // Merge records
  // -------------------------------------------------------------------

  /** Parse merge records from the binary buffer. */
  getMerges(): BinaryMergeRegion[] {
    if (!this._view || this._mergeCount === 0) {
      return [];
    }
    const merges: BinaryMergeRegion[] = new Array(this._mergeCount);
    for (let i = 0; i < this._mergeCount; i++) {
      const off = this._mergesOffset + i * MERGE_STRIDE;
      merges[i] = {
        start_row: this._view.getUint32(off, true),
        start_col: this._view.getUint32(off + 4, true),
        end_row: this._view.getUint32(off + 8, true),
        end_col: this._view.getUint32(off + 12, true),
      };
    }
    return merges;
  }

  // -------------------------------------------------------------------
  // Dimension records
  // -------------------------------------------------------------------

  /** Parse row dimension records from the binary buffer. */
  getRowDimensions(): BinaryRowDimension[] {
    if (!this._view || this._rowDimCount === 0) {
      return [];
    }
    const dims: BinaryRowDimension[] = new Array(this._rowDimCount);
    for (let i = 0; i < this._rowDimCount; i++) {
      const off = this._rowDimOffset + i * DIM_STRIDE;
      const flags = this._view.getUint32(off + 8, true);
      dims[i] = {
        row: this._view.getUint32(off, true),
        height: this._view.getFloat32(off + 4, true),
        hidden: (flags & 0x1) !== 0,
      };
    }
    return dims;
  }

  /** Parse column dimension records from the binary buffer. */
  getColDimensions(): BinaryColDimension[] {
    if (!this._view || this._colDimCount === 0) {
      return [];
    }
    const dims: BinaryColDimension[] = new Array(this._colDimCount);
    for (let i = 0; i < this._colDimCount; i++) {
      const off = this._colDimOffset + i * DIM_STRIDE;
      const flags = this._view.getUint32(off + 8, true);
      dims[i] = {
        col: this._view.getUint32(off, true),
        width: this._view.getFloat32(off + 4, true),
        hidden: (flags & 0x1) !== 0,
      };
    }
    return dims;
  }

  // -------------------------------------------------------------------
  // Lazy dimension index (O(1) lookup)
  // -------------------------------------------------------------------

  /** Get a single row dimension by row number, or null if not present. */
  getRowDimension(row: number): BinaryRowDimension | null {
    if (!this._rowDimIndex) this._buildDimIndex();
    return this._rowDimIndex!.get(row) ?? null;
  }

  /** Get a single col dimension by col number, or null if not present. */
  getColDimension(col: number): BinaryColDimension | null {
    if (!this._colDimIndex) this._buildDimIndex();
    return this._colDimIndex!.get(col) ?? null;
  }

  private _buildDimIndex(): void {
    this._rowDimIndex = new Map();
    for (const d of this.getRowDimensions()) this._rowDimIndex.set(d.row, d);
    this._colDimIndex = new Map();
    for (const d of this.getColDimensions()) this._colDimIndex.set(d.col, d);
  }

  // -------------------------------------------------------------------
  // Position arrays (absolute pixel positions from LayoutIndex)
  // -------------------------------------------------------------------

  /**
   * Get the absolute pixel Y position of a row's top edge.
   * Returns null if position data is not available or row is out of viewport range.
   */
  getRowTop(row: number): number | null {
    if (!this._rowPositions) return null;
    const localRow = row - this._startRow;
    if (localRow < 0 || localRow >= this._rowPositions.length) return null;
    return this._rowPositions[localRow]!;
  }

  /**
   * Get the absolute pixel X position of a column's left edge.
   * Returns null if position data is not available or col is out of viewport range.
   */
  getColLeft(col: number): number | null {
    if (!this._colPositions) return null;
    const localCol = col - this._startCol;
    if (localCol < 0 || localCol >= this._colPositions.length) return null;
    return this._colPositions[localCol]!;
  }

  /** Returns true if position arrays are available (LayoutIndex was populated). */
  hasPositions(): boolean {
    return this._rowPositions !== null && this._rowPositions.length > 0;
  }

  /**
   * Raw row position array (length = viewportRows + 1 with trailing sentinel,
   * or 0 for empty viewports). Sourced directly from Rust's LayoutIndex; the
   * sentinel lets consumers derive `height_of(endRow)` as
   * `arr[viewportRows] - arr[viewportRows - 1]` without a separate query.
   *
   * Returns null before the first fetch.
   */
  getRowPositions(): Float64Array | null {
    return this._rowPositions;
  }

  /** Mirror of {@link getRowPositions} for columns. */
  getColPositions(): Float64Array | null {
    return this._colPositions;
  }

  // -------------------------------------------------------------------
  // Bounds
  // -------------------------------------------------------------------

  /** Set the sheet ID used in getBounds(). */
  setSheetId(sheetId: string): void {
    this._sheetId = sheetId;
  }

  /** Get the viewport bounds including sheet ID. Returns null if no buffer. */
  getBounds(): ViewportBounds | null {
    if (!this._buffer) return null;
    return {
      sheetId: this._sheetId,
      startRow: this._startRow,
      startCol: this._startCol,
      endRow: this._startRow + this._viewportRows - 1,
      endCol: this._startCol + this._viewportCols - 1,
    };
  }

  // -------------------------------------------------------------------
  // Dimension patching
  // -------------------------------------------------------------------

  /** Patch a row dimension in the overlay index. Cleared on next setBuffer(). */
  patchRowDimension(row: number, height: number, hidden?: boolean): void {
    if (!this._rowDimIndex) this._buildDimIndex();
    this._rowDimIndex!.set(row, { row, height, hidden: hidden ?? false });
    // NOTE: markGeometryDirty removed — the ViewportCoordinator emits
    // 'dimensions-patched' after calling patchRowDimension(), and the
    // subscriber in renderer-execution.ts handles render scheduling.
  }

  /** Patch a col dimension in the overlay index. Cleared on next setBuffer(). */
  patchColDimension(col: number, width: number, hidden?: boolean): void {
    if (!this._colDimIndex) this._buildDimIndex();
    this._colDimIndex!.set(col, { col, width, hidden: hidden ?? false });
    // NOTE: markGeometryDirty removed — the ViewportCoordinator emits
    // 'dimensions-patched' after calling patchColDimension(), and the
    // subscriber in renderer-execution.ts handles render scheduling.
  }

  // -------------------------------------------------------------------
  // Overlay entry write-back (used by ViewportCoordinator fetch-commit)
  // -------------------------------------------------------------------

  /**
   * Write a decoded overlay entry's fields into the base buffer at the
   * cell record for (row, col).
   *
   * Used by ViewportCoordinator during fetch-commit to re-apply retained
   * overlay entries to a new base buffer. Writes:
   *   - flags (u16) at OFF_FLAGS
   *   - numberValue (f64) at OFF_NUMBER_VALUE
   *   - formatIdx (u16) at OFF_FORMAT_IDX
   *   - bgColorOverride (u32) at OFF_BG_COLOR_OVERRIDE
   *   - fontColorOverride (u32) at OFF_FONT_COLOR_OVERRIDE
   *   - displayString → appendToOverflowPool, update display_off/display_len
   *   - errorString → appendToOverflowPool, update error_off/error_len
   *
   * If the cell is outside viewport bounds, this is a no-op.
   *
   * @param row Absolute row index
   * @param col Absolute column index
   * @param entry The decoded overlay entry to write
   */
  writeOverlayEntryToBase(
    row: number,
    col: number,
    entry: {
      flags: number;
      numberValue: number;
      formatIdx: number;
      displayString: string | null;
      errorString: string | null;
      bgColorOverride: number;
      fontColorOverride: number;
    },
  ): void {
    if (!this._view) return;

    const offset = this.cellOffset(row, col);
    if (offset < 0) return;

    // Invalidate string cache for old values BEFORE overwriting
    const oldDisplayOff = this._view.getUint32(offset + OFF_DISPLAY_OFF, true);
    const oldErrorOff = this._view.getUint32(offset + OFF_ERROR_OFF, true);
    if (oldDisplayOff !== NO_STRING) {
      this._stringCache.delete(oldDisplayOff);
    }
    if (oldErrorOff !== NO_STRING) {
      this._stringCache.delete(oldErrorOff);
    }

    // Write numeric fields
    this._view.setFloat64(offset + OFF_NUMBER_VALUE, entry.numberValue, true);
    this._view.setUint16(offset + OFF_FLAGS, entry.flags, true);
    this._view.setUint16(offset + OFF_FORMAT_IDX, entry.formatIdx, true);
    this._view.setUint32(offset + OFF_BG_COLOR_OVERRIDE, entry.bgColorOverride, true);
    this._view.setUint32(offset + OFF_FONT_COLOR_OVERRIDE, entry.fontColorOverride, true);

    // Write display string to overflow pool
    if (entry.displayString !== null) {
      const { offset: strOff, length: strLen } = this.appendToOverflowPool(entry.displayString);
      this._view.setUint32(offset + OFF_DISPLAY_OFF, strOff, true);
      this._view.setUint16(offset + OFF_DISPLAY_LEN, strLen, true);
    } else {
      this._view.setUint32(offset + OFF_DISPLAY_OFF, NO_STRING, true);
      this._view.setUint16(offset + OFF_DISPLAY_LEN, 0, true);
    }

    // Write error string to overflow pool
    if (entry.errorString !== null) {
      const { offset: strOff, length: strLen } = this.appendToOverflowPool(entry.errorString);
      this._view.setUint32(offset + OFF_ERROR_OFF, strOff, true);
      this._view.setUint16(offset + OFF_ERROR_LEN, strLen, true);
    } else {
      this._view.setUint32(offset + OFF_ERROR_OFF, NO_STRING, true);
      this._view.setUint16(offset + OFF_ERROR_LEN, 0, true);
    }
  }

  // -------------------------------------------------------------------
  // Convenience
  // -------------------------------------------------------------------

  /** Check if a cell is within the current viewport bounds. */
  isInViewport(row: number, col: number): boolean {
    return this.cellOffset(row, col) >= 0;
  }

  // -------------------------------------------------------------------
  // Delta merge
  // -------------------------------------------------------------------

  /**
   * Apply a delta binary buffer to extend this buffer's coverage.
   *
   * The delta buffer contains only the new strip of cells (e.g., new rows
   * from scrolling down). This method:
   *   1. Parses the delta header to get its strip region
   *   2. Allocates a new buffer for the expanded prefetch region
   *   3. Copies existing cells that are still within new bounds
   *   4. Copies delta cells into their correct positions
   *   5. Merges string pools (rebases delta string offsets)
   *   6. Appends delta format palette entries
   *
   * @param deltaBuffer The raw binary delta buffer from Rust
   * @param newStartRow New combined prefetch start row
   * @param newStartCol New combined prefetch start col
   * @param newEndRow   New combined prefetch end row (exclusive)
   * @param newEndCol   New combined prefetch end col (exclusive)
   */
  applyDelta(
    deltaBuffer: Uint8Array,
    newStartRow: number,
    newStartCol: number,
    newEndRow: number,
    newEndCol: number,
  ): void {
    if (!this._buffer || !this._view) {
      // No existing buffer — treat delta as full buffer
      this.setBuffer(deltaBuffer);
      return;
    }

    // --- Parse delta header ---
    const dv = new DataView(deltaBuffer.buffer, deltaBuffer.byteOffset, deltaBuffer.byteLength);
    const deltaStartRow = dv.getUint32(0, true);
    const deltaStartCol = dv.getUint32(4, true);
    const deltaCellCount = dv.getUint32(8, true);
    const deltaPaletteLen = dv.getUint32(12, true);
    const deltaStringPoolBytes = dv.getUint32(16, true);
    const deltaViewportRows = dv.getUint16(20, true);
    const deltaViewportCols = dv.getUint16(22, true);
    const deltaMergeCount = dv.getUint16(24, true);
    const deltaRowDimCount = dv.getUint16(26, true);
    const deltaColDimCount = dv.getUint16(28, true);

    // --- Compute new buffer dimensions ---
    const newRows = newEndRow - newStartRow;
    const newCols = newEndCol - newStartCol;
    const newCellCount = newRows * newCols;

    // --- Extract existing string pool ---
    const existingPoolBytes = this._buffer.subarray(
      this._stringPoolOffset,
      this._stringPoolOffset + this._stringPoolBytes,
    );

    // --- Extract delta string pool ---
    const deltaCellsEnd = HEADER_SIZE + deltaCellCount * CELL_STRIDE;
    const deltaPoolStart = deltaCellsEnd;
    const deltaPoolBytes = deltaBuffer.subarray(
      deltaPoolStart,
      deltaPoolStart + deltaStringPoolBytes,
    );

    // --- Capture overflow pool (mutation strings from old buffer) ---
    const overflowBytes =
      this._overflowSize > 0 ? this._overflowPool.subarray(0, this._overflowSize) : null;
    const overflowSize = this._overflowSize;

    // --- Merged string pool ---
    const mergedPoolSize = this._stringPoolBytes + overflowSize + deltaStringPoolBytes;

    // --- Build new cell records ---
    // New buffer: Header + cells + merged string pool
    // We skip merges/dims/palette and rebuild those from the delta
    // (delta has merges/dims for its full requested region)

    // For merges, row dims, col dims — we need to combine from both buffers.
    // The delta response covers a strip, but the new bounds encompass both old and delta.
    // For simplicity, use existing merges/dims for rows/cols covered by old buffer,
    // and delta merges/dims for new rows/cols. But this is complex.
    // Instead, just use the existing merges and dims for the entire region.
    // Merges don't change during scrolling, and dims for the old region are still valid.
    // The delta strip's dims are for new rows/cols only.

    // Collect all merge records (existing + delta, deduplicated)
    const existingMerges = this.getMerges();
    const deltaMergesOffset = deltaPoolStart + deltaStringPoolBytes;

    // Normalize existing merges (BinaryMergeRegion uses snake_case) to camelCase
    type NormalizedMerge = { startRow: number; startCol: number; endRow: number; endCol: number };
    const normalizedExisting: NormalizedMerge[] = existingMerges.map((m) => ({
      startRow: m.start_row,
      startCol: m.start_col,
      endRow: m.end_row,
      endCol: m.end_col,
    }));
    const deltaMerges: NormalizedMerge[] = [];
    for (let i = 0; i < deltaMergeCount; i++) {
      const off = deltaMergesOffset + i * MERGE_STRIDE;
      deltaMerges.push({
        startRow: dv.getUint32(off, true),
        startCol: dv.getUint32(off + 4, true),
        endRow: dv.getUint32(off + 8, true),
        endCol: dv.getUint32(off + 12, true),
      });
    }
    // Combine merges (simple concat, dedup by key)
    const mergeSet = new Set<string>();
    const allMerges: NormalizedMerge[] = [];
    for (const m of [...normalizedExisting, ...deltaMerges]) {
      const key = `${m.startRow},${m.startCol},${m.endRow},${m.endCol}`;
      if (!mergeSet.has(key)) {
        mergeSet.add(key);
        allMerges.push(m);
      }
    }

    // Collect row dimensions (existing + delta)
    const existingRowDims = this.getRowDimensions();
    const deltaRowDimOffset = deltaMergesOffset + deltaMergeCount * MERGE_STRIDE;
    const deltaRowDims: { row: number; height: number; hidden: boolean }[] = [];
    for (let i = 0; i < deltaRowDimCount; i++) {
      const off = deltaRowDimOffset + i * DIM_STRIDE;
      const flags = dv.getUint32(off + 8, true);
      deltaRowDims.push({
        row: dv.getUint32(off, true),
        height: dv.getFloat32(off + 4, true),
        hidden: (flags & 0x1) !== 0,
      });
    }
    // Merge row dims: use map keyed by row
    const rowDimMap = new Map<number, { row: number; height: number; hidden: boolean }>();
    for (const d of existingRowDims) rowDimMap.set(d.row, d);
    for (const d of deltaRowDims) rowDimMap.set(d.row, d);
    // Filter to rows within new bounds
    const mergedRowDims = Array.from(rowDimMap.values())
      .filter((d) => d.row >= newStartRow && d.row < newEndRow)
      .sort((a, b) => a.row - b.row);

    // Collect col dimensions (existing + delta)
    const existingColDims = this.getColDimensions();
    const deltaColDimOffset = deltaRowDimOffset + deltaRowDimCount * DIM_STRIDE;
    const deltaColDims: { col: number; width: number; hidden: boolean }[] = [];
    for (let i = 0; i < deltaColDimCount; i++) {
      const off = deltaColDimOffset + i * DIM_STRIDE;
      const flags = dv.getUint32(off + 8, true);
      deltaColDims.push({
        col: dv.getUint32(off, true),
        width: dv.getFloat32(off + 4, true),
        hidden: (flags & 0x1) !== 0,
      });
    }
    const colDimMap = new Map<number, { col: number; width: number; hidden: boolean }>();
    for (const d of existingColDims) colDimMap.set(d.col, d);
    for (const d of deltaColDims) colDimMap.set(d.col, d);
    const mergedColDims = Array.from(colDimMap.values())
      .filter((d) => d.col >= newStartCol && d.col < newEndCol)
      .sort((a, b) => a.col - b.col);

    // --- Parse delta format palette and merge ---
    const deltaPaletteOffset = deltaColDimOffset + deltaColDimCount * DIM_STRIDE;
    let deltaPalette: FormatPalette = { start_index: 0, formats: [] };
    if (deltaPaletteLen > 0) {
      const decoded = decodePaletteBinary(dv, deltaPaletteOffset, deltaPaletteLen);
      deltaPalette = { start_index: decoded.startIndex, formats: decoded.formats };
    }

    // Merge palette: existing formats + new delta formats.
    // Use slice() instead of spread to avoid iterator protocol overhead.
    const mergedFormats = this._palette.formats.slice();
    if (deltaPalette.formats.length > 0) {
      for (let i = 0; i < deltaPalette.formats.length; i++) {
        const globalIdx = deltaPalette.start_index + i;
        const localIdx = globalIdx - this._palette.start_index;
        while (mergedFormats.length <= localIdx) {
          mergedFormats.push({} as CellFormat);
        }
        mergedFormats[localIdx] = deltaPalette.formats[i];
      }
    }

    // --- Build merged palette binary ---
    const mergedPaletteBytes = encodePaletteBinary(this._palette.start_index, mergedFormats);

    // --- Compute total size and allocate new buffer ---
    const mergedMergeSize = allMerges.length * MERGE_STRIDE;
    const mergedRowDimSize = mergedRowDims.length * DIM_STRIDE;
    const mergedColDimSize = mergedColDims.length * DIM_STRIDE;
    const totalSize =
      HEADER_SIZE +
      newCellCount * CELL_STRIDE +
      mergedPoolSize +
      mergedMergeSize +
      mergedRowDimSize +
      mergedColDimSize +
      mergedPaletteBytes.byteLength;

    const newBuf = new Uint8Array(totalSize);
    const newView = new DataView(newBuf.buffer, newBuf.byteOffset, newBuf.byteLength);

    // --- Write header ---
    newView.setUint32(0, newStartRow, true);
    newView.setUint32(4, newStartCol, true);
    newView.setUint32(8, newCellCount, true);
    newView.setUint32(12, mergedPaletteBytes.byteLength, true);
    newView.setUint32(16, mergedPoolSize, true);
    newView.setUint16(20, newRows, true);
    newView.setUint16(22, newCols, true);
    newView.setUint16(24, allMerges.length, true);
    newView.setUint16(26, mergedRowDims.length, true);
    newView.setUint16(28, mergedColDims.length, true);
    newView.setUint8(30, 0); // flags: not delta (merged result is a full buffer)
    newView.setUint8(31, this._generation); // keep same generation
    newView.setUint16(32, 0, true); // data_bar_count: 0 (CF extras not preserved in delta merge)
    newView.setUint16(34, 0, true); // icon_count: 0 (CF extras not preserved in delta merge)

    // --- Write cell records ---
    // For each cell in the new grid:
    //   - If it falls within the delta strip, copy from delta buffer
    //   - Else if it falls within old buffer, copy from old buffer (reuse string offsets)
    //   - Else write a null cell
    const newCellsStart = HEADER_SIZE;
    const existingStringPoolLen = this._stringPoolBytes;

    for (let localRow = 0; localRow < newRows; localRow++) {
      for (let localCol = 0; localCol < newCols; localCol++) {
        const absRow = newStartRow + localRow;
        const absCol = newStartCol + localCol;
        const newCellIdx = localRow * newCols + localCol;
        const newCellOff = newCellsStart + newCellIdx * CELL_STRIDE;

        // Check if cell is in delta strip
        const deltaLocalRow = absRow - deltaStartRow;
        const deltaLocalCol = absCol - deltaStartCol;
        const inDelta =
          deltaLocalRow >= 0 &&
          deltaLocalRow < deltaViewportRows &&
          deltaLocalCol >= 0 &&
          deltaLocalCol < deltaViewportCols;

        if (inDelta) {
          // Copy from delta buffer, rebasing string offsets
          const deltaCellIdx = deltaLocalRow * deltaViewportCols + deltaLocalCol;
          const deltaCellOff = HEADER_SIZE + deltaCellIdx * CELL_STRIDE;

          // Copy the 32-byte cell record
          newBuf.set(deltaBuffer.subarray(deltaCellOff, deltaCellOff + CELL_STRIDE), newCellOff);

          // Rebase string offsets: add existingStringPoolLen + overflowSize
          const displayOff = dv.getUint32(deltaCellOff + OFF_DISPLAY_OFF, true);
          if (displayOff !== NO_STRING) {
            newView.setUint32(
              newCellOff + OFF_DISPLAY_OFF,
              displayOff + existingStringPoolLen + overflowSize,
              true,
            );
          }
          const errorOff = dv.getUint32(deltaCellOff + OFF_ERROR_OFF, true);
          if (errorOff !== NO_STRING) {
            newView.setUint32(
              newCellOff + OFF_ERROR_OFF,
              errorOff + existingStringPoolLen + overflowSize,
              true,
            );
          }
        } else {
          // Check if cell is in old buffer
          const oldLocalRow = absRow - this._startRow;
          const oldLocalCol = absCol - this._startCol;
          const inOld =
            oldLocalRow >= 0 &&
            oldLocalRow < this._viewportRows &&
            oldLocalCol >= 0 &&
            oldLocalCol < this._viewportCols;

          if (inOld) {
            // Copy from old buffer (string offsets are already relative to existing pool)
            const oldCellIdx = oldLocalRow * this._viewportCols + oldLocalCol;
            const oldCellOff = this._cellsOffset + oldCellIdx * CELL_STRIDE;

            newBuf.set(this._buffer.subarray(oldCellOff, oldCellOff + CELL_STRIDE), newCellOff);
          } else {
            // Null cell: all zeros except NO_STRING sentinels
            // number_value: 0 (NaN would be better but 0 is fine for null)
            newView.setFloat64(newCellOff + OFF_NUMBER_VALUE, NaN, true);
            newView.setUint32(newCellOff + OFF_DISPLAY_OFF, NO_STRING, true);
            newView.setUint32(newCellOff + OFF_ERROR_OFF, NO_STRING, true);
            newView.setUint16(newCellOff + OFF_FLAGS, 0, true); // VALUE_TYPE_NULL
            newView.setUint16(newCellOff + OFF_FORMAT_IDX, 0, true);
            newView.setUint16(newCellOff + OFF_DISPLAY_LEN, 0, true);
            newView.setUint16(newCellOff + OFF_ERROR_LEN, 0, true);
            newView.setUint32(newCellOff + OFF_BG_COLOR_OVERRIDE, 0, true);
            newView.setUint32(newCellOff + OFF_FONT_COLOR_OVERRIDE, 0, true);
          }
        }
      }
    }

    // --- Write merged string pool ---
    const newPoolStart = newCellsStart + newCellCount * CELL_STRIDE;
    // First: existing main pool
    newBuf.set(existingPoolBytes, newPoolStart);
    // Second: overflow pool (mutation strings from old buffer)
    if (overflowBytes) {
      newBuf.set(overflowBytes, newPoolStart + existingStringPoolLen);
    }
    // Third: delta pool
    newBuf.set(deltaPoolBytes, newPoolStart + existingStringPoolLen + overflowSize);

    // --- Write merge records ---
    let off = newPoolStart + mergedPoolSize;
    for (const m of allMerges) {
      newView.setUint32(off, m.startRow, true);
      newView.setUint32(off + 4, m.startCol, true);
      newView.setUint32(off + 8, m.endRow, true);
      newView.setUint32(off + 12, m.endCol, true);
      off += MERGE_STRIDE;
    }

    // --- Write row dimensions ---
    for (const d of mergedRowDims) {
      newView.setUint32(off, d.row, true);
      newView.setFloat32(off + 4, d.height, true);
      newView.setUint32(off + 8, d.hidden ? 1 : 0, true);
      off += DIM_STRIDE;
    }

    // --- Write col dimensions ---
    for (const d of mergedColDims) {
      newView.setUint32(off, d.col, true);
      newView.setFloat32(off + 4, d.width, true);
      newView.setUint32(off + 8, d.hidden ? 1 : 0, true);
      off += DIM_STRIDE;
    }

    // --- Write format palette ---
    newBuf.set(mergedPaletteBytes, off);

    // --- Swap to new buffer ---
    this.setBuffer(newBuf);

    // Report delta-applied to devtools (setBuffer above already reports full-refresh)
    reportViewportBuffer({
      kind: 'delta-applied' as const,
      viewportId: 'main',
      patchCount: deltaCellCount,
      skippedOutOfBounds: 0,
      bufferBounds: {
        startRow: newStartRow,
        startCol: newStartCol,
        rows: newRows,
        cols: newCols,
      },
      generation: this._generation,
      overflowPoolBytes: 0,
    });
  }

  // -------------------------------------------------------------------
  // Visible window
  // -------------------------------------------------------------------

  /** Set the visible window bounds for overscan culling. */
  setVisibleWindow(bounds: ViewportBounds | null): void {
    this._visibleWindow = bounds;
  }

  /** Get the visible window bounds. */
  getVisibleWindow(): ViewportBounds | null {
    return this._visibleWindow;
  }

  /** Tag the buffer with its scroll behavior so the accessor knows which axes to gate. */
  setScrollBehavior(behavior: 'free' | 'horizontal-only' | 'vertical-only' | 'none'): void {
    this._scrollBehavior = behavior;
  }

  /** Get the scroll behavior. */
  getScrollBehavior(): 'free' | 'horizontal-only' | 'vertical-only' | 'none' {
    return this._scrollBehavior;
  }

  // -------------------------------------------------------------------
  // Internal access for CellAccessor
  // -------------------------------------------------------------------

  /** @internal DataView access for CellAccessor */
  get _dataView(): DataView | null {
    return this._view;
  }

  /** @internal Cells section start offset */
  get _cellsSectionOffset(): number {
    return this._cellsOffset;
  }

  // -------------------------------------------------------------------
  // CF extras access
  // -------------------------------------------------------------------

  /** Get data bar data for a cell by its dense cell index, or null if none. */
  getDataBar(cellIndex: number): DataBarData | null {
    return this._dataBars.get(cellIndex) ?? null;
  }

  /** Get icon data for a cell by its dense cell index, or null if none. */
  getIcon(cellIndex: number): IconData | null {
    return this._icons.get(cellIndex) ?? null;
  }

  /** @internal Clear all caches (for testing). */
  _clearCaches(): void {
    this._stringCache.clear();
    this._overflowPool = new Uint8Array(0);
    this._overflowSize = 0;
  }
}

// ---------------------------------------------------------------------------
// CellAccessor — flyweight for reading cell fields from the binary buffer
// ---------------------------------------------------------------------------

export class CellAccessor {
  // Decoded fields populated by moveTo()
  flags = 0;
  numberValue = 0;
  formatIdx = 0;

  private _displayOff = 0;
  private _displayLen = 0;
  private _errorOff = 0;
  private _errorLen = 0;
  private _bgColorOverride = 0;
  private _fontColorOverride = 0;
  private _cellIndex = -1;
  private _row = 0;
  private _col = 0;

  constructor(private _buffer: BinaryViewportBuffer) {}

  /**
   * Move the accessor to read the cell at (row, col).
   * Reads all 9 fixed fields from the DataView.
   * Returns false if the cell is out of bounds.
   */
  moveTo(row: number, col: number): boolean {
    // Guard against backward overscan leaking frozen cells into the main viewport.
    // Prefetch widens the buffer to (max(0, startRow-overscan), max(0, startCol-overscan)),
    // so the main buffer can hold cells from the frozen-rows / frozen-cols regions.
    // The visible window is set to the post-freeze visible range; cells below its
    // startRow/startCol are either frozen (belong to another viewport) or above
    // current scroll (still owned by this viewport but out of view).
    //
    // Gating policy (driven by scroll behavior set at viewport registration):
    //   'free' (main): gate both axes — bidirectional overscan can leak from any
    //     frozen pane. Tests query cells at row 0 / col 0 specifically (frozen),
    //     never in [frozenRows, vw.startRow) or [frozenCols, vw.startCol).
    //   'vertical-only' (frozen-cols): gate row only — corner can leak via vertical
    //     overscan; cells at col<vw.startCol are owned (don't gate).
    //   'horizontal-only' (frozen-rows): gate col only — corner can leak via
    //     horizontal overscan; cells at row<vw.startRow=0 are impossible.
    //   'none' (corner): no overscan, no leak; gate is a no-op.
    const vw = this._buffer.getVisibleWindow();
    if (vw) {
      // Row gate fires for any viewport with a non-zero vw.startRow — gates the
      // corner-leak case for frozen-cols (vertical overscan) and the frozen-row
      // leak for main. For frozen-rows/corner, vw.startRow is always 0, so no-op.
      if (row < vw.startRow) {
        this._cellIndex = -1;
        return false;
      }
      // Col gate is restricted to scrollBehavior='free' (main). For frozen-rows
      // ('horizontal-only'), vw.startCol moves with scroll and cells in
      // [frozenCols, vw.startCol) legitimately belong to this viewport (just out
      // of view), so we must not gate by vw.startCol there.
      if (col < vw.startCol && this._buffer.getScrollBehavior() === 'free') {
        this._cellIndex = -1;
        return false;
      }
    }

    const offset = this._buffer.cellOffset(row, col);
    if (offset < 0) {
      this._cellIndex = -1;
      return false;
    }

    const view = this._buffer._dataView;
    if (!view) {
      this._cellIndex = -1;
      return false;
    }

    this._row = row;
    this._col = col;
    this._cellIndex = this._buffer.cellIndex(row, col);

    // Read all 9 fixed fields from the 32-byte cell record
    this.numberValue = view.getFloat64(offset + OFF_NUMBER_VALUE, true);
    this._displayOff = view.getUint32(offset + OFF_DISPLAY_OFF, true);
    this._errorOff = view.getUint32(offset + OFF_ERROR_OFF, true);
    this.flags = view.getUint16(offset + OFF_FLAGS, true);
    this.formatIdx = view.getUint16(offset + OFF_FORMAT_IDX, true);
    this._displayLen = view.getUint16(offset + OFF_DISPLAY_LEN, true);
    this._errorLen = view.getUint16(offset + OFF_ERROR_LEN, true);
    this._bgColorOverride = view.getUint32(offset + OFF_BG_COLOR_OVERRIDE, true);
    this._fontColorOverride = view.getUint32(offset + OFF_FONT_COLOR_OVERRIDE, true);

    return true;
  }

  // -------------------------------------------------------------------
  // Flag bit accessors
  // -------------------------------------------------------------------

  /** Value type (bits 0-2): Null=0, Number=1, Text=2, Bool=3, Error=4 */
  get valueType(): number {
    return this.flags & 0x7;
  }

  /** Bit 3: owns formula text */
  get hasFormula(): boolean {
    return (this.flags & 0x8) !== 0;
  }

  /** Bit 4: has_comment */
  get hasComment(): boolean {
    return (this.flags & 0x10) !== 0;
  }

  /** Bit 5: has_sparkline */
  get hasSparkline(): boolean {
    return (this.flags & 0x20) !== 0;
  }

  /** Bit 6: has_hyperlink */
  get hasHyperlink(): boolean {
    return (this.flags & 0x40) !== 0;
  }

  /** Bit 7: is_checkbox */
  get isCheckbox(): boolean {
    return (this.flags & 0x80) !== 0;
  }

  /** Bit 8: is projected / spill-region member */
  get isProjectedPosition(): boolean {
    return (this.flags & 0x100) !== 0;
  }

  /** Bit 9: has_validation_error */
  get hasValidationError(): boolean {
    return (this.flags & 0x200) !== 0;
  }

  /** Bit 10: has_cf_extras (data bar and/or icon) */
  get hasCfExtras(): boolean {
    return (this.flags & 0x400) !== 0;
  }

  /** Bit 11: has structured in-cell image metadata. */
  get hasCellImage(): boolean {
    return (this.flags & HAS_CELL_IMAGE) !== 0;
  }

  // -------------------------------------------------------------------
  // Color override accessors
  // -------------------------------------------------------------------

  /** Get the CF background color override as "#RRGGBB", or null if no override (value is 0). */
  getBgColorOverride(): string | null {
    return this._bgColorOverride !== 0 ? rgbaU32ToHex(this._bgColorOverride) : null;
  }

  /** Get the CF font color override as "#RRGGBB", or null if no override (value is 0). */
  getFontColorOverride(): string | null {
    return this._fontColorOverride !== 0 ? rgbaU32ToHex(this._fontColorOverride) : null;
  }

  // -------------------------------------------------------------------
  // CF extras accessors
  // -------------------------------------------------------------------

  /** Get data bar data for the current cell, or null if none. */
  getDataBar(): DataBarData | null {
    if (this._cellIndex < 0) return null;
    return this._buffer.getDataBar(this._cellIndex);
  }

  /** Get icon data for the current cell, or null if none. */
  getIcon(): IconData | null {
    if (this._cellIndex < 0) return null;
    return this._buffer.getIcon(this._cellIndex);
  }

  // -------------------------------------------------------------------
  // Derived property accessors
  // -------------------------------------------------------------------

  /** Get the CellFormat for this cell from the palette. */
  get format(): CellFormat {
    return this._buffer.getFormatByIndex(this.formatIdx);
  }

  /**
   * Get the display text for the current cell.
   * Decodes from the string pool (main or overflow) with caching.
   * The coordinator ensures the base buffer always has correct strings —
   * binary mutations write into the overflow pool, and fetches replace
   * the entire buffer, so no overlay map check is needed.
   * Returns null if no display text.
   */
  get displayText(): FormattedText | null {
    const decoded = this._buffer.getOrDecodeString(this._displayOff, this._displayLen);
    return decoded !== null ? asFormattedText(decoded) : null;
  }

  /**
   * Get the error text for the current cell.
   * Lazily decodes from string pool. Returns null if no error.
   */
  get errorText(): string | null {
    return this._buffer.getOrDecodeString(this._errorOff, this._errorLen);
  }

  /** Structured image metadata for an in-cell image value. */
  getCellImage(): unknown | null {
    if (!this.hasCellImage && this.valueType !== VALUE_TYPE_IMAGE) return null;
    const metadata = this._buffer.getOrDecodeString(this._errorOff, this._errorLen);
    if (!metadata) return null;
    try {
      return JSON.parse(metadata);
    } catch {
      return null;
    }
  }

  /** Current row (set by moveTo). */
  get row(): number {
    return this._row;
  }

  /** Current col (set by moveTo). */
  get col(): number {
    return this._col;
  }

  /** Current cell index (set by moveTo). -1 if invalid. */
  get cellIndexValue(): number {
    return this._cellIndex;
  }

  // -------------------------------------------------------------------
  // Neighbor peek methods (random access without moving the cursor)
  // -------------------------------------------------------------------

  /**
   * Check if a cell at (row, col) is empty without moving the cursor.
   * Returns true if the cell has a null/empty value type, or is out of viewport bounds.
   */
  isCellEmpty(row: number, col: number): boolean {
    const offset = this._buffer.cellOffset(row, col);
    if (offset < 0) return true; // out of viewport = treat as empty (safe for overflow)
    const view = this._buffer._dataView;
    if (!view) return true;
    const flags = view.getUint16(offset + OFF_FLAGS, true);
    const valueType = flags & 0x7; // VALUE_TYPE_MASK
    // Null = 0 → empty. Text = 2 → check if display string is empty
    if (valueType === 0) return true;
    if (valueType === 2) {
      // Text cell — check if display text is empty string
      const displayLen = view.getUint16(offset + OFF_DISPLAY_LEN, true);
      return displayLen === 0;
    }
    return false; // Number, Bool, Error → not empty
  }

  /**
   * Peek at the format of a cell at (row, col) without moving the cursor.
   * Returns undefined if out of viewport bounds.
   */
  peekFormat(row: number, col: number): CellFormat | undefined {
    const offset = this._buffer.cellOffset(row, col);
    if (offset < 0) return undefined;
    const view = this._buffer._dataView;
    if (!view) return undefined;
    const formatIdx = view.getUint16(offset + OFF_FORMAT_IDX, true);
    return this._buffer.getFormatByIndex(formatIdx);
  }
}
