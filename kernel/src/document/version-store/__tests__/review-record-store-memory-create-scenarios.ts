import type { WorkbookVersionReviewRecordStore } from '../review-service-record-store';
import {
  BASE_COMMIT_ID,
  DOCUMENT_SCOPE,
  HEAD_COMMIT_ID,
  createReviewInput,
} from './review-record-store-test-helpers';

export async function createReviewWithIdempotencyAssertions(
  store: WorkbookVersionReviewRecordStore,
): Promise<string> {
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

  return created.value.id;
}
