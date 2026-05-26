/**
 * palette-binary.ts — Binary encoder/decoder for format palettes.
 *
 * Replaces the previous JSON-based palette serialization with a compact
 * binary format. Used by BinaryViewportBuffer and BinaryMutationReader
 * to decode palette sections, and by applyDeltaViewport to re-encode
 * merged palettes.
 *
 * Binary Layout:
 *   [u16  start_index]
 *   [u16  format_count]
 *   [u32  string_pool_bytes]
 *   [FormatRecord x format_count]  (variable-size)
 *   [StringPool]                   (UTF-8 bytes)
 */

import type { CellBorders, CellFormat, GradientFill, GradientStop } from '@mog-sdk/contracts/core';

// Module-level singleton TextEncoder/TextDecoder — avoid per-call allocation
const sharedEncoder = new TextEncoder();
const sharedDecoder = new TextDecoder('utf-8');

// ---------------------------------------------------------------------------
// Presence-mask bit assignments (29 fields)
// ---------------------------------------------------------------------------

const BIT_FONT_FAMILY = 0;
const BIT_FONT_SIZE = 1;
const BIT_FONT_COLOR = 2;
const BIT_BOLD = 3;
const BIT_ITALIC = 4;
const BIT_UNDERLINE_TYPE = 5;
const BIT_STRIKETHROUGH = 6;
const BIT_SUPERSCRIPT = 7;
const BIT_SUBSCRIPT = 8;
const BIT_FONT_OUTLINE = 9;
const BIT_FONT_SHADOW = 10;
const BIT_FONT_THEME = 11;
const BIT_FONT_CHARSET = 12;
const BIT_FONT_FAMILY_TYPE = 13;
const BIT_HORIZONTAL_ALIGN = 14;
const BIT_VERTICAL_ALIGN = 15;
const BIT_WRAP_TEXT = 16;
const BIT_INDENT = 17;
const BIT_TEXT_ROTATION = 18;
const BIT_SHRINK_TO_FIT = 19;
const BIT_READING_ORDER = 20;
const BIT_NUMBER_FORMAT = 21;
const BIT_BACKGROUND_COLOR = 22;
const BIT_PATTERN_TYPE = 23;
const BIT_PATTERN_FOREGROUND_COLOR = 24;
const BIT_GRADIENT_FILL = 25;
const BIT_BORDERS = 26;
const BIT_LOCKED = 27;
const BIT_HIDDEN = 28;

// ---------------------------------------------------------------------------
// StrRef helpers
// ---------------------------------------------------------------------------

