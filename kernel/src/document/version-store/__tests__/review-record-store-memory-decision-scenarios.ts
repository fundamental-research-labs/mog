import type { WorkbookVersionReviewRecordStore } from '../review-service-record-store';
import { AUTHOR, appendDecisionInput } from './review-record-store-test-helpers';

export async function appendReviewDecisionAssertions(
  store: WorkbookVersionReviewRecordStore,
  reviewId: string,
): Promise<void> {
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
}
