import type { WorkbookCommitId as PublicWorkbookCommitId } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType } from '../object-digest';
import type { VersionDocumentScope, VersionGraphInitializeInput } from '../provider';
import { namespaceForDocumentScope } from '../provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export const MISSING_COMMIT_ID =
  'commit:sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as PublicWorkbookCommitId;

export async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

export async function rootWrite(
  label: string,
  namespace: VersionGraphNamespace,
): Promise<VersionGraphInitializeInput['rootWrite']> {
  return {
    snapshotRootRecord: await objectRecord(
      'workbook.snapshotRoot.v1',
      { label, sheets: [] },
      namespace,
    ),
    semanticChangeSetRecord: await objectRecord(
      'workbook.semanticChangeSet.v1',
      { label, changes: [] },
      namespace,
    ),
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

export async function initializeInput(
  graphId: string,
  label = 'root',
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await rootWrite(label, namespace),
  };
}
