import type { RelativeConditionalFormat } from '@mog-sdk/contracts/actors';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

type RelativeConditionalFormatRule = RelativeConditionalFormat['rules'][number];

export type CreateConditionalFormat = (
  sheetId: SheetId,
  ranges: CellRange[],
  rules: RelativeConditionalFormatRule[],
) => string | undefined | Promise<string | undefined>;

/**
 * Replay clipboard conditional-formatting payloads at the paste target.
 */
export async function applyConditionalFormatsFromClipboard(
  cfRules: RelativeConditionalFormat[],
  target: CellCoord,
  sheetId: SheetId,
  createConditionalFormat: CreateConditionalFormat,
  transpose: boolean,
): Promise<void> {
  for (const cf of cfRules) {
    const targetRanges: CellRange[] = [];

    for (const relativeRange of cf.ranges) {
      let startRowOffset = relativeRange.startRowOffset;
      let startColOffset = relativeRange.startColOffset;
      let endRowOffset = relativeRange.endRowOffset;
      let endColOffset = relativeRange.endColOffset;

      if (transpose) {
        [startRowOffset, startColOffset] = [startColOffset, startRowOffset];
        [endRowOffset, endColOffset] = [endColOffset, endRowOffset];
      }

      targetRanges.push({
        startRow: target.row + startRowOffset,
        startCol: target.col + startColOffset,
        endRow: target.row + endRowOffset,
        endCol: target.col + endColOffset,
      });
    }

    await createConditionalFormat(sheetId, targetRanges, cf.rules);
  }
}
