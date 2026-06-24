import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  intentIdForMergeResultId,
  intentIdForResolvedAttemptDigest,
} from '../../../document/version-store/merge-apply-intent-store';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import {
  createIndexedDbVersionStoreProvider,
  INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
} from '../../../document/version-store/provider-indexeddb/backend';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  expectCommit,
  expectHead,
  expectInitializeSuccess,
  failFirstIntentCompletion,
  installIndexedDbPersistedApplyTestLifecycle,
  requireRefRevision,
  resolutionFor,
} from './version-indexeddb-persisted-apply-test-helpers';
import {
  INDEXEDDB_PERSISTED_APPLY_AUTHOR as AUTHOR,
  INDEXEDDB_PERSISTED_APPLY_DOCUMENT_ID as DOCUMENT_ID,
  INDEXEDDB_PERSISTED_APPLY_DOCUMENT_SCOPE as DOCUMENT_SCOPE,
  INDEXEDDB_PERSISTED_APPLY_GRAPH_ID as GRAPH_ID,
  rootWrite,
} from './version-indexeddb-persisted-apply-test-utils';

export type { Workbook };

export {
  AUTHOR,
  DOCUMENT_ID,
  DOCUMENT_SCOPE,
  DocumentFactory,
  GRAPH_ID,
  INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
  createIndexedDbVersionStoreProvider,
  expectCommit,
  expectHead,
  expectInitializeSuccess,
  failFirstIntentCompletion,
  installIndexedDbPersistedApplyTestLifecycle,
  intentIdForMergeResultId,
  intentIdForResolvedAttemptDigest,
  namespaceForDocumentScope,
  requireRefRevision,
  resolutionFor,
  rootWrite,
  withVersionManifest,
};
