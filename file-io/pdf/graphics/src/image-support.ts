/**
 * Image Support — JPEG and PNG parsing, alpha separation, and deduplication.
 *
 * Provides utilities for:
 * - Parsing image dimensions from JPEG (SOF0/SOF2) and PNG (IHDR) headers
 * - Detecting PNG alpha channels
 * - Image deduplication via data hashing
 * - ContentOp generation for image placement
 */

import type { ContentOp } from './content-ops';

/**
 * Parsed image information.
 */
export interface ImageInfo {
  /** Raw image data. */
  data: Uint8Array;
  /** Image format. */
  format: 'jpeg' | 'png';
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** Whether the image has an alpha channel. */
  hasAlpha: boolean;
}

/**
 * Parse image dimensions and alpha information from raw image data.
 *
 * @param data Raw image bytes
 * @param format Image format ('jpeg' or 'png')
 * @returns Parsed dimensions and alpha flag
 * @throws Error if image data is malformed or too short
 */
export function parseImageDimensions(
  data: Uint8Array,
  format: 'jpeg' | 'png',
): { width: number; height: number; hasAlpha: boolean } {
  if (format === 'jpeg') {
    return parseJpegDimensions(data);
  } else {
    return parsePngDimensions(data);
  }
}

/**
 * Parse JPEG dimensions by finding SOF0 (0xFFC0) or SOF2 (0xFFC2) marker.
 *
 * JPEG marker structure:
 * - 0xFF 0xD8 — SOI (start of image)
 * - 0xFF <marker> <length_high> <length_low> <data...>
 * - SOF0/SOF2 data: precision(1) height(2) width(2)
 */
function parseJpegDimensions(data: Uint8Array): {
  width: number;
  height: number;
  hasAlpha: boolean;
} {
  if (data.length < 4) {
    throw new Error('JPEG data too short');
  }

  // Verify JPEG SOI marker
  if (data[0] !== 0xff || data[1] !== 0xd8) {
    throw new Error('Not a valid JPEG: missing SOI marker');
  }

  let offset = 2;

  while (offset < data.length - 1) {
    // Find next marker
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = data[offset + 1];

    // Skip padding bytes (0xFF)
    if (marker === 0xff) {
      offset++;
      continue;
    }

    // Skip RST markers and standalone markers
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    // SOF markers: 0xC0-0xCF (except 0xC4=DHT, 0xC8=JPG, 0xCC=DAC)
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSOF) {
      if (offset + 9 >= data.length) {
        throw new Error('JPEG SOF marker truncated');
      }
      // SOF data: length(2) + precision(1) + height(2) + width(2)
      const height = (data[offset + 5] << 8) | data[offset + 6];
      const width = (data[offset + 7] << 8) | data[offset + 8];
      return { width, height, hasAlpha: false }; // JPEG never has alpha
    }

    // Skip this marker segment
    if (offset + 3 >= data.length) break;
    const segmentLength = (data[offset + 2] << 8) | data[offset + 3];
    offset += 2 + segmentLength;
  }

  throw new Error('JPEG: no SOF marker found');
}

/**
 * Parse PNG dimensions and alpha from IHDR chunk.
 *
 * PNG structure:
 * - 8-byte signature: 137 80 78 71 13 10 26 10
 * - Chunks: length(4) type(4) data(length) crc(4)
 * - IHDR (first chunk): width(4) height(4) bitDepth(1) colorType(1) ...
 *
 * Color types with alpha:
 * - 4 = grayscale + alpha
 * - 6 = truecolor + alpha
 */
function parsePngDimensions(data: Uint8Array): {
  width: number;
  height: number;
  hasAlpha: boolean;
} {
  if (data.length < 24) {
    throw new Error('PNG data too short');
  }

  // Verify PNG signature
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (data[i] !== signature[i]) {
      throw new Error('Not a valid PNG: incorrect signature');
    }
  }

  // First chunk should be IHDR at offset 8
  // Chunk: length(4) + type(4) + data(length) + crc(4)
  const chunkType = String.fromCharCode(data[12], data[13], data[14], data[15]);
  if (chunkType !== 'IHDR') {
    throw new Error('PNG: first chunk is not IHDR');
  }

  // IHDR data starts at offset 16
  const width = readUint32BE(data, 16);
  const height = readUint32BE(data, 20);
  const colorType = data[25];

  // Color type 4 = grayscale+alpha, 6 = truecolor+alpha
  const hasAlpha = colorType === 4 || colorType === 6;

  return { width, height, hasAlpha };
}

/**
 * Read a big-endian uint32 from a byte array.
 */
function readUint32BE(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  ); // >>> 0 to ensure unsigned
}

