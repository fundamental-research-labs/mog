import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionGraphNamespace } from '../object-store';

export const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-snapshot',
  documentId: 'document-snapshot',
  graphId: 'graph-snapshot',
  principalScope: 'principal-snapshot',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'user-snapshot',
  actorKind: 'user',
  displayName: 'Snapshot User',
};
