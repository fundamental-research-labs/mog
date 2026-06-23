import { pendingRemoteSegmentKeyMaterialForOperationContext } from '../pending-remote-segment-store';
import { syncOperationContext } from './pending-remote-segment-store-fixtures';

export function registerPendingRemoteSegmentStoreCoreIdentityScenarios(): void {
  it('computes stable key material from sync collaboration identity', async () => {
    const first = await pendingRemoteSegmentKeyMaterialForOperationContext(syncOperationContext());
    const second = await pendingRemoteSegmentKeyMaterialForOperationContext(
      syncOperationContext({ createdAt: '2026-06-21T00:00:02.000Z' }),
    );
    const changedIdentity = await pendingRemoteSegmentKeyMaterialForOperationContext(
      syncOperationContext({ updateId: 'remote-update-2' }),
    );

    expect(first).toEqual(second);
    expect(first.idempotencyKey).toMatch(/^pending-remote:sha256:[0-9a-f]{64}$/);
    expect(first.pendingRemoteSegmentId).toMatch(/^pending-remote-segment:sha256:[0-9a-f]{64}$/);
    expect(first.idempotencyKey).not.toBe(changedIdentity.idempotencyKey);
    expect(first.syncIdentity).toEqual({
      schemaVersion: 1,
      sourceKind: 'providerLiveInbound',
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-1',
      authorityRef: 'authority-1',
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId: 'remote-update-1',
      sequence: '7',
      payloadHash: '3'.repeat(64),
    });
  });
}
