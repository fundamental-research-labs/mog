/**
 * Row Visibility Module — Pure computation for bitmap composition and RowVisibility.
 *
 * Bitmaps use Uint8Array where each byte is 1 (visible) or 0 (hidden).
 * One byte per data row — simple, cache-friendly, and composable via AND.
 *
 * Heavy computation delegates to Rust/WASM via compute-core.
 *
 * @packageDocumentation
 */

import type { RowVisibility } from './types';

import { getWasm } from './wasm-backend';

// ═══════════════════════════════════════════
//  BITMAP COMPOSITION (delegates to WASM)
// ═══════════════════════════════════════════

/**
 * Compose multiple visibility bitmaps via AND — a row must pass ALL filters.
 *
 * - Empty array → returns empty Uint8Array(0)
 * - Single bitmap → returns a copy (no mutation of input)
 * - Multiple bitmaps → element-wise AND; all must be same length
 *
 * @param bitmaps - Array of Uint8Array bitmaps (1=visible, 0=hidden)
 * @returns Combined bitmap where a row is visible only if visible in ALL inputs
 */
export function composeBitmaps(bitmaps: readonly Uint8Array[]): Uint8Array {
  // Convert Uint8Arrays to plain arrays for WASM serialization
  const plainBitmaps = bitmaps.map((b) => Array.from(b));
  const result = getWasm().table_compose_bitmaps(plainBitmaps);
  return new Uint8Array(result as ArrayLike<number>);
}

// ═══════════════════════════════════════════
//  ROW VISIBILITY (delegates to WASM)
// ═══════════════════════════════════════════

/**
 * Create a RowVisibility summary from a bitmap.
 *
 * Computes visibleCount, firstVisibleRow, and lastVisibleRow by scanning the bitmap.
 * firstVisibleRow and lastVisibleRow are relative to data range start (0-based).
 * Returns -1 for firstVisibleRow and lastVisibleRow if no rows are visible.
 *
 * @param bitmap - Uint8Array where 1=visible, 0=hidden
 * @returns RowVisibility with computed stats
 */
export function createRowVisibility(bitmap: Uint8Array): RowVisibility {
  const plainBitmap = Array.from(bitmap);
  const result = getWasm().table_create_row_visibility(plainBitmap) as RowVisibility;
  // Ensure bitmap is Uint8Array on the TS side
  return {
    ...result,
    bitmap: new Uint8Array(result.bitmap),
  };
}
