import type { VersionMainRefName } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

const DOCUMENT_ID = 'vc07-apply-merge-persisted-artifact';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const PERSISTED_ARTIFACT_CREATED_AT = '2026-06-21T00:00:00.000Z';
export const PERSISTED_ARTIFACT_TARGET_REF = 'refs/heads/main' as VersionMainRefName;

export const PERSISTED_ARTIFACT_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function persistedArtifactDocumentIdForGraph(graphId: string): string {
  return `${DOCUMENT_ID}-${DOCUMENT_RUN_ID}-${graphId}`;
}
