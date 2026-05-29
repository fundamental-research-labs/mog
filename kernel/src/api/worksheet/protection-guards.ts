import type { CellRange, ProtectionOperation, SheetId } from '@mog-sdk/contracts/api';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { normalizeRange } from '../internal/utils';

export function protectedOperationMessage(operation: ProtectionOperation): string {
  return `Cannot perform ${operation}: sheet is protected and operation is not allowed`;
}

function throwProtected(operation: ProtectionOperation): never {
  throw new KernelError('API_PROTECTED_SHEET', protectedOperationMessage(operation), {
    context: {
      internalCode: 'API_PROTECTED_SHEET',
      operation,
    },
  });
}

export async function assertSheetOperationAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: ProtectionOperation,
): Promise<void> {
  const allowed = await ctx.computeBridge.canDoStructureOp(sheetId, operation);
  if (!allowed) throwProtected(operation);
}

export function assertSheetOperationAllowedSync(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: ProtectionOperation,
): void {
  const settings = ctx.mirror.getSheetSettings(sheetId);
  if (!settings.isProtected) return;

  const options = settings.protectionOptions;
  let allowed = false;
  switch (operation) {
    case 'insertRows':
      allowed = options?.insertRows ?? false;
      break;
    case 'insertColumns':
      allowed = options?.insertColumns ?? false;
      break;
    case 'deleteRows':
      allowed = options?.deleteRows ?? false;
      break;
    case 'deleteColumns':
      allowed = options?.deleteColumns ?? false;
      break;
    case 'formatCells':
      allowed = options?.formatCells ?? false;
      break;
    case 'formatRows':
      allowed = options?.formatRows ?? false;
      break;
    case 'formatColumns':
      allowed = options?.formatColumns ?? false;
      break;
    case 'sort':
      allowed = options?.sort ?? false;
      break;
    case 'filter':
      allowed = options?.useAutoFilter ?? false;
      break;
    case 'editObject':
      allowed = options?.editObjects ?? false;
      break;
  }

  if (!allowed) throwProtected(operation);
}

function rangeFormatOperation(range: CellRange): ProtectionOperation {
  const normalized = normalizeRange(range);
  const spansAllRows = normalized.startRow === 0 && normalized.endRow === MAX_ROWS - 1;
  const spansAllColumns = normalized.startCol === 0 && normalized.endCol === MAX_COLS - 1;
  const isFullRow = range.isFullRow === true || (spansAllColumns && !spansAllRows);
  const isFullColumn = range.isFullColumn === true || (spansAllRows && !spansAllColumns);

  if (isFullRow) return 'formatRows';
  if (isFullColumn) return 'formatColumns';
  return 'formatCells';
}

export function getRequiredFormatOperationsForRanges(
  ranges: readonly CellRange[],
): ProtectionOperation[] {
  const operations = new Set<ProtectionOperation>();
  for (const range of ranges) {
    operations.add(rangeFormatOperation(range));
  }
  return Array.from(operations);
}

export async function assertFormatOperationsAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operations: readonly ProtectionOperation[],
): Promise<void> {
  for (const operation of operations) {
    await assertSheetOperationAllowed(ctx, sheetId, operation);
  }
}

export async function assertFormatRangesAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  ranges: readonly CellRange[],
): Promise<void> {
  await assertFormatOperationsAllowed(ctx, sheetId, getRequiredFormatOperationsForRanges(ranges));
}
