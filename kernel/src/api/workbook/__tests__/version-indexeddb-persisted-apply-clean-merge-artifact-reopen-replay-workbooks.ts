import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb/backend';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  INDEXEDDB_PERSISTED_APPLY_DOCUMENT_ID as DOCUMENT_ID,
  INDEXEDDB_PERSISTED_APPLY_GRAPH_ID as GRAPH_ID,
  rootWrite,
} from './version-indexeddb-persisted-apply-test-utils';

export type IndexedDbCleanMergeReplayHandle = Awaited<ReturnType<typeof DocumentFactory.create>>;
export type IndexedDbCleanMergeReplayWorkbook = Workbook;

export async function createIndexedDbCleanMergeReplayHandle(): Promise<IndexedDbCleanMergeReplayHandle> {
  return DocumentFactory.create({
    documentId: DOCUMENT_ID,
    environment: 'headless',
    userTimezone: 'UTC',
  });
}

export async function openInitializedIndexedDbCleanMergeReplayWorkbook(
  handle: IndexedDbCleanMergeReplayHandle,
): Promise<Workbook> {
  return handle.workbook({
    versioning: withVersionManifest({
      providerSelection: {
        kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
        requireDurablePersistence: true,
        initialize: {
          graphId: GRAPH_ID,
          rootWrite: await rootWrite('clean-artifact-root'),
        },
      },
    }),
  });
}

export async function openIndexedDbCleanMergeReplayWorkbook(
  handle: IndexedDbCleanMergeReplayHandle,
): Promise<Workbook> {
  return handle.workbook({
    versioning: withVersionManifest({
      providerSelection: {
        kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
        requireDurablePersistence: true,
      },
    }),
  });
}
