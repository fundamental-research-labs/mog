import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionDocumentScope } from '../../../document/version-store/provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
export const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}` as const;
export const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}` as const;
export const REVIEW_ID = `review:sha256:${'a'.repeat(64)}` as const;
export const AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
export const SENSITIVE_ACTOR = {
  kind: 'agent',
  trust: 'trusted',
  displayName: 'Reviewer',
  principalId: 'principal-secret',
  agentRunId: 'agent-secret',
} as const;

export const GRAPH_AUTHOR: GraphVersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'Reviewer',
};
export const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;
