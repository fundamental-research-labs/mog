import { prepareAppliedSyncUpdateIdentityBeforeApply } from '../../applied-sync-update-identity-wiring';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import {
  admittedContextFor,
  appliedIdentityInput,
  DOCUMENT_SCOPE,
  expectNoRawProviderIdentity,
  OTHER_DOCUMENT_SCOPE,
} from './applied-sync-update-identity-store-test-helpers';

export function registerAppliedSyncUpdateIdentityStoreIndexedDbScenarios(): void {
  it('persists IndexedDB identities before graph initialization and isolates document scopes', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const store = await provider.openAppliedSyncUpdateIdentityStore();
    const input = await appliedIdentityInput();

    await expect(store.reserveIdentity(input)).resolves.toMatchObject({
      status: 'reserved',
      record: { documentScopeKey: expect.stringContaining(DOCUMENT_SCOPE.documentId) },
    });
    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: { status: 'failedAfterMutation', reason: 'rebuild-failed' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { state: 'failedAfterMutation' },
    });

    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloadedStore = await reloadedProvider.openAppliedSyncUpdateIdentityStore();
    await expect(reloadedStore.readByIdentityKey(input.identityKey)).resolves.toMatchObject({
      status: 'found',
      record: { state: 'failedAfterMutation' },
    });
    const reloadedIdentity = await reloadedStore.readByIdentityKey(input.identityKey);
    if (reloadedIdentity.status !== 'found') throw new Error('expected persisted identity');
    expectNoRawProviderIdentity(reloadedIdentity.record.operationContext.collaboration);
    await expect(reloadedStore.reserveIdentity(input)).resolves.toMatchObject({
      status: 'existing',
      record: { state: 'failedAfterMutation' },
    });
    await expect(
      prepareAppliedSyncUpdateIdentityBeforeApply({
        store: reloadedStore,
        admittedContext: admittedContextFor(input.operationContext),
        inboundUpdateAlreadySeen: false,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'applied-sync-update-identity-failed-after-mutation',
    });
    await expect(
      reloadedStore.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: { status: 'applied' },
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_APPLIED_SYNC_UPDATE_CONFLICT' }],
    });

    const otherProvider = createIndexedDbVersionStoreProvider({
      documentScope: OTHER_DOCUMENT_SCOPE,
    });
    await expect(
      (await otherProvider.openAppliedSyncUpdateIdentityStore()).readByIdentityKey(
        input.identityKey,
      ),
    ).resolves.toMatchObject({
      status: 'missing',
    });
  });
}
