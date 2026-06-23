import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionDocumentScope } from '../../../document/version-store/provider';

export const CREATED_AT = '2026-06-20T00:00:00.000Z';
export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
export const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
export const PROMOTION_POLICY = {
  decisions: [
    { capability: 'version:remotePromote', decision: 'allowed' },
    { capability: 'version:provenance', decision: 'allowed' },
  ],
} as const;
export const PROVENANCE_TRUTH_SERVICE = {
  vc09ProvenanceTruthComplete: true,
  vc09ProvenanceTruth: {
    schemaVersion: 1,
    source: 'provider-backed-sync-provenance',
    vc09ProvenanceTruthComplete: true,
    requirements: [],
  },
} as const;
export const SOURCE_BATCH_ID = `batch-digest:sha256:${'4'.repeat(64)}`;
