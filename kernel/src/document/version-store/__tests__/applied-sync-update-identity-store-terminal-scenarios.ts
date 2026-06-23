import { prepareAppliedSyncUpdateIdentityBeforeApply } from '../../applied-sync-update-identity-wiring';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import {
  admittedContextFor,
  appliedIdentityInput,
  DOCUMENT_SCOPE,
} from './applied-sync-update-identity-store-test-helpers';

export function registerAppliedSyncUpdateIdentityStoreTerminalScenarios(): void {
  it('rejects terminal rejected identities before applying sync bytes', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const store = await provider.openAppliedSyncUpdateIdentityStore();
    const input = await appliedIdentityInput();

    await expect(store.reserveIdentity(input)).resolves.toMatchObject({ status: 'reserved' });
    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: { status: 'rejected', reason: 'provider-validation-rejected' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { state: 'rejected' },
    });

    await expect(
      prepareAppliedSyncUpdateIdentityBeforeApply({
        store,
        admittedContext: admittedContextFor(input.operationContext),
        inboundUpdateAlreadySeen: false,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'applied-sync-update-identity-terminal-rejected',
    });
  });

  it('allows retryable identities to complete after a retry', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const store = await provider.openAppliedSyncUpdateIdentityStore();
    const input = await appliedIdentityInput();

    await expect(store.reserveIdentity(input)).resolves.toMatchObject({ status: 'reserved' });
    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: { status: 'retryable', reason: 'transient-before-mutation' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { state: 'retryable' },
    });

    await expect(
      prepareAppliedSyncUpdateIdentityBeforeApply({
        store,
        admittedContext: admittedContextFor(input.operationContext),
        inboundUpdateAlreadySeen: false,
      }),
    ).resolves.toMatchObject({
      status: 'apply',
      reservation: { identityKey: input.identityKey },
    });
    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: { status: 'applied' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { state: 'applied', terminal: { status: 'applied' } },
    });
  });
}
