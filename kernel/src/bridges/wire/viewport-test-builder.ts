/**
 * viewport-test-builder.ts — Constructs binary viewport buffers in pure
 * TypeScript for testing.
 *
 * Usage:
 *   const buf = buildTestViewportBuffer({ rows: 3, cols: 4, cells: [...] });
 *   const vb = new BinaryViewportBuffer();
 *   vb.setBuffer(buf);
 */

import type { CellFormat } from '@mog-sdk/contracts/core';
import { encodePaletteBinary } from './palette-binary';
import {
  CELL_STRIDE,
  DIM_STRIDE,
  HEADER_SIZE,
  MERGE_STRIDE,
  NO_STRING,
  OFF_BG_COLOR_OVERRIDE,
  OFF_FONT_COLOR_OVERRIDE,
} from './binary-viewport-buffer';

// Module-level singleton TextEncoder
const sharedEncoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface TestCell {
  display?: string;
  error?: string;
  formatIdx?: number;
  flags?: number;
  numberValue?: number;
  bgColorOverride?: number;
  fontColorOverride?: number;
}

export interface TestMerge {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface TestRowDimension {
  row: number;
  height: number;
  hidden?: boolean;
}

export interface TestColDimension {
  col: number;
  width: number;
  hidden?: boolean;
}

export interface TestViewportOptions {
  rows: number;
  cols: number;
  startRow?: number;
  startCol?: number;
  /** Row-major cell data. Missing entries are filled with empty cells. */
  cells?: TestCell[];
  palette?: CellFormat[];
  paletteStartIndex?: number;
  merges?: TestMerge[];
  rowDimensions?: TestRowDimension[];
  colDimensions?: TestColDimension[];
  rowPositions?: number[];
  colPositions?: number[];
  generation?: number;
  isDelta?: boolean;
  protocolVersion?: number;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a binary viewport buffer following the exact protocol specification.
 *
 * Sections in order:
 *   1. Header (36 bytes)
 *   2. Cell records (cellCount * 32 bytes)
 *   3. String pool (packed UTF-8)
 *   4. Merge records (mergeCount * 16 bytes)
 *   5. Row dimensions (rowDimCount * 12 bytes)
 *   6. Col dimensions (colDimCount * 12 bytes)
 *   7. Format palette (JSON-encoded)
 */
export function buildTestViewportBuffer(options: TestViewportOptions): Uint8Array {
  const {
    rows,
    cols,
    startRow = 0,
    startCol = 0,
    cells = [],
    palette = [],
    paletteStartIndex = 0,
    merges = [],
    rowDimensions = [],
    colDimensions = [],
    rowPositions = [],
    colPositions = [],
    generation = 0,
    isDelta = false,
    protocolVersion = 0,
  } = options;

  const cellCount = rows * cols;

  // -----------------------------------------------------------------------
  // Build the string pool and resolve cell string offsets
  // -----------------------------------------------------------------------

  const stringPoolParts: Uint8Array[] = [];
  let stringPoolSize = 0;

  // For each cell, record (displayOff, displayLen, errorOff, errorLen)
  const cellStringInfo: Array<{
    displayOff: number;
    displayLen: number;
    errorOff: number;
    errorLen: number;
  }> = new Array(cellCount);

  for (let i = 0; i < cellCount; i++) {
    const cell = cells[i];
    let displayOff = NO_STRING;
    let displayLen = 0;
    let errorOff = NO_STRING;
    let errorLen = 0;

    if (cell?.display !== undefined && cell.display !== null) {
      const encoded = sharedEncoder.encode(cell.display);
      displayOff = stringPoolSize;
      displayLen = encoded.byteLength;
      stringPoolParts.push(encoded);
      stringPoolSize += encoded.byteLength;
    }

    if (cell?.error !== undefined && cell.error !== null) {
      const encoded = sharedEncoder.encode(cell.error);
      errorOff = stringPoolSize;
      errorLen = encoded.byteLength;
      stringPoolParts.push(encoded);
      stringPoolSize += encoded.byteLength;
    }

    cellStringInfo[i] = { displayOff, displayLen, errorOff, errorLen };
  }

  // -----------------------------------------------------------------------
  // Build the format palette binary
  // -----------------------------------------------------------------------

  const paletteBytes = encodePaletteBinary(paletteStartIndex, palette);

  // -----------------------------------------------------------------------
  // Compute total buffer size and allocate
  // -----------------------------------------------------------------------

  const cellsSize = cellCount * CELL_STRIDE;
  const mergesSize = merges.length * MERGE_STRIDE;
  const rowDimSize = rowDimensions.length * DIM_STRIDE;
  const colDimSize = colDimensions.length * DIM_STRIDE;

  const totalSize =
    HEADER_SIZE +
    cellsSize +
    stringPoolSize +
    mergesSize +
    rowDimSize +
    colDimSize +
    paletteBytes.byteLength +
    rowPositions.length * 8 +
    colPositions.length * 8;

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // -----------------------------------------------------------------------
  // Write header (36 bytes)
  // -----------------------------------------------------------------------

  const flagsByte = ((protocolVersion & 0xf) << 4) | (isDelta ? 0x1 : 0x0);

  view.setUint32(0, startRow, true);
  view.setUint32(4, startCol, true);
  view.setUint32(8, cellCount, true);
  view.setUint32(12, paletteBytes.byteLength, true);
  view.setUint32(16, stringPoolSize, true);
  view.setUint16(20, rows, true);
  view.setUint16(22, cols, true);
  view.setUint16(24, merges.length, true);
  view.setUint16(26, rowDimensions.length, true);
  view.setUint16(28, colDimensions.length, true);
  view.setUint8(30, flagsByte);
  view.setUint8(31, generation);
  view.setUint16(32, 0, true); // data_bar_count (test builder doesn't write CF extras)
  view.setUint16(34, 0, true); // icon_count

  // -----------------------------------------------------------------------
  // Write cell records (32 bytes each, dense row-major)
  // -----------------------------------------------------------------------

  let cellOffset = HEADER_SIZE;
  for (let i = 0; i < cellCount; i++) {
    const cell = cells[i];
    const info = cellStringInfo[i];

    view.setFloat64(cellOffset + 0, cell?.numberValue ?? NaN, true);
    view.setUint32(cellOffset + 8, info.displayOff, true);
    view.setUint32(cellOffset + 12, info.errorOff, true);
    view.setUint16(cellOffset + 16, cell?.flags ?? 0, true);
    view.setUint16(cellOffset + 18, cell?.formatIdx ?? 0, true);
    view.setUint16(cellOffset + 20, info.displayLen, true);
    view.setUint16(cellOffset + 22, info.errorLen, true);
    view.setUint32(cellOffset + OFF_BG_COLOR_OVERRIDE, cell?.bgColorOverride ?? 0, true);
    view.setUint32(cellOffset + OFF_FONT_COLOR_OVERRIDE, cell?.fontColorOverride ?? 0, true);

    cellOffset += CELL_STRIDE;
  }

  // -----------------------------------------------------------------------
  // Write string pool
  // -----------------------------------------------------------------------

  let poolOffset = HEADER_SIZE + cellsSize;
  for (const part of stringPoolParts) {
    buffer.set(part, poolOffset);
    poolOffset += part.byteLength;
  }

  // -----------------------------------------------------------------------
  // Write merge records (16 bytes each)
  // -----------------------------------------------------------------------

  let mergeOffset = poolOffset;
  for (const m of merges) {
    view.setUint32(mergeOffset, m.startRow, true);
    view.setUint32(mergeOffset + 4, m.startCol, true);
    view.setUint32(mergeOffset + 8, m.endRow, true);
    view.setUint32(mergeOffset + 12, m.endCol, true);
    mergeOffset += MERGE_STRIDE;
  }

  // -----------------------------------------------------------------------
  // Write row dimensions (12 bytes each)
  // -----------------------------------------------------------------------

  let rowDimOffset = mergeOffset;
  for (const rd of rowDimensions) {
    view.setUint32(rowDimOffset, rd.row, true);
    view.setFloat32(rowDimOffset + 4, rd.height, true);
    view.setUint32(rowDimOffset + 8, rd.hidden ? 1 : 0, true);
    rowDimOffset += DIM_STRIDE;
  }

  // -----------------------------------------------------------------------
  // Write col dimensions (12 bytes each)
  // -----------------------------------------------------------------------

  let colDimOffset = rowDimOffset;
  for (const cd of colDimensions) {
    view.setUint32(colDimOffset, cd.col, true);
    view.setFloat32(colDimOffset + 4, cd.width, true);
    view.setUint32(colDimOffset + 8, cd.hidden ? 1 : 0, true);
    colDimOffset += DIM_STRIDE;
  }

  // -----------------------------------------------------------------------
  // Write format palette JSON
  // -----------------------------------------------------------------------

  if (paletteBytes.byteLength > 0) {
    buffer.set(paletteBytes, colDimOffset);
  }

  let positionOffset = colDimOffset + paletteBytes.byteLength;
  for (const pos of rowPositions) {
    view.setFloat64(positionOffset, pos, true);
    positionOffset += 8;
  }
  for (const pos of colPositions) {
    view.setFloat64(positionOffset, pos, true);
    positionOffset += 8;
  }

  return buffer;
}
