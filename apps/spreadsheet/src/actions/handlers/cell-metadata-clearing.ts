import type { WorksheetWithInternals } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';

import { clearCommentsInRanges } from './comment-clearing';
import { clearValidationsInRangeIfPresent } from './validation-clearing';

/**
 * Clear the optional metadata attached to a selected cell range.
 *
 * The caller owns the undo group. Operations are deliberately sequential so
 * an error cannot end that group while another metadata write is still in
 * flight.
 */
export async function clearCellMetadataInRange(
  worksheet: WorksheetWithInternals,
  range: CellRange,
): Promise<void> {
  await clearCommentsInRanges(worksheet, [range]);
  await clearValidationsInRangeIfPresent(worksheet, range);
  await worksheet.conditionalFormats.clearInRanges([range]);
}
