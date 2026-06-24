import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import {
  BASE,
  DOCUMENT_SCOPE,
  OURS,
  THEIRS,
  fastForwardIntentInput,
  initializeProvider,
} from './merge-apply-intent-store-test-helpers';

export function registerMergeApplyIntentStoreIndexedDbTests(): void {
  it('persists merge apply intents through IndexedDB provider reloads', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const store = await provider.openMergeApplyIntentStore(namespace);
    const input = await fastForwardIntentInput();

    await expect(store.beginIntent(input)).resolves.toMatchObject({ status: 'created' });
    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloadedStore = await reloadedProvider.openMergeApplyIntentStore(namespace);

    await expect(reloadedStore.readByIdempotencyKey(input.idempotencyKey)).resolves.toMatchObject({
      status: 'found',
      record: {
        intentId: input.intentId,
        namespaceKey: expect.any(String),
        documentScopeKey: expect.any(String),
      },
    });
    await expect(
      reloadedStore.beginIntent({ ...input, createdAt: '2026-06-21T00:00:02.000Z' }),
    ).resolves.toMatchObject({
      status: 'existing',
      record: { intentId: input.intentId },
    });
    await expect(
      reloadedStore.completeIntent({
        intentId: input.intentId,
        resolvedAttemptDigest: input.resolvedAttemptDigest,
        completedAt: '2026-06-21T00:00:01.000Z',
        terminal: { status: 'fastForwarded', headBefore: OURS, headAfter: THEIRS },
      }),
    ).resolves.toMatchObject({ status: 'completed' });
    await expect(
      reloadedStore.completeIntent({
        intentId: input.intentId,
        resolvedAttemptDigest: input.resolvedAttemptDigest,
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: { status: 'fastForwarded', headBefore: OURS, headAfter: THEIRS },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { updatedAt: '2026-06-21T00:00:01.000Z' },
    });
    await expect(
      reloadedStore.completeIntent({
        intentId: input.intentId,
        resolvedAttemptDigest: input.resolvedAttemptDigest,
        completedAt: '2026-06-21T00:00:05.000Z',
        terminal: { status: 'staleTargetHead', headBefore: OURS, headAfter: BASE },
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_INTENT_CONFLICT' }],
    });
    await expect(
      reloadedStore.beginIntent({ ...input, createdAt: '2026-06-21T00:00:03.000Z' }),
    ).resolves.toMatchObject({
      status: 'existing',
      record: { state: 'finalized', terminal: { status: 'fastForwarded' } },
    });
  });
}
