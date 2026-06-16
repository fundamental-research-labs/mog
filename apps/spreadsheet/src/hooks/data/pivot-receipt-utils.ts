import type {
  PivotAddReceipt,
  PivotAddWithSheetReceipt,
  PivotHandleMutationReceipt,
  PivotRefreshReceipt,
} from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

interface WorkbookWithPivotMaterialization {
  readonly ctx?: {
    awaitMaterialized?: (scope?: SheetId | 'allSheets') => Promise<void>;
  };
}

export async function awaitPivotMaterialization(workbook: unknown): Promise<void> {
  const awaitMaterialized = (workbook as WorkbookWithPivotMaterialization).ctx?.awaitMaterialized;
  if (typeof awaitMaterialized !== 'function') return;
  await awaitMaterialized('allSheets');
}

export function pivotReceiptMessage(
  receipt: PivotAddReceipt | PivotAddWithSheetReceipt | PivotRefreshReceipt,
): string {
  return (
    receipt.diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ??
    receipt.diagnostics[0]?.message ??
    `Pivot operation did not apply: ${receipt.status}.`
  );
}

export function assertPivotMaterialized(
  receipt: PivotAddReceipt | PivotAddWithSheetReceipt,
): void {
  if (receipt.status === 'applied' && receipt.materialized) return;
  throw new Error(pivotReceiptMessage(receipt));
}

export function warnPivotRefresh(receipt: PivotRefreshReceipt | null | undefined): void {
  if (!receipt || receipt.status === 'applied') return;
  console.warn(pivotReceiptMessage(receipt), receipt);
}

export function inspectPivotMutationReceipt(
  operation: string,
  mutation: Promise<PivotHandleMutationReceipt> | null | undefined,
): void {
  if (!mutation) return;
  void mutation
    .then((receipt) => {
      if (receipt.status === 'applied') return;
      const errorMessage = (receipt as { error?: { message?: string } }).error?.message;
      console.warn(
        receipt.diagnostics?.[0]?.message ??
          receipt.kernelReceipt?.error?.message ??
          errorMessage ??
          `Pivot ${operation} did not apply: ${receipt.status}.`,
        receipt,
      );
    })
    .catch((error) =>
      console.warn(
        `Pivot ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      ),
    );
}
