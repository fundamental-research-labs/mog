import { expect } from '@jest/globals';

import type { PendingRemoteSegmentOperationContext } from '../../../document/version-store/pending-remote-segment-store';
import type { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  syncBatchStatusKeyMaterialForOperationContext,
  type SyncBatchStatusTerminal,
} from '../../../document/version-store/sync-batch-status-store';

export async function reserveSyncBatchStatus(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  operationContext: PendingRemoteSegmentOperationContext,
  terminal?: SyncBatchStatusTerminal,
): Promise<string> {
  const store = await provider.openSyncBatchStatusStore();
  const keyMaterial = await syncBatchStatusKeyMaterialForOperationContext(operationContext);
  await expect(
    store.reserveBatchStatus({
      batchStatusId: keyMaterial.batchStatusId,
      operationContext,
      createdAt: operationContext.createdAt,
    }),
  ).resolves.toMatchObject({ status: 'reserved' });
  if (terminal) {
    await expect(
      store.completeBatchStatus({
        batchStatusId: keyMaterial.batchStatusId,
        payloadHash: operationContext.collaboration.payloadHash,
        completedAt: '2026-06-21T00:00:05.000Z',
        terminal,
      }),
    ).resolves.toMatchObject({ status: 'completed' });
  }
  return keyMaterial.batchStatusId;
}
