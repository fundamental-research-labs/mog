import { computeMergeApplyResultDigest } from '../merge-apply-intent-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import {
  BASE,
  DOCUMENT_SCOPE,
  EXPECTED_TARGET_HEAD,
  OURS,
  TARGET_REF,
  THEIRS,
  fastForwardIntentInput,
  initializeProvider,
} from './merge-apply-intent-store-test-helpers';

export function registerMergeApplyIntentStoreMemoryTests(): void {
  it('begins, reads, completes, and snapshots in-memory intents idempotently', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    const namespace = await initializeProvider(provider);
    const store = await provider.openMergeApplyIntentStore(namespace);
    const input = await fastForwardIntentInput();

    const created = await store.beginIntent(input);
    expect(created.status).toBe('created');
    if (created.status !== 'created') throw new Error('expected intent creation');

    await expect(store.beginIntent(input)).resolves.toMatchObject({
      status: 'existing',
      record: { intentId: input.intentId },
    });
    await expect(
      store.beginIntent({ ...input, createdAt: '2026-06-21T00:00:02.000Z' }),
    ).resolves.toMatchObject({
      status: 'existing',
      record: { intentId: input.intentId },
    });
    await expect(store.readByIntentId(input.intentId)).resolves.toMatchObject({
      status: 'found',
      record: { idempotencyKey: input.idempotencyKey },
    });
    await expect(store.readByIdempotencyKey(input.idempotencyKey)).resolves.toMatchObject({
      status: 'found',
      record: { intentId: input.intentId },
    });

    const conflicted = await store.beginIntent({
      ...input,
      resultDigest: await computeMergeApplyResultDigest({
        status: 'fastForward',
        base: BASE,
        ours: OURS,
        theirs: BASE,
        targetRef: TARGET_REF,
        expectedTargetHead: EXPECTED_TARGET_HEAD,
      }),
    });
    expect(conflicted).toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_INTENT_CONFLICT' }],
    });

    const completed = await store.completeIntent({
      intentId: input.intentId,
      resolvedAttemptDigest: input.resolvedAttemptDigest,
      completedAt: '2026-06-21T00:00:01.000Z',
      terminal: {
        status: 'fastForwarded',
        headBefore: OURS,
        headAfter: THEIRS,
        commitId: THEIRS,
      },
    });
    expect(completed).toMatchObject({
      status: 'completed',
      record: { state: 'finalized', terminal: { status: 'fastForwarded' } },
    });
    await expect(
      store.completeIntent({
        intentId: input.intentId,
        resolvedAttemptDigest: input.resolvedAttemptDigest,
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: {
          status: 'fastForwarded',
          headBefore: OURS,
          headAfter: THEIRS,
          commitId: THEIRS,
        },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: {
        state: 'finalized',
        updatedAt: '2026-06-21T00:00:01.000Z',
        terminal: { status: 'fastForwarded' },
      },
    });
    await expect(
      store.completeIntent({
        intentId: input.intentId,
        resolvedAttemptDigest: input.resolvedAttemptDigest,
        completedAt: '2026-06-21T00:00:05.000Z',
        terminal: {
          status: 'staleTargetHead',
          headBefore: OURS,
          headAfter: BASE,
          commitId: BASE,
        },
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_INTENT_CONFLICT' }],
    });
    await expect(
      store.beginIntent({ ...input, createdAt: '2026-06-21T00:00:03.000Z' }),
    ).resolves.toMatchObject({
      status: 'existing',
      record: { state: 'finalized', terminal: { status: 'fastForwarded' } },
    });

    const snapshot = await backend.exportSnapshot();
    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
    const reloadedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: reloadedBackend,
      durability: 'snapshot-test-double',
    });
    const reloadedStore = await reloadedProvider.openMergeApplyIntentStore(namespace);
    await expect(reloadedStore.readByIdempotencyKey(input.idempotencyKey)).resolves.toMatchObject({
      status: 'found',
      record: { state: 'finalized', terminal: { commitId: THEIRS } },
    });
  });
}
