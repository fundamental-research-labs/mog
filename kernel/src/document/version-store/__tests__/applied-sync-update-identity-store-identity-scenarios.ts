import { appliedSyncUpdateIdentityKeyMaterialForOperationContext } from '../applied-sync-update-identity-store';
import { syncOperationContext } from './applied-sync-update-identity-store-test-helpers';

export function registerAppliedSyncUpdateIdentityStoreIdentityScenarios(): void {
  it('computes stable document-scoped identity keys independent of lifecycle source', async () => {
    const first =
      await appliedSyncUpdateIdentityKeyMaterialForOperationContext(syncOperationContext());
    const replay = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
      syncOperationContext({
        createdAt: '2026-06-21T00:00:02.000Z',
        collaboration: { sourceKind: 'providerReplay', replay: true, system: true },
      }),
    );
    const changedUpdate = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
      syncOperationContext({ collaboration: { updateId: 'remote-update-2' } }),
    );
    const changedPayload = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
      syncOperationContext({ collaboration: { payloadHash: '4'.repeat(64) } }),
    );
    const localEchoWithRotatedRawProvider =
      await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
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
      );

    expect(first.identityKey).toMatch(/^applied-sync-update:sha256:[0-9a-f]{64}$/);
    expect(first).toEqual(replay);
    expect(first).toEqual(localEchoWithRotatedRawProvider);
    expect(first.identityKey).not.toBe(changedUpdate.identityKey);
    expect(first.identityKey).toBe(changedPayload.identityKey);
    expect(first.identity).toEqual({
      schemaVersion: 1,
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      epoch: 'epoch-1',
      updateId: 'remote-update-1',
    });
  });
}
