import type { PivotKernelMutationReceipt } from '@mog-sdk/contracts/pivot';
import { pivotPlacementId } from './identifiers';

type RefreshPolicy = 'dirtyOnly' | 'refreshAndMaterialize';

export function createPlacementReceipt(
  pivotId: string,
  placementId: string,
  updateReason: string,
  refreshPolicy: RefreshPolicy,
  mutationResult: unknown,
): PivotKernelMutationReceipt {
  return {
    kernelReceiptId: `${pivotId}:${updateReason}:${Date.now()}`,
    pivotId,
    effects: [{ type: 'placementUpdated', placementId: pivotPlacementId(placementId) }],
    mutationResult,
    updateReason,
    refreshPolicy,
    materialized: refreshPolicy === 'refreshAndMaterialize',
    configRevision: 0,
    status: 'applied',
  };
}

export function createMutationReceipt(
  pivotId: string,
  updateReason: string,
  refreshPolicy: RefreshPolicy,
  mutationResult: unknown,
  effects: PivotKernelMutationReceipt['effects'],
): PivotKernelMutationReceipt {
  return {
    kernelReceiptId: `${pivotId}:${updateReason}:${Date.now()}`,
    pivotId,
    effects,
    mutationResult,
    updateReason,
    refreshPolicy,
    materialized: refreshPolicy === 'refreshAndMaterialize',
    configRevision: 0,
    status: 'applied',
  };
}
