import type {
  WorkbookVersionReviewDecision,
  WorkbookVersionReviewDecisionDraft,
} from '@mog-sdk/contracts/api';

import { objectDigestFor } from './merge-apply-intent-store';
import { cloneJson } from './review-service-codec';

export async function reviewIdForCreate(
  documentScopeKey: string,
  clientRequestId: string,
): Promise<string> {
  const digest = await objectDigestFor('mog.version.review-record.create.v1', {
    documentScopeKey,
    clientRequestId,
  });
  return `review:sha256:${digest.digest}`;
}

async function decisionIdForInput(input: {
  readonly reviewId: string;
  readonly clientRequestId: string;
  readonly decision: WorkbookVersionReviewDecisionDraft;
}): Promise<string> {
  const digest = await objectDigestFor('mog.version.review-record.decision.v1', input);
  return `review-decision:sha256:${digest.digest}`;
}

export async function materializeDecision(
  reviewId: string,
  clientRequestId: string,
  draft: WorkbookVersionReviewDecisionDraft,
  createdAt: string,
): Promise<WorkbookVersionReviewDecision> {
  return cloneJson({
    ...draft,
    id: await decisionIdForInput({ reviewId, clientRequestId, decision: draft }),
    createdAt,
  });
}
