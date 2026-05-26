/**
 * Bidirectional mappings between PaperSize string literals and OOXML numeric codes.
 *
 * OOXML paper size codes: 1=Letter, 5=Legal, 8=A3, 9=A4.
 * "custom" has no standard code (null).
 */
import type { PaperSize } from '@mog-sdk/contracts/core';

/** Map PaperSize string → OOXML numeric code (null for custom). */
export const paperSizeToCode: Record<PaperSize, number | null> = {
  letter: 1,
  legal: 5,
  a4: 9,
  a3: 8,
  custom: null,
};

/** Map OOXML numeric code → PaperSize string. */
export const codeToPaperSize: Record<number, PaperSize> = {
  1: 'letter',
  5: 'legal',
  9: 'a4',
  8: 'a3',
};