/** Read a StrRef (u32 offset + u16 length) and decode from the string pool. */
function readStrRef(view: DataView, off: number, poolStart: number, poolBuf: Uint8Array): string {
  const strOff = view.getUint32(off, true);
  const strLen = view.getUint16(off + 4, true);
  return sharedDecoder.decode(poolBuf.subarray(poolStart + strOff, poolStart + strOff + strLen));
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/**
 * Decode a binary palette section into start_index and CellFormat[].
 * @param view DataView over the full buffer
 * @param offset byte offset where the palette section starts
 * @param len total byte length of the palette section
 */
export function decodePaletteBinary(
  view: DataView,
  offset: number,
  len: number,
): { startIndex: number; formats: CellFormat[] } {
  if (len === 0) {
    return { startIndex: 0, formats: [] };
  }

  const startIndex = view.getUint16(offset, true);
  const formatCount = view.getUint16(offset + 2, true);
  const stringPoolBytes = view.getUint32(offset + 4, true);

  // String pool is at the end of the palette section
  const poolStart = offset + len - stringPoolBytes;
  const poolBuf = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

  const formats: CellFormat[] = new Array(formatCount);
  let cursor = offset + 8; // after header

  for (let i = 0; i < formatCount; i++) {
    const presenceLo = view.getUint32(cursor, true);
    cursor += 4;

    const fmt: Record<string, unknown> = {};

    // Bit 0: fontFamily (StrRef)
    if (presenceLo & (1 << BIT_FONT_FAMILY)) {
      fmt.fontFamily = readStrRef(view, cursor, poolStart, poolBuf);
      cursor += 6;
    }

    // Bit 1: fontSize (u32 millipoints -> points)
    if (presenceLo & (1 << BIT_FONT_SIZE)) {
      fmt.fontSize = view.getUint32(cursor, true) / 1000;
      cursor += 4;
    }

    // Bit 2: fontColor (StrRef)
    if (presenceLo & (1 << BIT_FONT_COLOR)) {
      fmt.fontColor = readStrRef(view, cursor, poolStart, poolBuf);
      cursor += 6;
    }

    // Bit 3: bold (u8)
    if (presenceLo & (1 << BIT_BOLD)) {
      fmt.bold = view.getUint8(cursor) !== 0;
      cursor += 1;
    }

    // Bit 4: italic (u8)
    if (presenceLo & (1 << BIT_ITALIC)) {
      fmt.italic = view.getUint8(cursor) !== 0;
      cursor += 1;
    }

    // Bit 5: underlineType (StrRef)
    if (presenceLo & (1 << BIT_UNDERLINE_TYPE)) {
      fmt.underlineType = readStrRef(view, cursor, poolStart, poolBuf);
      cursor += 6;
    }

    // Bit 6: strikethrough (u8)
    if (presenceLo & (1 << BIT_STRIKETHROUGH)) {
      fmt.strikethrough = view.getUint8(cursor) !== 0;
      cursor += 1;
    }

    // Bit 7: superscript (u8)
    if (presenceLo & (1 << BIT_SUPERSCRIPT)) {
      fmt.superscript = view.getUint8(cursor) !== 0;
      cursor += 1;
    }

    // Bit 8: subscript (u8)
    if (presenceLo & (1 << BIT_SUBSCRIPT)) {
      fmt.subscript = view.getUint8(cursor) !== 0;
      cursor += 1;
    }

    // Bit 9: fontOutline (u8)
    if (presenceLo & (1 << BIT_FONT_OUTLINE)) {
      fmt.fontOutline = view.getUint8(cursor) !== 0;
      cursor += 1;
    }

    // Bit 10: fontShadow (u8)
    if (presenceLo & (1 << BIT_FONT_SHADOW)) {
      fmt.fontShadow = view.getUint8(cursor) !== 0;
      cursor += 1;
    }

    // Bit 11: fontTheme (StrRef)
    if (presenceLo & (1 << BIT_FONT_THEME)) {
      fmt.fontTheme = readStrRef(view, cursor, poolStart, poolBuf);
      cursor += 6;
    }

    // Bit 12: fontCharset (u32)
    if (presenceLo & (1 << BIT_FONT_CHARSET)) {
      fmt.fontCharset = view.getUint32(cursor, true);
      cursor += 4;
    }

    // Bit 13: fontFamilyType (u32)
    if (presenceLo & (1 << BIT_FONT_FAMILY_TYPE)) {
      fmt.fontFamilyType = view.getUint32(cursor, true);
      cursor += 4;
    }

    // Bit 14: horizontalAlign (StrRef)
    if (presenceLo & (1 << BIT_HORIZONTAL_ALIGN)) {
      fmt.horizontalAlign = readStrRef(view, cursor, poolStart, poolBuf);
      cursor += 6;
    }

    // Bit 15: verticalAlign (StrRef)
    if (presenceLo & (1 << BIT_VERTICAL_ALIGN)) {
      fmt.verticalAlign = readStrRef(view, cursor, poolStart, poolBuf);
      cursor += 6;
    }

    // Bit 16: wrapText (u8)
    if (presenceLo & (1 << BIT_WRAP_TEXT)) {
      fmt.wrapText = view.getUint8(cursor) !== 0;
      cursor += 1;
    }

    // Bit 17: indent (u32)
    if (presenceLo & (1 << BIT_INDENT)) {
      fmt.indent = view.getUint32(cursor, true);
      cursor += 4;
    }

    // Bit 18: textRotation (i32)
    if (presenceLo & (1 << BIT_TEXT_ROTATION)) {
      fmt.textRotation = view.getInt32(cursor, true);
      cursor += 4;
    }

    // Bit 19: shrinkToFit (u8)
    if (presenceLo & (1 << BIT_SHRINK_TO_FIT)) {
      fmt.shrinkToFit = view.getUint8(cursor) !== 0;
      cursor += 1;
    }

    // Bit 20: readingOrder (StrRef)
    if (presenceLo & (1 << BIT_READING_ORDER)) {
      fmt.readingOrder = readStrRef(view, cursor, poolStart, poolBuf);
      cursor += 6;
    }

    // Bit 21: numberFormat (StrRef)
    if (presenceLo & (1 << BIT_NUMBER_FORMAT)) {
      fmt.numberFormat = readStrRef(view, cursor, poolStart, poolBuf);
      cursor += 6;
    }

    // Bit 22: backgroundColor (StrRef)
    if (presenceLo & (1 << BIT_BACKGROUND_COLOR)) {
      fmt.backgroundColor = readStrRef(view, cursor, poolStart, poolBuf);
      cursor += 6;
    }

    // Bit 23: patternType (StrRef)
    if (presenceLo & (1 << BIT_PATTERN_TYPE)) {
      fmt.patternType = readStrRef(view, cursor, poolStart, poolBuf);
      cursor += 6;
    }

    // Bit 24: patternForegroundColor (StrRef)
    if (presenceLo & (1 << BIT_PATTERN_FOREGROUND_COLOR)) {
      fmt.patternForegroundColor = readStrRef(view, cursor, poolStart, poolBuf);
      cursor += 6;
    }

    // Bit 25: gradientFill (GradientFillRecord)
    if (presenceLo & (1 << BIT_GRADIENT_FILL)) {
      cursor = decodeGradientFill(view, cursor, poolStart, poolBuf, fmt);
    }

    // Bit 26: borders (BordersRecord)
    if (presenceLo & (1 << BIT_BORDERS)) {
      cursor = decodeBorders(view, cursor, poolStart, poolBuf, fmt);
    }

    // Bit 27: locked (u8)
    if (presenceLo & (1 << BIT_LOCKED)) {
      fmt.locked = view.getUint8(cursor) !== 0;
      cursor += 1;
    }

    // Bit 28: hidden (u8)
    if (presenceLo & (1 << BIT_HIDDEN)) {
      fmt.hidden = view.getUint8(cursor) !== 0;
      cursor += 1;
    }

    formats[i] = fmt as CellFormat;
  }

  return { startIndex, formats };
}

/** Decode a GradientFillRecord at `cursor`, return new cursor position. */
function decodeGradientFill(
  view: DataView,
  cursor: number,
  poolStart: number,
  poolBuf: Uint8Array,
  fmt: Record<string, unknown>,
): number {
  const gradType = readStrRef(view, cursor, poolStart, poolBuf);
  cursor += 6;

  const subPresence = view.getUint8(cursor);
  cursor += 1;

  let degree: number | undefined;
  if (subPresence & 0x01) {
    degree = view.getFloat64(cursor, true);
    cursor += 8;
  }

  let center: { left: number; top: number } | undefined;
  if (subPresence & 0x02) {
    const left = view.getFloat64(cursor, true);
    cursor += 8;
    const top = view.getFloat64(cursor, true);
    cursor += 8;
    center = { left, top };
  }

  const stopCount = view.getUint16(cursor, true);
  cursor += 2;

  const stops: GradientStop[] = new Array(stopCount);
  for (let s = 0; s < stopCount; s++) {
    const position = view.getFloat64(cursor, true);
    cursor += 8;
    const color = readStrRef(view, cursor, poolStart, poolBuf);
    cursor += 6;
    stops[s] = { position, color };
  }

  const gf: GradientFill = { type: gradType as 'linear' | 'path', stops };
  if (degree !== undefined) gf.degree = degree;
  if (center !== undefined) gf.center = center;
  fmt.gradientFill = gf;

  return cursor;
}

/** Decode a BordersRecord at `cursor`, return new cursor position. */
function decodeBorders(
  view: DataView,
  cursor: number,
  poolStart: number,
  poolBuf: Uint8Array,
  fmt: Record<string, unknown>,
): number {
  const borderPresence = view.getUint16(cursor, true);
  cursor += 2;

  const borders: Record<string, unknown> = {};

  // Bits 0-4: border sides (top, right, bottom, left, diagonal)
  const sideNames = ['top', 'right', 'bottom', 'left', 'diagonal'];
  for (let b = 0; b < 5; b++) {
    if (borderPresence & (1 << b)) {
      const sidePresence = view.getUint8(cursor);
      cursor += 1;
      const side: Record<string, unknown> = {};
      if (sidePresence & 0x01) {
        side.style = readStrRef(view, cursor, poolStart, poolBuf);
        cursor += 6;
      }
      if (sidePresence & 0x02) {
        side.color = readStrRef(view, cursor, poolStart, poolBuf);
        cursor += 6;
      }
      borders[sideNames[b]] = side;
    }
  }

  // Bit 5: diagonalUp (bool, u8)
  if (borderPresence & (1 << 5)) {
    borders.diagonalUp = view.getUint8(cursor) !== 0;
    cursor += 1;
  }

  // Bit 6: diagonalDown (bool, u8)
  if (borderPresence & (1 << 6)) {
    borders.diagonalDown = view.getUint8(cursor) !== 0;
    cursor += 1;
  }

  // Bits 7-8: vertical, horizontal (CellBorderSide)
  const internalNames = ['vertical', 'horizontal'];
  for (let b = 0; b < 2; b++) {
    if (borderPresence & (1 << (7 + b))) {
      const sidePresence = view.getUint8(cursor);
      cursor += 1;
      const side: Record<string, unknown> = {};
      if (sidePresence & 0x01) {
        side.style = readStrRef(view, cursor, poolStart, poolBuf);
        cursor += 6;
      }
      if (sidePresence & 0x02) {
        side.color = readStrRef(view, cursor, poolStart, poolBuf);
        cursor += 6;
      }
      borders[internalNames[b]] = side;
    }
  }

  // Bit 9: outline (bool, u8)
  if (borderPresence & (1 << 9)) {
    borders.outline = view.getUint8(cursor) !== 0;
    cursor += 1;
  }

  fmt.borders = borders as CellBorders;
  return cursor;
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/**
 * Encode a palette into binary bytes (needed for delta merge in applyDeltaViewport).
 * @param startIndex first format index
 * @param formats array of CellFormat objects
 */
export function encodePaletteBinary(startIndex: number, formats: CellFormat[]): Uint8Array {
  if (formats.length === 0) {
    return new Uint8Array(0);
  }

  // String pool with deduplication
  const stringMap = new Map<string, { offset: number; length: number }>();
  const poolParts: Uint8Array[] = [];
  let poolSize = 0;

  function internString(s: string): { offset: number; length: number } {
    const existing = stringMap.get(s);
    if (existing) return existing;
    const encoded = sharedEncoder.encode(s);
    const entry = { offset: poolSize, length: encoded.byteLength };
    stringMap.set(s, entry);
    poolParts.push(encoded);
    poolSize += encoded.byteLength;
    return entry;
  }

  // First pass: compute all format record bytes
  const recordBuffers: Uint8Array[] = [];
  let totalRecordBytes = 0;

  for (const fmt of formats) {
    const recBuf = encodeFormatRecord(fmt as Record<string, unknown>, internString);
    recordBuffers.push(recBuf);
    totalRecordBytes += recBuf.byteLength;
  }

  // Allocate final buffer: header(8) + records + string pool
  const totalSize = 8 + totalRecordBytes + poolSize;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Write header
  view.setUint16(0, startIndex, true);
  view.setUint16(2, formats.length, true);
  view.setUint32(4, poolSize, true);

  // Write records
  let off = 8;
  for (const rec of recordBuffers) {
    buffer.set(rec, off);
    off += rec.byteLength;
  }

  // Write string pool
  for (const part of poolParts) {
    buffer.set(part, off);
    off += part.byteLength;
  }

  return buffer;
}

/** Encode a single CellFormat into a FormatRecord byte array. */
function encodeFormatRecord(
  fmt: Record<string, unknown>,
  internString: (s: string) => { offset: number; length: number },
): Uint8Array {
  // Worst case: 4 (presence) + 29 fields * max ~30 bytes each — generously overallocate
  // We'll use a growable approach with a reasonable initial size
  const tmp = new Uint8Array(512);
  const tmpView = new DataView(tmp.buffer, tmp.byteOffset, tmp.byteLength);
  let cursor = 4; // skip presence mask, write it last
  let presence = 0;

  function writeStrRef(s: string): void {
    const ref = internString(s);
    tmpView.setUint32(cursor, ref.offset, true);
    cursor += 4;
    tmpView.setUint16(cursor, ref.length, true);
    cursor += 2;
  }

  function writeBool(val: boolean): void {
    tmpView.setUint8(cursor, val ? 1 : 0);
    cursor += 1;
  }

  // Bit 0: fontFamily
  if (fmt.fontFamily !== undefined && fmt.fontFamily !== null) {
    presence |= 1 << BIT_FONT_FAMILY;
    writeStrRef(fmt.fontFamily as string);
  }

  // Bit 1: fontSize (points -> millipoints)
  if (fmt.fontSize !== undefined && fmt.fontSize !== null) {
    presence |= 1 << BIT_FONT_SIZE;
    tmpView.setUint32(cursor, Math.round((fmt.fontSize as number) * 1000), true);
    cursor += 4;
  }

  // Bit 2: fontColor
  if (fmt.fontColor !== undefined && fmt.fontColor !== null) {
    presence |= 1 << BIT_FONT_COLOR;
    writeStrRef(fmt.fontColor as string);
  }

  // Bit 3: bold
  if (fmt.bold !== undefined && fmt.bold !== null) {
    presence |= 1 << BIT_BOLD;
    writeBool(fmt.bold as boolean);
  }

  // Bit 4: italic
  if (fmt.italic !== undefined && fmt.italic !== null) {
    presence |= 1 << BIT_ITALIC;
    writeBool(fmt.italic as boolean);
  }

  // Bit 5: underlineType
  if (fmt.underlineType !== undefined && fmt.underlineType !== null) {
    presence |= 1 << BIT_UNDERLINE_TYPE;
    writeStrRef(fmt.underlineType as string);
  }

  // Bit 6: strikethrough
  if (fmt.strikethrough !== undefined && fmt.strikethrough !== null) {
    presence |= 1 << BIT_STRIKETHROUGH;
    writeBool(fmt.strikethrough as boolean);
  }

  // Bit 7: superscript
  if (fmt.superscript !== undefined && fmt.superscript !== null) {
    presence |= 1 << BIT_SUPERSCRIPT;
    writeBool(fmt.superscript as boolean);
  }

  // Bit 8: subscript
  if (fmt.subscript !== undefined && fmt.subscript !== null) {
    presence |= 1 << BIT_SUBSCRIPT;
    writeBool(fmt.subscript as boolean);
  }

  // Bit 9: fontOutline
  if (fmt.fontOutline !== undefined && fmt.fontOutline !== null) {
    presence |= 1 << BIT_FONT_OUTLINE;
    writeBool(fmt.fontOutline as boolean);
  }

  // Bit 10: fontShadow
  if (fmt.fontShadow !== undefined && fmt.fontShadow !== null) {
    presence |= 1 << BIT_FONT_SHADOW;
    writeBool(fmt.fontShadow as boolean);
  }

  // Bit 11: fontTheme
  if (fmt.fontTheme !== undefined && fmt.fontTheme !== null) {
    presence |= 1 << BIT_FONT_THEME;
    writeStrRef(fmt.fontTheme as string);
  }

  // Bit 12: fontCharset
  if (fmt.fontCharset !== undefined && fmt.fontCharset !== null) {
    presence |= 1 << BIT_FONT_CHARSET;
    tmpView.setUint32(cursor, fmt.fontCharset as number, true);
    cursor += 4;
  }

  // Bit 13: fontFamilyType
  if (fmt.fontFamilyType !== undefined && fmt.fontFamilyType !== null) {
    presence |= 1 << BIT_FONT_FAMILY_TYPE;
    tmpView.setUint32(cursor, fmt.fontFamilyType as number, true);
    cursor += 4;
  }

  // Bit 14: horizontalAlign
  if (fmt.horizontalAlign !== undefined && fmt.horizontalAlign !== null) {
    presence |= 1 << BIT_HORIZONTAL_ALIGN;
    writeStrRef(fmt.horizontalAlign as string);
  }

  // Bit 15: verticalAlign
  if (fmt.verticalAlign !== undefined && fmt.verticalAlign !== null) {
    presence |= 1 << BIT_VERTICAL_ALIGN;
    writeStrRef(fmt.verticalAlign as string);
  }

  // Bit 16: wrapText
  if (fmt.wrapText !== undefined && fmt.wrapText !== null) {
    presence |= 1 << BIT_WRAP_TEXT;
    writeBool(fmt.wrapText as boolean);
  }

  // Bit 17: indent
  if (fmt.indent !== undefined && fmt.indent !== null) {
    presence |= 1 << BIT_INDENT;
    tmpView.setUint32(cursor, fmt.indent as number, true);
    cursor += 4;
  }

  // Bit 18: textRotation
  if (fmt.textRotation !== undefined && fmt.textRotation !== null) {
    presence |= 1 << BIT_TEXT_ROTATION;
    tmpView.setInt32(cursor, fmt.textRotation as number, true);
    cursor += 4;
  }

  // Bit 19: shrinkToFit
  if (fmt.shrinkToFit !== undefined && fmt.shrinkToFit !== null) {
    presence |= 1 << BIT_SHRINK_TO_FIT;
    writeBool(fmt.shrinkToFit as boolean);
  }

  // Bit 20: readingOrder
  if (fmt.readingOrder !== undefined && fmt.readingOrder !== null) {
    presence |= 1 << BIT_READING_ORDER;
    writeStrRef(fmt.readingOrder as string);
  }

  // Bit 21: numberFormat
  if (fmt.numberFormat !== undefined && fmt.numberFormat !== null) {
    presence |= 1 << BIT_NUMBER_FORMAT;
    writeStrRef(fmt.numberFormat as string);
  }

  // Bit 22: backgroundColor
  if (fmt.backgroundColor !== undefined && fmt.backgroundColor !== null) {
    presence |= 1 << BIT_BACKGROUND_COLOR;
    writeStrRef(fmt.backgroundColor as string);
  }

  // Bit 23: patternType
  if (fmt.patternType !== undefined && fmt.patternType !== null) {
    presence |= 1 << BIT_PATTERN_TYPE;
    writeStrRef(fmt.patternType as string);
  }

  // Bit 24: patternForegroundColor
  if (fmt.patternForegroundColor !== undefined && fmt.patternForegroundColor !== null) {
    presence |= 1 << BIT_PATTERN_FOREGROUND_COLOR;
    writeStrRef(fmt.patternForegroundColor as string);
  }

  // Bit 25: gradientFill
  if (fmt.gradientFill !== undefined && fmt.gradientFill !== null) {
    presence |= 1 << BIT_GRADIENT_FILL;
    cursor = encodeGradientFill(tmpView, cursor, fmt.gradientFill as GradientFill, internString);
  }

  // Bit 26: borders
  if (fmt.borders !== undefined && fmt.borders !== null) {
    presence |= 1 << BIT_BORDERS;
    cursor = encodeBorders(tmpView, cursor, fmt.borders as CellBorders, internString);
  }

  // Bit 27: locked
  if (fmt.locked !== undefined && fmt.locked !== null) {
    presence |= 1 << BIT_LOCKED;
    writeBool(fmt.locked as boolean);
  }

  // Bit 28: hidden
  if (fmt.hidden !== undefined && fmt.hidden !== null) {
    presence |= 1 << BIT_HIDDEN;
    writeBool(fmt.hidden as boolean);
  }

  // Write presence mask at offset 0
  tmpView.setUint32(0, presence, true);

  return tmp.slice(0, cursor);
}

/** Encode a GradientFill into the buffer at `cursor`. Returns new cursor. */
function encodeGradientFill(
  view: DataView,
  cursor: number,
  gf: GradientFill,
  internString: (s: string) => { offset: number; length: number },
): number {
  // gradient_type StrRef
  const typeRef = internString(gf.type);
  view.setUint32(cursor, typeRef.offset, true);
  cursor += 4;
  view.setUint16(cursor, typeRef.length, true);
  cursor += 2;

  // sub_presence
  let subPresence = 0;
  if (gf.degree !== undefined && gf.degree !== null) subPresence |= 0x01;
  if (gf.center !== undefined && gf.center !== null) subPresence |= 0x02;
  view.setUint8(cursor, subPresence);
  cursor += 1;

  if (subPresence & 0x01) {
    view.setFloat64(cursor, gf.degree!, true);
    cursor += 8;
  }

  if (subPresence & 0x02) {
    view.setFloat64(cursor, gf.center!.left, true);
    cursor += 8;
    view.setFloat64(cursor, gf.center!.top, true);
    cursor += 8;
  }

  // stops
  view.setUint16(cursor, gf.stops.length, true);
  cursor += 2;

  for (const stop of gf.stops) {
    view.setFloat64(cursor, stop.position, true);
    cursor += 8;
    const colorRef = internString(stop.color);
    view.setUint32(cursor, colorRef.offset, true);
    cursor += 4;
    view.setUint16(cursor, colorRef.length, true);
    cursor += 2;
  }

  return cursor;
}

/** Encode a CellBorders into the buffer at `cursor`. Returns new cursor. */
function encodeBorders(
  view: DataView,
  cursor: number,
  borders: CellBorders,
  internString: (s: string) => { offset: number; length: number },
): number {
  const presenceOffset = cursor;
  cursor += 2; // reserve space for border_presence u16
  let borderPresence = 0;

  // Bits 0-4: border sides
  const sides: Array<{ style?: string; color?: string } | undefined> = [
    borders.top,
    borders.right,
    borders.bottom,
    borders.left,
    borders.diagonal,
  ];

  for (let b = 0; b < 5; b++) {
    const side = sides[b];
    if (side !== undefined && side !== null) {
      borderPresence |= 1 << b;
      let sidePresence = 0;
      const sidePresenceOffset = cursor;
      cursor += 1; // reserve for side_presence u8

      if (side.style !== undefined && side.style !== null) {
        sidePresence |= 0x01;
        const ref = internString(side.style);
        view.setUint32(cursor, ref.offset, true);
        cursor += 4;
        view.setUint16(cursor, ref.length, true);
        cursor += 2;
      }
      if (side.color !== undefined && side.color !== null) {
        sidePresence |= 0x02;
        const ref = internString(side.color);
        view.setUint32(cursor, ref.offset, true);
        cursor += 4;
        view.setUint16(cursor, ref.length, true);
        cursor += 2;
      }

      view.setUint8(sidePresenceOffset, sidePresence);
    }
  }

  // Bit 5: diagonalUp
  if (borders.diagonalUp !== undefined && borders.diagonalUp !== null) {
    borderPresence |= 1 << 5;
    view.setUint8(cursor, borders.diagonalUp ? 1 : 0);
    cursor += 1;
  }

  // Bit 6: diagonalDown
  if (borders.diagonalDown !== undefined && borders.diagonalDown !== null) {
    borderPresence |= 1 << 6;
    view.setUint8(cursor, borders.diagonalDown ? 1 : 0);
    cursor += 1;
  }

  // Bits 7-8: vertical, horizontal
  const internalSides: Array<{ style?: string; color?: string } | undefined> = [
    borders.vertical,
    borders.horizontal,
  ];

  for (let b = 0; b < 2; b++) {
    const side = internalSides[b];
    if (side !== undefined && side !== null) {
      borderPresence |= 1 << (7 + b);
      let sidePresence = 0;
      const sidePresenceOffset = cursor;
      cursor += 1;

      if (side.style !== undefined && side.style !== null) {
        sidePresence |= 0x01;
        const ref = internString(side.style);
        view.setUint32(cursor, ref.offset, true);
        cursor += 4;
        view.setUint16(cursor, ref.length, true);
        cursor += 2;
      }
      if (side.color !== undefined && side.color !== null) {
        sidePresence |= 0x02;
        const ref = internString(side.color);
        view.setUint32(cursor, ref.offset, true);
        cursor += 4;
        view.setUint16(cursor, ref.length, true);
        cursor += 2;
      }

      view.setUint8(sidePresenceOffset, sidePresence);
    }
  }

  // Bit 9: outline
  if (borders.outline !== undefined && borders.outline !== null) {
    borderPresence |= 1 << 9;
    view.setUint8(cursor, borders.outline ? 1 : 0);
    cursor += 1;
  }

  // Write border_presence back
  view.setUint16(presenceOffset, borderPresence, true);

  return cursor;
}
