import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionDocumentScope } from '../../../document/version-store/provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'version-diff-projection',
  principalScope: 'principal-1',
};

export const CREATED_AT = '2026-06-20T00:00:00.000Z';

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
