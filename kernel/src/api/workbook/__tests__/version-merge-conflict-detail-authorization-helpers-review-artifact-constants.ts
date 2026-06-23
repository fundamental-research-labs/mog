import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

export const DOCUMENT_ID = 'w9-06-merge-conflict-detail-auth';
export const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const CREATED_AT = '2026-06-23T00:00:00.000Z';
export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export const TARGET_REF = 'refs/heads/main' as const;
