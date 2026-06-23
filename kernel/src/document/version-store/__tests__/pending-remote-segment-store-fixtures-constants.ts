import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { WorkbookCommitId } from '../object-digest';
import type { VersionDocumentScope } from '../provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export const PROMOTED_COMMIT = `commit:sha256:${'4'.repeat(64)}` as WorkbookCommitId;
