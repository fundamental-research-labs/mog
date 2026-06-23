import type { VersionGraphNamespace } from '../object-store';

export const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

export const FULL_STATE_BYTES = new Uint8Array([0, 1, 2, 252, 253, 254, 255]);
