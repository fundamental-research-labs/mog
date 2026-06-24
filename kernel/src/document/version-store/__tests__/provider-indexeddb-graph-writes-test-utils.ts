import 'fake-indexeddb/auto';

import {
  AUTHOR,
  DOCUMENT_SCOPE,
  MISSING_COMMIT_ID,
  copyMainRefToBranch,
  expectInitializeSuccess,
  expectReadHeadSuccess,
  initializeInput,
  resetIndexedDbVersionStoreForTesting,
  rootWrite,
} from './provider-indexeddb-test-utils';

export { VERSION_GRAPH_MAIN_REF } from '../graph';
export {
  createMergePreviewArtifactRecord,
  mergePreviewArtifactRef,
} from '../merge-attempt-artifacts';
export { objectDigestFromWorkbookCommitId } from '../object-digest';
export { namespaceForDocumentScope } from '../provider';
export { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
export {
  AUTHOR,
  DOCUMENT_SCOPE,
  MISSING_COMMIT_ID,
  copyMainRefToBranch,
  expectInitializeSuccess,
  expectReadHeadSuccess,
  initializeInput,
  resetIndexedDbVersionStoreForTesting,
  rootWrite,
};

beforeEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});

afterEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});
