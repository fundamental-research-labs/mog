import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionDocumentScope } from '../../../document/version-store/provider';

export const DOCUMENT_ID = 'vc07-apply-merge-format';
export const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: DOCUMENT_ID };
export const CREATED_AT = '2026-06-21T00:00:00.000Z';
export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
