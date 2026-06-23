import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import {
  appliedIdentityInput,
  DOCUMENT_SCOPE,
  expectNoRawProviderIdentity,
  syncOperationContext,
} from './applied-sync-update-identity-store-test-helpers';

export function registerAppliedSyncUpdateIdentityStoreMemoryScenarios(): void {
  it('reserves, completes, deduplicates, and snapshots in-memory identities', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    const store = await provider.openAppliedSyncUpdateIdentityStore();
    const input = await appliedIdentityInput();

    await expect(store.reserveIdentity(input)).resolves.toMatchObject({
      status: 'reserved',
      record: { identityKey: input.identityKey, state: 'reserved' },
    });
    const reserved = await store.readByIdentityKey(input.identityKey);
    if (reserved.status !== 'found') throw new Error('expected reserved identity');
    expectNoRawProviderIdentity(reserved.record.operationContext.collaboration);
    await expect(
      store.reserveIdentity({
        ...input,
        createdAt: '2026-06-21T00:00:02.000Z',
        operationContext: syncOperationContext({
          createdAt: '2026-06-21T00:00:02.000Z',
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
      }),
    ).resolves.toMatchObject({
      status: 'existing',
      record: { identityKey: input.identityKey, state: 'reserved' },
    });
    await expect(
      store.reserveIdentity({
        ...input,
        operationContext: syncOperationContext({ collaboration: { payloadHash: '4'.repeat(64) } }),
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_APPLIED_SYNC_UPDATE_CONFLICT' }],
    });

    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: {
          status: 'applied',
          pendingRemoteSegmentId: 'pending-remote-segment:sha256:' + 'a'.repeat(64),
        },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { state: 'applied' },
    });
    await expect(store.reserveIdentity(input)).resolves.toMatchObject({
      status: 'duplicate',
      record: { state: 'applied' },
    });
    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: {
          status: 'applied',
          pendingRemoteSegmentId: 'pending-remote-segment:sha256:' + 'a'.repeat(64),
        },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { updatedAt: '2026-06-21T00:00:03.000Z' },
    });
    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: {
          status: 'retryable',
          reason: 'transient-write-failure',
        },
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_APPLIED_SYNC_UPDATE_CONFLICT' }],
    });

    const snapshot = await backend.exportSnapshot();
    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
    const reloadedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: reloadedBackend,
      durability: 'snapshot-test-double',
    });
    await expect(
      (await reloadedProvider.openAppliedSyncUpdateIdentityStore()).readByIdentityKey(
        input.identityKey,
      ),
    ).resolves.toMatchObject({
      status: 'found',
      record: { identityKey: input.identityKey, state: 'applied' },
    });
    const reloadedRead = await (
      await reloadedProvider.openAppliedSyncUpdateIdentityStore()
    ).readByIdentityKey(input.identityKey);
    if (reloadedRead.status !== 'found') throw new Error('expected reloaded identity');
    expectNoRawProviderIdentity(reloadedRead.record.operationContext.collaboration);
  });

  it('rejects invalid reservation identity keys without creating rows', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const store = await provider.openAppliedSyncUpdateIdentityStore();
    const input = await appliedIdentityInput();
    const changedUpdate = await appliedIdentityInput(
      syncOperationContext({ collaboration: { updateId: 'remote-update-2' } }),
    );

    await expect(
      store.reserveIdentity({
        ...input,
        identityKey: changedUpdate.identityKey,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      diagnostics: [{ code: 'VERSION_INVALID_OPTIONS' }],
    });
    await expect(store.readByIdentityKey(input.identityKey)).resolves.toMatchObject({
      status: 'missing',
    });
    await expect(store.readByIdentityKey(changedUpdate.identityKey)).resolves.toMatchObject({
      status: 'missing',
    });
  });
}
