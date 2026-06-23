import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  parseWorkbookCommitId,
  type VersionDependencyRef,
  type VersionObjectType,
  type WorkbookCommitId,
} from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';

export const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-secret-recovery',
  documentId: 'document-secret-recovery',
  graphId: 'graph-secret-recovery',
  principalScope: 'principal-secret-recovery',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
}

export async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  dependencies: readonly VersionDependencyRef[] = [],
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(NAMESPACE, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
}
