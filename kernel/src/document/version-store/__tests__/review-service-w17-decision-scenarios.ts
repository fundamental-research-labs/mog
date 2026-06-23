import {
  AUTHOR,
  createReviewInput,
  expectNoLeak,
  reviewStore,
  unsupportedTarget,
} from './review-service-w17-test-helpers';

export function registerReviewServiceW17DecisionScenarios(): void {
  it('rejects appended decisions for unsupported semantic targets', async () => {
    const store = reviewStore();
    const created = await store.createReview(createReviewInput('create-review-decision'));
    if (!created.ok) throw new Error(`expected review create success: ${created.error.code}`);

    const result = await store.appendReviewDecision({
      reviewId: created.value.id,
      expectedRevision: 1,
      clientRequestId: 'decision-unsupported-target',
      decision: {
        target: unsupportedTarget(),
        decision: 'request_change',
        reviewer: AUTHOR,
        body: 'Cannot approve hidden domain.',
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'incomplete_review_target' },
    });
    expectNoLeak(result);
    await expect(store.getReview({ reviewId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: { revision: 1, decisions: [] },
    });
  });
}
