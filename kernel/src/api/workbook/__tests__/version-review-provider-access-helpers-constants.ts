import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionDocumentScope } from '../../../document/version-store/provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'w9-04-review-provider-access',
  principalScope: 'principal-owner',
};
export const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}` as const;
export const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}` as const;
export const RAW_CELL_VALUE = 'RAW-CELL-VALUE-W9-04';
export const SECRET_DOMAIN = 'cells.values.secret-domain';
export const SECRET_PATH = 'changes[1].after.value';
export const PRINCIPAL_SECRET = 'principal-secret';
export const PRINCIPAL_OTHER = 'principal-other';
export const SECRET_REF = 'refs/heads/w10-09-secret-review';
export const SECRET_BRANCH = 'w10-09-secret-branch';
export const SECRET_TABLE_ID = 'table:w10-09-secret';
export const SECRET_TABLE_NAME = 'W10-09 Hidden Table';

export const CREATED_AT = '2026-06-23T00:00:00.000Z';
export const GRAPH_AUTHOR: GraphVersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'Reviewer',
};
export const REVIEW_AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
export const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;
