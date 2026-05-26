/**
 * Shared utilities for effect rendering.
 *
 * Constants and helpers used by both SVG and Canvas effect renderers.
 */

/** EMUs (English Metric Units) per pixel at 96 DPI. */
export const EMU_PER_PIXEL = 9525;

/** Convert EMUs to pixels. */
export function emuToPx(emu: number): number {
  return emu / EMU_PER_PIXEL;
}
