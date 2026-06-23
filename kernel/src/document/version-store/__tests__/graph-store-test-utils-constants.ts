import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionGraphNamespace } from '../object-store';

export const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

export const OTHER_NAMESPACE: VersionGraphNamespace = {
  ...NAMESPACE,
  documentId: 'document-2',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
