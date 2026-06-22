import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
} from '../../../document/version-store/provider';

export const INDEXEDDB_PERSISTED_APPLY_DOCUMENT_ID = 'vc07-indexeddb-persisted-apply';
export const INDEXEDDB_PERSISTED_APPLY_DOCUMENT_SCOPE: VersionDocumentScope = {
  documentId: INDEXEDDB_PERSISTED_APPLY_DOCUMENT_ID,
};
export const INDEXEDDB_PERSISTED_APPLY_GRAPH_ID = 'graph-indexeddb-persisted-apply';

const CREATED_AT = '2026-06-21T00:00:00.000Z';
export const INDEXEDDB_PERSISTED_APPLY_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export async function rootWrite(label: string): Promise<VersionGraphInitializeInput['rootWrite']> {
  const namespace = namespaceForDocumentScope(
    INDEXEDDB_PERSISTED_APPLY_DOCUMENT_SCOPE,
    INDEXEDDB_PERSISTED_APPLY_GRAPH_ID,
  );
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      label,
      changes: [],
    }),
    author: INDEXEDDB_PERSISTED_APPLY_AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
  };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}
