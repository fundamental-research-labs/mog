import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionNormalCommitCapture } from '../commit-service';
import type { DocumentWorkbookVersioningLifecycleConfig } from '../lifecycle';
import type { VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionGraphInitializeInput } from '../provider';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../provider-indexeddb/backend';

export const DOCUMENT_ID = 'version-store-lifecycle-blank-root';
export const GRAPH_ID = 'blank-workbook-root';

const CREATED_AT = '2026-06-22T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function versioningConfig(
  buildRootWrite: () => Promise<VersionGraphInitializeInput['rootWrite']>,
): DocumentWorkbookVersioningLifecycleConfig {
  return {
    providerSelection: {
      kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      initialize: {
        graphId: GRAPH_ID,
        buildRootWrite,
      },
    },
    captureNormalCommit: emptyAuthoredCapture,
  };
}

export const emptyAuthoredCapture: VersionNormalCommitCapture = async ({ namespace }) => ({
  status: 'success',
  input: {
    ...(await rootWrite('empty-authored', namespace)),
    mutationSegmentRecords: [],
  },
});

export async function rootWrite(
  label: string,
  namespace: VersionGraphNamespace,
): Promise<VersionGraphInitializeInput['rootWrite']> {
  return {
    snapshotRootRecord: await objectRecord(
      'workbook.snapshotRoot.v1',
      { label, sheets: ['sheet-1'] },
      namespace,
    ),
    semanticChangeSetRecord: await objectRecord(
      'workbook.semanticChangeSet.v1',
      { label, changes: [] },
      namespace,
    ),
    author: AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
  };
}

async function objectRecord(
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
