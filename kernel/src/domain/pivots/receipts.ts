import type { PivotKernelMutationReceipt, PivotMutationStatus } from '@mog-sdk/contracts/pivot';
import { pivotPlacementId } from './identifiers';

type RefreshPolicy = 'dirtyOnly' | 'refreshAndMaterialize';
type ReceiptOptions = {
  configRevision?: number;
  status?: PivotMutationStatus;
};

let syntheticReceiptSequence = 0;

export function createPivotKernelReceiptId(pivotId: string, updateReason: string): string {
  syntheticReceiptSequence += 1;
  return `${pivotId}:${updateReason}:${syntheticReceiptSequence}`;
}

export function createPlacementReceipt(
  pivotId: string,
  placementId: string,
  updateReason: string,
  refreshPolicy: RefreshPolicy,
  mutationResult: unknown,
  options: ReceiptOptions = {},
): PivotKernelMutationReceipt {
  return {
    kernelReceiptId: createPivotKernelReceiptId(pivotId, updateReason),
    pivotId,
    effects: [{ type: 'placementUpdated', placementId: pivotPlacementId(placementId) }],
    mutationResult,
    updateReason,
    refreshPolicy,
    materialized: refreshPolicy === 'refreshAndMaterialize',
    configRevision: options.configRevision ?? 0,
    status: options.status ?? 'applied',
  };
}

export function createMutationReceipt(
  pivotId: string,
  updateReason: string,
  refreshPolicy: RefreshPolicy,
  mutationResult: unknown,
  effects: PivotKernelMutationReceipt['effects'],
  options: ReceiptOptions = {},
): PivotKernelMutationReceipt {
  return {
    kernelReceiptId: createPivotKernelReceiptId(pivotId, updateReason),
    pivotId,
    effects,
    mutationResult,
    updateReason,
    refreshPolicy,
    materialized: refreshPolicy === 'refreshAndMaterialize',
    configRevision: options.configRevision ?? 0,
    status: options.status ?? 'applied',
  };
}
