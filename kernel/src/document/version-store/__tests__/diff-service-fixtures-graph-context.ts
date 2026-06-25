import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { createInMemoryVersionStoreProvider, VersionDocumentScope } from '../provider';

export const DIFF_SERVICE_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

export const DIFF_SERVICE_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export const DIFF_SERVICE_CREATED_AT = '2026-06-20T00:00:00.000Z';

export type DiffServiceProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;
