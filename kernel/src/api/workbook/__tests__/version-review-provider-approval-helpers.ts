import {
  reviewCellA1ValueChange,
  reviewSheetOrderChange,
} from './version-review-provider-fixtures';
import {
  createReviewInput,
  graphWithRootAndChild,
  versionForProvider,
} from './version-review-provider-test-utils';

export async function createCellA1ApprovalReview(clientRequestId: string) {
  return createApprovalReview(clientRequestId, [reviewCellA1ValueChange()]);
}

export async function createCellA1AndSheetOrderApprovalReview(clientRequestId: string) {
  return createApprovalReview(clientRequestId, [
    reviewCellA1ValueChange(),
    reviewSheetOrderChange(),
  ]);
}

async function createApprovalReview(clientRequestId: string, changes: readonly unknown[]) {
  const graph = await graphWithRootAndChild(changes);
  const version = versionForProvider(graph.provider);
  const review = await version.createReview({
    ...createReviewInput(clientRequestId),
    subject: {
      kind: 'commitRange',
      baseCommitId: graph.rootCommitId,
      headCommitId: graph.childCommitId,
    },
  });
  if (!review.ok) throw new Error(`expected review create success: ${review.error.code}`);

  return { graph, review: review.value, version };
}
