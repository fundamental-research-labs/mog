import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
} from '../../../document/version-store/provider';

export const DOCUMENT_ID = 'vc04-indexeddb-public-cell-edit-diff';
export const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: DOCUMENT_ID };
export const GRAPH_ID = 'graph-indexeddb-public-cell-edit-diff';

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function installIndexedDbPublicCellEditDiffLifecycle(): void {
  beforeEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });

  afterEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });
}

export function expectedCellDiff(address: string, value: unknown) {
  return expect.objectContaining({
    structural: expect.objectContaining({
      domain: 'cell',
      entityId: expect.stringMatching(new RegExp(`!${address}$`)),
      propertyPath: ['value'],
    }),
    after: { kind: 'value', value },
    display: { address: { kind: 'value', value: address } },
  });
}

export async function rootWrite(label: string): Promise<VersionGraphInitializeInput['rootWrite']> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, GRAPH_ID);
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      label,
      changes: [],
    }),
    author: AUTHOR,
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