/**
 * Compute a simple hash string for image data (for deduplication).
 * Uses a fast 32-bit FNV-1a hash.
 */
export function computeImageHash(data: Uint8Array): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Convert to unsigned hex string
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Image deduplication cache. Same image data maps to a single resource name.
 */
export class ImageCache {
  private _images: Map<string, { name: string; info: ImageInfo }> = new Map();
  private _nextId = 0;

  /**
   * Register an image and get its resource name.
   * If the same data was already registered, returns the existing resource name.
   */
  register(data: Uint8Array, format: 'jpeg' | 'png'): { name: string; info: ImageInfo } {
    const hash = computeImageHash(data);
    const existing = this._images.get(hash);
    if (existing) return existing;

    const dims = parseImageDimensions(data, format);
    const info: ImageInfo = {
      data: new Uint8Array(data),
      format,
      width: dims.width,
      height: dims.height,
      hasAlpha: dims.hasAlpha,
    };

    const name = `Im${this._nextId++}`;
    const entry = { name, info };
    this._images.set(hash, entry);
    return entry;
  }

  /** Get all registered images. */
  getAll(): Array<{ name: string; info: ImageInfo }> {
    return Array.from(this._images.values());
  }

  /** Get the count of unique images. */
  get size(): number {
    return this._images.size;
  }

  /** Clear the cache. */
  clear(): void {
    this._images.clear();
    this._nextId = 0;
  }
}

/**
 * Generate ContentOps for placing an image at the given position and size.
 *
 * In PDF, images are placed via PaintXObject with a transform matrix that
 * maps from the 1×1 image space to the target position and size.
 *
 * The transform matrix is: [w 0 0 h x y]
 */
export function generateImagePlacementOps(
  resourceName: string,
  x: number,
  y: number,
  w: number,
  h: number,
): ContentOp[] {
  return [
    { op: 'SaveState' },
    { op: 'ConcatMatrix', a: w, b: 0, c: 0, d: h, tx: x, ty: y },
    { op: 'DrawImage', data: [], format: resourceName, x: 0, y: 0, w: 1, h: 1 },
    { op: 'RestoreState' },
  ];
}

/**
 * Create a minimal valid JPEG byte array for testing.
 * Contains SOI, SOF0 with the given dimensions, and EOI.
 */
export function createTestJpeg(width: number, height: number): Uint8Array {
  // SOI + APP0 (minimal) + SOF0 + EOI
  const sof0Data = [
    0xff,
    0xc0, // SOF0 marker
    0x00,
    0x0b, // Length (11 bytes)
    0x08, // Precision (8 bits)
    (height >> 8) & 0xff,
    height & 0xff, // Height
    (width >> 8) & 0xff,
    width & 0xff, // Width
    0x03, // Number of components
    0x01,
    0x11,
    0x00, // Component 1 (Y)
  ];

  return new Uint8Array([
    0xff,
    0xd8, // SOI
    ...sof0Data,
    0xff,
    0xd9, // EOI
  ]);
}

/**
 * Create a minimal valid PNG byte array for testing.
 * Contains the PNG signature and IHDR chunk with the given dimensions.
 *
 * @param colorType PNG color type (2=truecolor, 6=truecolor+alpha)
 */
export function createTestPng(width: number, height: number, colorType: number = 2): Uint8Array {
  const ihdrData = [
    // Width (4 bytes BE)
    (width >> 24) & 0xff,
    (width >> 16) & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    // Height (4 bytes BE)
    (height >> 24) & 0xff,
    (height >> 16) & 0xff,
    (height >> 8) & 0xff,
    height & 0xff,
    // Bit depth
    8,
    // Color type
    colorType,
    // Compression, filter, interlace
    0,
    0,
    0,
  ];

  // Compute CRC32 for IHDR (type + data)
  const ihdrTypeAndData = [
    0x49,
    0x48,
    0x44,
    0x52, // "IHDR"
    ...ihdrData,
  ];
  const crc = computeCrc32(ihdrTypeAndData);

  return new Uint8Array([
    // PNG signature
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    // IHDR chunk
    0x00,
    0x00,
    0x00,
    0x0d, // Length (13 bytes)
    ...ihdrTypeAndData,
    // CRC
    (crc >> 24) & 0xff,
    (crc >> 16) & 0xff,
    (crc >> 8) & 0xff,
    crc & 0xff,
    // IEND chunk
    0x00,
    0x00,
    0x00,
    0x00,
    0x49,
    0x45,
    0x4e,
    0x44,
    0xae,
    0x42,
    0x60,
    0x82,
  ]);
}

/**
 * Simple CRC32 implementation for PNG chunk validation.
 */
function computeCrc32(data: number[]): number {
  // CRC32 lookup table
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }

  let crc = 0xffffffff;
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
