import type { SheetId } from '@mog-sdk/contracts/core';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionDocumentScope } from '../../../document/version-store/provider';

export const SHEET_ID = 'sheet-1' as SheetId;
export const SHEET_NAME = 'Sheet1';
export const CREATED_AT = '2026-06-20T00:00:00.000Z';
export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'checkout-preconditions-doc',
  principalScope: 'principal-1',
};
export const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
export const PENDING_PROVIDER_SECRET = 'secret-pending-provider-write-room';
export const HISTORY_GAP_SECRET = 'secret-history-gap-marker';
