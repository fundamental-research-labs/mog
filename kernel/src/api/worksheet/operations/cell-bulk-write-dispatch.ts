import type { SheetId } from '@mog-sdk/contracts/core';

import type { MutationAdmissionOptions } from '../../../bridges/compute';
import { compactRectangularCellWriteVersionMutationOptions } from '../../internal/cell-write-version-options';
import type { CellInput } from './cell-input';
import type { DocumentContext } from './shared';

export interface BulkCellEdit {
  readonly row: number;
  readonly col: number;
  readonly input: CellInput;
}

export async function dispatchBulkCellEdits(
  ctx: DocumentContext,
  sheetId: SheetId,
  edits: readonly BulkCellEdit[],
  mutationOptions: MutationAdmissionOptions,
): Promise<void> {
  const editMutationOptions = compactRectangularCellWriteVersionMutationOptions(
    mutationOptions,
    sheetId,
    edits,
  );
  if (edits.every((edit) => edit.input.kind === 'parse')) {
    await ctx.computeBridge.setCellValuesParsed(
      sheetId,
      edits.map((edit) => {
        if (edit.input.kind !== 'parse') {
          throw new Error(`Expected parsed cell input, got ${edit.input.kind}`);
        }
        return [edit.row, edit.col, edit.input.text] as [number, number, string];
      }),
      editMutationOptions,
    );
    return;
  }

  await ctx.computeBridge.setCellsByPosition(sheetId, [...edits], editMutationOptions);
}
