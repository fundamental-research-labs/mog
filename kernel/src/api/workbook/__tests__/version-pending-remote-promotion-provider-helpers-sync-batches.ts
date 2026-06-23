import { expect } from '@jest/globals';

import type { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import type { PendingRemoteSegmentOperationContext } from '../../../document/version-store/pending-remote-segment-store';
import {
  syncBatchStatusKeyMaterialForOperationContext,
  type SyncBatchStatusTerminal,
} from '../../../document/version-store/sync-batch-status-store';

type InMemoryProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;

export async function markSyncBatchTerminal(
  provider: InMemoryProvider,
  operationContext: PendingRemoteSegmentOperationContext,
  terminal: SyncBatchStatusTerminal,
): Promise<string> {
  const store = await provider.openSyncBatchStatusStore();
  const identityInput = syncBatchIdentityInputForOperationContext(operationContext);
  const keyMaterial = await syncBatchStatusKeyMaterialForOperationContext(
    operationContext,
    identityInput,
  );
  await expect(
    store.reserveBatchStatus({
      batchStatusId: keyMaterial.batchStatusId,
      operationContext,
      ...identityInput,
      createdAt: operationContext.createdAt,
    }),
  ).resolves.toMatchObject({ status: 'reserved' });
  await expect(
    store.completeBatchStatus({
      batchStatusId: keyMaterial.batchStatusId,
      payloadHash: operationContext.collaboration.payloadHash,
      ...identityInput,
      completedAt: '2026-06-21T00:00:05.000Z',
      terminal,
    }),
  ).resolves.toMatchObject({ status: 'completed' });
  return keyMaterial.batchStatusId;
}

function syncBatchIdentityInputForOperationContext(
  operationContext: PendingRemoteSegmentOperationContext,
): {
  readonly batchId?: string;
} {
  const { collaboration } = operationContext;
  return collaboration.batchId === undefined
    ? {}
    : {
        batchId: collaboration.batchId,
      };
}
