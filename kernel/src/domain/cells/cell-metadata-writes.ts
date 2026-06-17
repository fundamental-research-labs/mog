import type { CellFormat, CellMetadata, SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../context/types';

type RangeTuple = [number, number, number, number];

export function writeMetadataViaFormatChannel(
  ctx: DocumentContext,
  sheetId: SheetId,
  ranges: RangeTuple[],
  partial: Partial<CellMetadata>,
  origin: string,
): void {
  const formatPayload = partial as unknown as CellFormat;
  if (origin === 'validation') {
    void ctx.computeBridge.setFormatForRangesUiState(sheetId, ranges, formatPayload);
    return;
  }
  void ctx.computeBridge.setFormatForRanges(sheetId, ranges, formatPayload);
}
