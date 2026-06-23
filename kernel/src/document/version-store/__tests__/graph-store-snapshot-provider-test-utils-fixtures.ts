import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
} from '../provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-snapshot-provider',
  documentId: 'document-snapshot-provider',
  principalScope: 'principal-snapshot-provider',
};

export const SECRET_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-secret-redaction',
  documentId: 'document-secret-redaction',
  principalScope: 'principal-secret-redaction',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'user-snapshot-provider',
  actorKind: 'user',
  displayName: 'Snapshot Provider User',
};

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
  scope: VersionDocumentScope = DOCUMENT_SCOPE,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(scope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await rootWrite('root', namespace),
  };
}
