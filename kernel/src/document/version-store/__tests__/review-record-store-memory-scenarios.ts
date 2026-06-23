import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import {
  AUTHOR,
  BASE_COMMIT_ID,
  DOCUMENT_SCOPE,
  HEAD_COMMIT_ID,
  OTHER_COMMIT_ID,
  OTHER_DOCUMENT_SCOPE,
  appendDecisionInput,
  createReviewInput,
  updateStatusInput,
} from './review-record-store-test-helpers';

export function registerReviewRecordStoreMemoryTests(): void {
  it('persists in-memory review records with idempotent mutations, CAS, paging, and snapshots', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    const store = await provider.openWorkbookVersionReviewRecordStore();
    const createInput = createReviewInput('create-1');

    const created = await store.createReview(createInput);
    expect(created).toMatchObject({
      ok: true,
      value: {
        id: expect.stringMatching(/^review:sha256:[0-9a-f]{64}$/),
        documentId: DOCUMENT_SCOPE.documentId,
        revision: 1,
        status: 'open',
        baseCommitId: BASE_COMMIT_ID,
        headCommitId: HEAD_COMMIT_ID,
      },
    });
    if (!created.ok) throw new Error(`expected create success: ${created.error.code}`);
    const reviewId = created.value.id;

    await expect(store.createReview(createInput)).resolves.toEqual(created);
    await expect(
      store.createReview({ ...createInput, title: 'Different title' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'review_client_request_reused' },
    });
    await expect(store.createReview(createReviewInput('create-duplicate'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'active_review_exists' },
    });

    const decisionInput = appendDecisionInput(reviewId, 1, 'decision-1');
    const decided = await store.appendReviewDecision(decisionInput);
    expect(decided).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        decisions: [
          {
            id: expect.stringMatching(/^review-decision:sha256:[0-9a-f]{64}$/),
            decision: 'comment',
          },
        ],
      },
    });
    await expect(store.appendReviewDecision(decisionInput)).resolves.toEqual(decided);
    await expect(
      store.appendReviewDecision({
        ...decisionInput,
        decision: { ...decisionInput.decision, body: 'different' },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'review_client_request_reused' },
    });
    await expect(
      store.appendReviewDecision(appendDecisionInput(reviewId, 1, 'decision-2')),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'stale_revision', expectedRevision: 1, actualRevision: 2 },
    });
    await expect(
      store.appendReviewDecision({
        reviewId,
        expectedRevision: 2,
        clientRequestId: 'decision-derived-resolved',
        decision: {
          target: {
            kind: 'semanticChange',
            changeSetDigest: { algorithm: 'sha256', digest: '4'.repeat(64) },
            changeId: 'derived-impact-1',
            entityKind: 'formula',
            entityId: 'sheet-1!B1',
            propertyPath: ['value'],
            derived: true,
          },
          decision: 'mark_resolved',
          reviewer: AUTHOR,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'derived_target_not_resolvable' },
    });
    await expect(
      store.appendReviewDecision({
        reviewId,
        expectedRevision: 2,
        clientRequestId: 'decision-conflict-resolved',
        decision: {
          target: {
            kind: 'conflict',
            mergePreviewId: 'merge-preview-1',
            conflictId: 'conflict-1',
            entityKind: 'cell',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
          decision: 'mark_resolved',
          reviewer: AUTHOR,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'conflict_target_resolution_unavailable' },
    });

    const statusInput = updateStatusInput(reviewId, 2, 'status-1');
    const statusUpdated = await store.updateReviewStatus(statusInput);
    expect(statusUpdated).toMatchObject({
      ok: true,
      value: { revision: 3, status: 'changes_requested' },
    });
    await expect(store.updateReviewStatus(statusInput)).resolves.toEqual(statusUpdated);
    await expect(
      store.updateReviewStatus({
        ...updateStatusInput(reviewId, 3, 'status-2'),
        status: 'approved',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'approval_requires_review_diff' },
    });
    for (const status of ['applied', 'superseded', 'stale'] as const) {
      await expect(
        store.updateReviewStatus({
          ...updateStatusInput(reviewId, 3, `status-flow-owned-${status}`),
          status,
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid_state', state: 'flow_owned_review_status' },
      });
    }

    await expect(store.getReview({ reviewId })).resolves.toMatchObject({
      ok: true,
      value: { revision: 3, status: 'changes_requested' },
    });
    await expect(
      store.listReviews({ status: 'changes_requested', commitId: HEAD_COMMIT_ID }),
    ).resolves.toMatchObject({
      ok: true,
      value: { items: [{ id: reviewId }], limit: 50, totalEstimate: 1 },
    });

    const second = await store.createReview(
      createReviewInput('create-2', {
        kind: 'commit',
        commitId: OTHER_COMMIT_ID,
      }),
    );
    expect(second.ok).toBe(true);
    const firstPage = await store.listReviews({ limit: 1 });
    expect(firstPage).toMatchObject({ ok: true, value: { items: [expect.any(Object)], limit: 1 } });
    if (!firstPage.ok || !firstPage.value.nextCursor) {
      throw new Error('expected review list cursor');
    }
    await expect(
      store.listReviews({ limit: 1, cursor: firstPage.value.nextCursor }),
    ).resolves.toMatchObject({
      ok: true,
      value: { items: [expect.any(Object)], limit: 1 },
    });

    const snapshot = await backend.exportSnapshot();
    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
    const reloadedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: reloadedBackend,
      durability: 'snapshot-test-double',
    });
    await expect(
      (await reloadedProvider.openWorkbookVersionReviewRecordStore()).getReview({ reviewId }),
    ).resolves.toMatchObject({
      ok: true,
      value: { revision: 3, status: 'changes_requested' },
    });

    const isolatedProvider = createInMemoryVersionStoreProvider({
      documentScope: OTHER_DOCUMENT_SCOPE,
      backend: reloadedBackend,
    });
    await expect(
      (await isolatedProvider.openWorkbookVersionReviewRecordStore()).listReviews({}),
    ).resolves.toMatchObject({
      ok: true,
      value: { items: [], totalEstimate: 0 },
    });
  });
}
