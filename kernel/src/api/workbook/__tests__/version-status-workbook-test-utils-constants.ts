import type { VersionDocumentScope } from '../../../document/version-store/provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

export const VERSION_AUTHOR = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
} as const;
