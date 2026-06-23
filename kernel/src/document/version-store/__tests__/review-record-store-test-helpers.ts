import type {
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionUpdateReviewStatusInput,
} from '@mog-sdk/contracts/api';

import type { VersionDocumentScope } from '../provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
export const OTHER_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-2',
  principalScope: 'principal-1',
};
export const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}` as const;
export const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}` as const;
export const OTHER_COMMIT_ID = `commit:sha256:${'3'.repeat(64)}` as const;
export const AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;

const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;

export function createReviewInput(
  clientRequestId: string,
  subject: VersionCreateReviewInput['subject'] = {
    kind: 'commitRange',
    baseCommitId: BASE_COMMIT_ID,
    headCommitId: HEAD_COMMIT_ID,
  },
): VersionCreateReviewInput {
  return {
    clientRequestId,
    subject,
    title: `Review ${clientRequestId}`,
    createdBy: AUTHOR,
    redactionPolicy: REDACTION_POLICY,
  };
}

export function appendDecisionInput(
  reviewId: string,
  expectedRevision: number,
  clientRequestId: string,
): VersionAppendReviewDecisionInput {
  return {
    reviewId,
    expectedRevision,
    clientRequestId,
    decision: {
      target: { kind: 'proposal', proposalId: 'proposal-1' },
      decision: 'comment',
      reviewer: AUTHOR,
      body: 'Looks good.',
    },
  };
}

export function updateStatusInput(
  reviewId: string,
  expectedRevision: number,
  clientRequestId: string,
): VersionUpdateReviewStatusInput {
  return {
    reviewId,
    expectedRevision,
    clientRequestId,
    status: 'changes_requested',
    actor: AUTHOR,
    reason: 'Needs a follow-up.',
  };
}
