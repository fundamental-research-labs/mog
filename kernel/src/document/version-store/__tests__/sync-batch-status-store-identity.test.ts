import 'fake-indexeddb/auto';

import { syncBatchStatusKeyMaterialForOperationContext } from '../sync-batch-status-store';
import {
  DEFAULT_PAYLOAD_HASH,
  SUB_UPDATE_A,
  SUB_UPDATE_B,
  installSyncBatchStatusIndexedDbCleanup,
  syncOperationContext,
} from './sync-batch-status-store-test-helpers';

installSyncBatchStatusIndexedDbCleanup();

describe('sync batch status store identity', () => {
  it('computes stable document-scoped batch status ids from sync batch identity', async () => {
    const first = await syncBatchStatusKeyMaterialForOperationContext(syncOperationContext(), {
      batchId: 'batch-1',
      orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
    });
    const replay = await syncBatchStatusKeyMaterialForOperationContext(
      syncOperationContext({
        createdAt: '2026-06-21T00:00:02.000Z',
        collaboration: { sourceKind: 'providerReplay', replay: true, system: true },
      }),
      {
        batchId: 'batch-1',
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
      },
    );
    const changedPayload = await syncBatchStatusKeyMaterialForOperationContext(
      syncOperationContext({ collaboration: { payloadHash: '4'.repeat(64) } }),
      {
        batchId: 'batch-1',
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
      },
    );
    const localEchoWithRotatedRawProvider = await syncBatchStatusKeyMaterialForOperationContext(
      syncOperationContext({
        operationId: 'operation-local-echo',
        collaboration: {
          providerId: 'provider-rotated-2',
          providerKind: 'other-provider',
          authorityRef: 'authority-rotated-2',
          remoteSessionId: 'remote-session-rotated-2',
          correlationId: 'correlation-rotated-2',
          causationIds: ['cause-rotated-2'],
        },
      }),
      {
        batchId: 'batch-1',
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
      },
    );
    const changedSubUpdateOrder = await syncBatchStatusKeyMaterialForOperationContext(
      syncOperationContext(),
      {
        batchId: 'batch-1',
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_B, SUB_UPDATE_A],
      },
    );

    expect(first.batchStatusId).toMatch(/^sync-batch-status:sha256:[0-9a-f]{64}$/);
    expect(first).toEqual(replay);
    expect(first.batchStatusId).toBe(changedPayload.batchStatusId);
    expect(first.batchStatusId).toBe(localEchoWithRotatedRawProvider.batchStatusId);
    expect(first.identity.payloadHash).not.toBe(changedPayload.identity.payloadHash);
    expect(first.batchStatusId).not.toBe(changedSubUpdateOrder.batchStatusId);
    expect(first.identity).toEqual({
      schemaVersion: 1,
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      epoch: 'epoch-1',
      batchId: 'batch-1',
      payloadHash: DEFAULT_PAYLOAD_HASH,
      orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
      subUpdateCount: 2,
    });
  });
});
