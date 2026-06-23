import type { VersionGraphNamespace } from '../object-store';

export const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

export const FULL_STATE_BYTES = new Uint8Array([0, 7, 14, 21, 28, 35]);

export const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}`;

export const WRONG_DIGEST = {
  algorithm: 'sha256' as const,
  digest: 'f'.repeat(64),
};
