import type {
  VersionCreateReviewInput,
  WorkbookVersionReviewApprovalEvidence,
  WorkbookVersionReviewDecisionTarget,
  WorkbookVersionReviewDiffPage,
} from '@mog-sdk/contracts/api';

import { reviewDecisionTargetKey } from '../review-approval';
import type { VersionDocumentScope } from '../registry';
import {
  InMemoryWorkbookVersionReviewRecordStore,
  WorkbookVersionReviewRecordMemoryBackend,
} from '../review-service';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-w17-06',
  principalScope: 'principal-1',
};
const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}` as const;
const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}` as const;
const CHANGE_SET_DIGEST = { algorithm: 'sha256', digest: '3'.repeat(64) } as const;
export const AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;
const UNSUPPORTED_DOMAIN = 'macros.vba';
const UNSUPPORTED_ENTITY_ID = 'module-secret';
const UNSUPPORTED_VALUE = 'private macro source';

export function reviewStore(): InMemoryWorkbookVersionReviewRecordStore {
  return new InMemoryWorkbookVersionReviewRecordStore({
    documentScope: DOCUMENT_SCOPE,
    backend: new WorkbookVersionReviewRecordMemoryBackend(),
  });
}

export function createReviewInput(clientRequestId: string): VersionCreateReviewInput {
  return {
    clientRequestId,
    subject: {
      kind: 'commitRange',
      baseCommitId: BASE_COMMIT_ID,
      headCommitId: HEAD_COMMIT_ID,
    },
    createdBy: AUTHOR,
    redactionPolicy: REDACTION_POLICY,
  };
}

export function unsupportedApprovalEvidence(): WorkbookVersionReviewApprovalEvidence {
  const target = unsupportedTarget();
  return {
    schemaVersion: 1,
    changeSetDigest: CHANGE_SET_DIGEST,
    baseCommitId: BASE_COMMIT_ID,
    headCommitId: HEAD_COMMIT_ID,
    requiredTargets: [{ targetKey: reviewDecisionTargetKey(target), target }],
    approvedBy: AUTHOR,
    approvedAt: '2026-06-23T00:00:00.000Z',
    reviewRevision: 2,
  };
}

export function unsupportedDiffPage(): WorkbookVersionReviewDiffPage {
  const target = unsupportedTarget();
  return {
    schemaVersion: 1,
    source: 'semantic-diff',
    baseCommitId: BASE_COMMIT_ID,
    headCommitId: HEAD_COMMIT_ID,
    changeSetDigest: CHANGE_SET_DIGEST,
    changes: [
      {
        target,
        owner: UNSUPPORTED_DOMAIN,
        entity: {
          kind: UNSUPPORTED_DOMAIN,
          workbookId: DOCUMENT_SCOPE.documentId,
          id: UNSUPPORTED_ENTITY_ID,
        },
        propertyPath: target.propertyPath,
        kind: 'create',
        before: { kind: 'value', value: null },
        after: { kind: 'value', value: UNSUPPORTED_VALUE },
        derived: false,
        diagnostics: [],
      },
    ],
    summary: { authoredChanges: 1, derivedChanges: 0, redactedChanges: 0, totalChanges: 1 },
    limit: 50,
    diagnostics: [],
  };
}

export function unsupportedTarget(): Extract<
  WorkbookVersionReviewDecisionTarget,
  { readonly kind: 'semanticChange' }
> {
  return {
    kind: 'semanticChange',
    changeSetDigest: CHANGE_SET_DIGEST,
    changeId: 'unsupported-domain-change',
    entityKind: UNSUPPORTED_DOMAIN,
    entityId: UNSUPPORTED_ENTITY_ID,
    propertyPath: ['source'],
    derived: false,
  };
}

export function expectNoLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const canary of [UNSUPPORTED_DOMAIN, UNSUPPORTED_ENTITY_ID, UNSUPPORTED_VALUE]) {
    expect(serialized).not.toContain(canary);
  }
}
