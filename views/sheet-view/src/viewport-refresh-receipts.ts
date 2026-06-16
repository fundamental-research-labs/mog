import type { ViewportRegionRefreshReceipt } from '@mog-sdk/contracts/api';

export function throwOnFailedViewportRefresh(
  receipts: readonly ViewportRegionRefreshReceipt[],
): void {
  const failed = receipts.find((receipt) => receipt.status === 'failed');
  if (!failed) return;

  const diagnostic =
    failed.diagnostics.find((item) => item.severity === 'error') ?? failed.diagnostics[0];
  throw new Error(diagnostic?.message ?? `Viewport refresh failed for ${failed.regionId}`);
}
