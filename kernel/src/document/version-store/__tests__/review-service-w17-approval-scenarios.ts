import {
  AUTHOR,
  createReviewInput,
  expectNoLeak,
  reviewStore,
  unsupportedApprovalEvidence,
} from './review-service-w17-test-helpers';

export function registerReviewServiceW17ApprovalScenarios(): void {
  it('rejects approval evidence with unsupported required targets', async () => {
    const store = reviewStore();
    const created = await store.createReview(createReviewInput('create-review-approval'));
    if (!created.ok) throw new Error(`expected review create success: ${created.error.code}`);

    const result = await store.updateReviewStatus(
      {
        reviewId: created.value.id,
        expectedRevision: 1,
        clientRequestId: 'approve-unsupported-target',
        status: 'approved',
        actor: AUTHOR,
      },
      {
        approvalEvidence: unsupportedApprovalEvidence(),
        updatedAt: '2026-06-23T00:00:00.000Z',
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'approval_required_targets_incomplete' },
    });
    expectNoLeak(result);
    await expect(store.getReview({ reviewId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: { revision: 1, status: 'open' },
    });
  });
}
