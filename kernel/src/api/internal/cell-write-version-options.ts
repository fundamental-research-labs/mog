import type { SheetId } from '@mog-sdk/contracts/core';

import { type MutationAdmissionOptions, withDirectEditRange } from '../../bridges/compute';
import type { DocumentContext } from '../../context';
import { createVersionMutationAdmissionOptions } from '../workbook/version-operation-context';

export interface CellWriteVersionOptionsInput {
  readonly operationIdPrefix: string;
  readonly sheetIds: readonly SheetId[];
  readonly domainIds?: readonly string[];
  readonly groupId?: string;
}

export function createCellWriteVersionMutationOptions(
  ctx: DocumentContext,
  input: CellWriteVersionOptionsInput,
): MutationAdmissionOptions {
  return createVersionMutationAdmissionOptions(ctx, {
    operationIdPrefix: input.operationIdPrefix,
    sheetIds: input.sheetIds,
    domainIds: input.domainIds ?? ['cells'],
    ...(input.groupId ? { groupId: input.groupId } : {}),
  });
}

export function ensureCellWriteVersionMutationOptions(
  ctx: DocumentContext,
  options: MutationAdmissionOptions | undefined,
  input: CellWriteVersionOptionsInput,
): MutationAdmissionOptions {
  return options ?? createCellWriteVersionMutationOptions(ctx, input);
}

export function compactRectangularCellWriteVersionMutationOptions(
  options: MutationAdmissionOptions,
  sheetId: SheetId,
  edits: readonly { readonly row: number; readonly col: number }[],
): MutationAdmissionOptions {
  if (edits.length < 2) return options;

  let startRow = Number.POSITIVE_INFINITY;
  let startCol = Number.POSITIVE_INFINITY;
  let endRow = Number.NEGATIVE_INFINITY;
  let endCol = Number.NEGATIVE_INFINITY;

  for (const edit of edits) {
    startRow = Math.min(startRow, edit.row);
    startCol = Math.min(startCol, edit.col);
    endRow = Math.max(endRow, edit.row);
    endCol = Math.max(endCol, edit.col);
  }

  const rowCount = endRow - startRow + 1;
  const colCount = endCol - startCol + 1;
  return rowCount * colCount === edits.length
    ? withDirectEditRange(options, sheetId, startRow, startCol, endRow, endCol)
    : options;
}
